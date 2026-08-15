import { supabaseAdmin } from "@/lib/supabase/admin";
import { comparePublication, PublicationComparisonInput } from "./publication-comparison";
import { sleep } from "./client";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;

export interface RunPublicationComparisonResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

/**
 * Batch job: for every trial_publications row with an abstract but no
 * comparison yet, gathers the trial's registered data + Phase 1/2 findings
 * and runs the registered-vs-published comparison.
 */
export async function runPublicationComparison({ limit = 100 }: { limit?: number } = {}): Promise<RunPublicationComparisonResult> {
  const supabase = supabaseAdmin();

  const { data: pubs, error } = await supabase
    .from("trial_publications")
    .select("id, ctri_id, title, author_string, journal, pub_year, pub_types, abstract")
    .is("comparison_analyzed_at", null)
    .not("abstract", "is", null)
    .order("ingested_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load trial_publications: ${error.message}`);

  const result: RunPublicationComparisonResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const pending = pubs ?? [];

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (pub) => {
        result.processed++;
        try {
          const [{ data: trial }, { data: titleAnalysis }, { data: methodsAnalysis }, { data: outcomes }] = await Promise.all([
            supabase.from("trials_raw").select("title_public, title_scientific, condition, intervention, primary_outcomes, study_design").eq("ctri_id", pub.ctri_id).maybeSingle(),
            supabase.from("title_analysis").select("spirit_item1_compliance, notes").eq("ctri_id", pub.ctri_id).maybeSingle(),
            supabase.from("methods_analysis").select("sequence_generation, allocation_concealment_class, blinding_class, internal_consistency_flag, sample_size_justification").eq("ctri_id", pub.ctri_id).maybeSingle(),
            supabase.from("trial_outcomes").select("outcome_name").eq("ctri_id", pub.ctri_id).eq("classification", "investigator_devised_unvalidated"),
          ]);

          const input: PublicationComparisonInput = {
            ctriId: pub.ctri_id,
            registeredTitlePublic: trial?.title_public ?? null,
            registeredTitleScientific: trial?.title_scientific ?? null,
            registeredCondition: trial?.condition ?? null,
            registeredIntervention: trial?.intervention ?? null,
            registeredPrimaryOutcomes: trial?.primary_outcomes ?? null,
            registeredStudyDesign: trial?.study_design ?? null,
            spiritCompliance: titleAnalysis?.spirit_item1_compliance ?? null,
            spiritNotes: titleAnalysis?.notes ?? null,
            sequenceGeneration: methodsAnalysis?.sequence_generation ?? null,
            allocationConcealmentClass: methodsAnalysis?.allocation_concealment_class ?? null,
            blindingClass: methodsAnalysis?.blinding_class ?? null,
            internalConsistencyFlag: methodsAnalysis?.internal_consistency_flag ?? null,
            sampleSizeJustification: methodsAnalysis?.sample_size_justification ?? null,
            investigatorDevisedOutcomeNames: (outcomes ?? []).map((o) => o.outcome_name).filter((n): n is string => !!n),
            publicationTitle: pub.title,
            publicationAuthors: pub.author_string,
            publicationJournal: pub.journal,
            publicationYear: pub.pub_year,
            publicationTypes: pub.pub_types,
            publicationAbstract: pub.abstract,
          };

          const comparison = await comparePublication(input);
          const { error: updateErr } = await supabase
            .from("trial_publications")
            .update({
              is_primary_report: comparison.is_primary_report,
              outcome_switching_flag: comparison.outcome_switching_flag,
              limitations_disclosed: comparison.limitations_disclosed,
              framing_assessment: comparison.framing_assessment,
              comparison_notes: comparison.comparison_notes,
              comparison_analyzed_at: new Date().toISOString(),
            })
            .eq("id", pub.id);
          if (updateErr) throw new Error(updateErr.message);
          result.succeeded++;
        } catch (e) {
          result.failed++;
          result.errors.push(`${pub.ctri_id} (${pub.id}): ${(e as Error).message}`);
        }
      })
    );
    if (i + BATCH_SIZE < pending.length) await sleep(BATCH_DELAY_MS);
  }

  return result;
}
