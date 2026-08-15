/**
 * WHO's ICTRP condition field embeds an ICD-10-ish code inline, e.g.
 * "Health Condition 1: M545- Low back pain" or "Health Condition 1: E10-
 * Type 1 diabetes mellitus". There's no separate structured ICD-10 field
 * in the data WHO exposes (see the Phase 0 build-brief deviation notes),
 * so we extract the 3-character category (e.g. "M54", "E10") from the
 * first listed condition's leading code.
 */
export function extractIcd10Category(conditionText: string | null): string | null {
  if (!conditionText) return null;
  const m = conditionText.match(/\b([A-Z]\d{2})\d*\s*-/);
  return m ? m[1] : null;
}
