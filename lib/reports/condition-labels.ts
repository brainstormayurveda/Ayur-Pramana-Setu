import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractAllIcd10Entries } from "@/lib/icd10";

/**
 * Builds a category -> human-readable description map (e.g. "E10" ->
 * "Type 1 diabetes mellitus") from trials_raw.condition text — there's no
 * separate structured ICD-10 label field in the source data (see
 * lib/icd10.ts), so we derive one from whichever trial happened to state
 * it first. A single query over all trials, not one per category.
 */
export async function buildConditionLabelMap(): Promise<Map<string, string>> {
  const supabase = supabaseAdmin();
  const { data } = await supabase.from("trials_raw").select("condition").not("condition", "is", null);

  const labels = new Map<string, string>();
  for (const row of data ?? []) {
    for (const entry of extractAllIcd10Entries(row.condition)) {
      if (!labels.has(entry.category)) labels.set(entry.category, entry.description);
    }
  }
  return labels;
}
