import { supabaseAdmin } from "@/lib/supabase/admin";
import { analyzeMethodsTrial, MethodsAnalysisInput } from "./methods-analysis";
import { matchInstrument } from "./instrument-match";
import { sleep } from "./client";

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 1000;

export interface RunMethodsAnalysisResult {
  processed: number;
  succeeded: number;
  failed: number;
  outcomesWritten: number;
  errors: string[];
}

/**
 * Batch job: for every trial with a completed title_analysis but no
 * methods_analysis yet, call Claude and write methods_analysis +
 * trial_outcomes rows. Same batching/error-tolerance discipline as Phase 1.
 */
export async function runMethodsAnalysis({ limit = 150 }: { limit?: number } = {}): Promise<RunMethodsAnalysisResult> {
  const supabase = supabaseAdmin();

  const { data: titleAnalyzed } = await supabase.from("title_analysis").select("ctri_id");
  const titleAnalyzedIds = new Set((titleAnalyzed ?? []).map((r) => r.ctri_id as string));

  const { data: methodsAnalyzed } = await supabase.from("methods_analysis").select("ctri_id");
  const methodsAnalyzedIds = new Set((methodsAnalyzed ?? []).map((r) => r.ctri_id as string));

  const { data: trials, error } = await supabase
    .from("trials_raw")
    .select("ctri_id, study_design, comparator, target_sample_size_total, target_sample_size_india, brief_summary, primary_outcomes, secondary_outcomes")
    .order("ingested_at", { ascending: true });
  if (error) throw new Error(`Failed to load trials_raw: ${error.message}`);

  const pending = (trials ?? [])
    .filter((t) => titleAnalyzedIds.has(t.ctri_id) && !methodsAnalyzedIds.has(t.ctri_id))
    .slice(0, limit);

  const { data: instrumentRows } = await supabase.from("instrument_reference").select("instrument_id, instrument_full_name");
  const instruments = instrumentRows ?? [];

  const result: RunMethodsAnalysisResult = { processed: 0, succeeded: 0, failed: 0, outcomesWritten: 0, errors: [] };

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (trial) => {
        result.processed++;
        const input: MethodsAnalysisInput = {
          ctriId: trial.ctri_id,
          studyDesign: trial.study_design,
          comparator: trial.comparator,
          targetSampleSizeTotal: trial.target_sample_size_total,
          targetSampleSizeIndia: trial.target_sample_size_india,
          briefSummary: trial.brief_summary,
          primaryOutcomes: trial.primary_outcomes,
          secondaryOutcomes: trial.secondary_outcomes,
        };
        try {
          const analysis = await analyzeMethodsTrial(input);

          const { error: methodsErr } = await supabase.from("methods_analysis").upsert(
            {
              ctri_id: trial.ctri_id,
              sequence_generation: analysis.sequence_generation,
              allocation_concealment_class: analysis.allocation_concealment_class,
              blinding_class: analysis.blinding_class,
              internal_consistency_flag: analysis.open_label_despite_placebo_comparator
                ? "open_label_despite_placebo_comparator"
                : null,
              sample_size_target_total: trial.target_sample_size_total,
              sample_size_target_india: trial.target_sample_size_india,
              sample_size_justification: analysis.sample_size_justification,
              statistical_test_reported: false,
              statistical_test_appropriateness: "not_assessable_from_registration",
            },
            { onConflict: "ctri_id" }
          );
          if (methodsErr) throw new Error(`methods_analysis upsert: ${methodsErr.message}`);

          // Replace any prior outcomes for this trial (re-run safe).
          await supabase.from("trial_outcomes").delete().eq("ctri_id", trial.ctri_id);

          if (analysis.outcomes.length > 0) {
            const rows = analysis.outcomes.map((o) => {
              const matchedId = matchInstrument(o.outcome_name, instruments);
              return {
                ctri_id: trial.ctri_id,
                outcome_name: o.outcome_name,
                outcome_type: o.outcome_type,
                classification: o.classification,
                matched_instrument_id: matchedId,
                matched_comet_core_outcome_set: false,
              };
            });
            const { error: outcomesErr } = await supabase.from("trial_outcomes").insert(rows);
            if (outcomesErr) throw new Error(`trial_outcomes insert: ${outcomesErr.message}`);
            result.outcomesWritten += rows.length;
          }

          result.succeeded++;
        } catch (e) {
          result.failed++;
          result.errors.push(`${trial.ctri_id}: ${(e as Error).message}`);
        }
      })
    );
    if (i + BATCH_SIZE < pending.length) await sleep(BATCH_DELAY_MS);
  }

  return result;
}
