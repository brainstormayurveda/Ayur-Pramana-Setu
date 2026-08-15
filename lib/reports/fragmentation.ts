import { supabaseAdmin } from "@/lib/supabase/admin";

export interface FragmentationRunResult {
  conditionsComputed: number;
}

/**
 * Corpus-level aggregate: for every condition_icd10_category with at least
 * one trial, how consistently do trials measuring that condition use the
 * same outcome instrument. Answers "why do two trials on the same disease
 * use two different scales" — the report the brief calls out as the most
 * directly useful output of this phase.
 */
export async function computeFragmentationReport(): Promise<FragmentationRunResult> {
  const supabase = supabaseAdmin();

  const { data: trials, error: trialsErr } = await supabase
    .from("trials_raw")
    .select("ctri_id, condition_icd10_category")
    .not("condition_icd10_category", "is", null);
  if (trialsErr) throw new Error(trialsErr.message);

  const { data: outcomes, error: outcomesErr } = await supabase
    .from("trial_outcomes")
    .select("ctri_id, outcome_name, outcome_type, classification, matched_instrument_id");
  if (outcomesErr) throw new Error(outcomesErr.message);

  const { data: instrumentRows, error: instrumentsErr } = await supabase
    .from("instrument_reference")
    .select("instrument_id, comet_core_outcome_set_member");
  if (instrumentsErr) throw new Error(instrumentsErr.message);

  const cometMembers = new Set((instrumentRows ?? []).filter((r) => r.comet_core_outcome_set_member).map((r) => r.instrument_id));

  const trialCategory = new Map<string, string>();
  const categoryTrials = new Map<string, Set<string>>();
  for (const t of trials ?? []) {
    if (!t.condition_icd10_category) continue;
    trialCategory.set(t.ctri_id, t.condition_icd10_category);
    if (!categoryTrials.has(t.condition_icd10_category)) categoryTrials.set(t.condition_icd10_category, new Set());
    categoryTrials.get(t.condition_icd10_category)!.add(t.ctri_id);
  }

  interface CategoryAgg {
    outcomeKeys: Set<string>;
    total: number;
    validated: number;
    investigatorDevised: number;
    instrumentCounts: Map<string, number>;
    primaryTotal: number;
    primaryCometMatches: number;
    cometExists: boolean;
  }
  const byCategory = new Map<string, CategoryAgg>();

  for (const o of outcomes ?? []) {
    const category = trialCategory.get(o.ctri_id);
    if (!category) continue;
    if (!byCategory.has(category)) {
      byCategory.set(category, {
        outcomeKeys: new Set(),
        total: 0,
        validated: 0,
        investigatorDevised: 0,
        instrumentCounts: new Map(),
        primaryTotal: 0,
        primaryCometMatches: 0,
        cometExists: false,
      });
    }
    const agg = byCategory.get(category)!;
    agg.total++;
    agg.outcomeKeys.add(o.matched_instrument_id ?? `unmatched:${o.outcome_name ?? ""}`);
    if (o.classification === "validated_standard_instrument" || o.classification === "modified_validated_instrument") {
      agg.validated++;
    }
    if (o.classification === "investigator_devised_unvalidated") {
      agg.investigatorDevised++;
    }
    if (o.matched_instrument_id) {
      agg.instrumentCounts.set(o.matched_instrument_id, (agg.instrumentCounts.get(o.matched_instrument_id) ?? 0) + 1);
      if (cometMembers.has(o.matched_instrument_id)) agg.cometExists = true;
    }
    if (o.outcome_type === "primary") {
      agg.primaryTotal++;
      if (o.matched_instrument_id && cometMembers.has(o.matched_instrument_id)) agg.primaryCometMatches++;
    }
  }

  let computed = 0;
  for (const [category, trialIds] of categoryTrials) {
    const agg = byCategory.get(category);
    const nTrials = trialIds.size;

    let dominantInstrument: string | null = null;
    let maxCount = 0;
    if (agg) {
      for (const [id, count] of agg.instrumentCounts) {
        if (count > maxCount) {
          maxCount = count;
          dominantInstrument = id;
        }
      }
    }

    const { error: upsertErr } = await supabase.from("condition_fragmentation_report").upsert(
      {
        condition_icd10_category: category,
        n_trials: nTrials,
        distinct_outcome_instruments_used: agg ? agg.outcomeKeys.size : 0,
        share_validated: agg && agg.total > 0 ? agg.validated / agg.total : null,
        share_investigator_devised: agg && agg.total > 0 ? agg.investigatorDevised / agg.total : null,
        dominant_instrument_if_any: dominantInstrument,
        comet_core_outcome_set_exists: agg?.cometExists ?? false,
        comet_core_outcome_set_adherence_rate: agg && agg.primaryTotal > 0 ? agg.primaryCometMatches / agg.primaryTotal : null,
        last_computed_at: new Date().toISOString(),
      },
      { onConflict: "condition_icd10_category" }
    );
    if (!upsertErr) computed++;
  }

  return { conditionsComputed: computed };
}
