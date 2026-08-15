import { supabaseAdmin } from "@/lib/supabase/admin";
import { analyzeTitleTrial, TitleAnalysisInput } from "./title-analysis";
import { sleep } from "./client";

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 1000;

export interface RunTitleAnalysisResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

/**
 * Batch job: for every trials_raw row without a corresponding title_analysis
 * row, call Claude and upsert the result. Batches of ~15 with a pause
 * between batches (brief's general instruction: rate-limit-aware, not one
 * massive loop). Never throws away a failure — logs it and moves on.
 */
export async function runTitleAnalysis({ limit = 150 }: { limit?: number } = {}): Promise<RunTitleAnalysisResult> {
  const supabase = supabaseAdmin();

  const { data: analyzed } = await supabase.from("title_analysis").select("ctri_id");
  const analyzedIds = new Set((analyzed ?? []).map((r) => r.ctri_id as string));

  const { data: trials, error } = await supabase
    .from("trials_raw")
    .select("ctri_id, title_scientific, title_public, study_design, condition, intervention, study_type")
    .order("ingested_at", { ascending: true });

  if (error) throw new Error(`Failed to load trials_raw: ${error.message}`);

  const pending = (trials ?? []).filter((t) => !analyzedIds.has(t.ctri_id)).slice(0, limit);

  const result: RunTitleAnalysisResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (trial) => {
        result.processed++;
        const input: TitleAnalysisInput = {
          ctriId: trial.ctri_id,
          titleScientific: trial.title_scientific,
          titlePublic: trial.title_public,
          studyDesign: trial.study_design,
          condition: trial.condition,
          intervention: trial.intervention,
          studyType: trial.study_type,
        };
        try {
          const analysis = await analyzeTitleTrial(input);
          const { error: upsertErr } = await supabase.from("title_analysis").upsert(
            {
              ctri_id: trial.ctri_id,
              population: analysis.population,
              intervention: analysis.intervention,
              comparator: analysis.comparator,
              outcome: analysis.outcome,
              timing: analysis.timing,
              design_identified_in_title: analysis.design_identified_in_title,
              design_title_vs_registry_match: analysis.design_title_vs_registry_match,
              intervention_specificity: analysis.intervention_specificity,
              dual_nomenclature_flag: analysis.dual_nomenclature_flag,
              spirit_item1_compliance: analysis.spirit_item1_compliance,
              notes: analysis.notes,
            },
            { onConflict: "ctri_id" }
          );
          if (upsertErr) throw new Error(upsertErr.message);
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
