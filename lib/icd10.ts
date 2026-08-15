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

export interface Icd10Entry {
  category: string;
  description: string;
}

/**
 * Extracts every "CODE- Description" pair from the condition text (a trial
 * can list more than one, e.g. "Health Condition 1: K036- Deposits... Health
 * Condition 2: Z464- Encounter for..."). Description runs up to the next
 * "Health Condition N:" marker or the end of the string.
 */
export function extractAllIcd10Entries(conditionText: string | null): Icd10Entry[] {
  if (!conditionText) return [];
  const entries: Icd10Entry[] = [];
  const re = /([A-Z]\d{2})\d*\s*-\s*(.+?)(?=\s*Health Condition \d+\s*:|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(conditionText)) !== null) {
    const description = match[2].trim();
    if (description) entries.push({ category: match[1], description });
  }
  return entries;
}
