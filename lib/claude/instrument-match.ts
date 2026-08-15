export interface InstrumentRefRow {
  instrument_id: string;
  instrument_full_name: string;
}

// Words too generic to count as a meaningful match on their own — several
// instrument full names share them ("Quality of Life", "Index", "Scale",
// "Score"), which previously caused false-positive matches (e.g. an "SF-36"
// or "WHOQOL-BREF" outcome incorrectly matching DLQI, a dermatology-specific
// instrument, purely because both names contain "life"/"quality").
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "score",
  "scale",
  "index",
  "questionnaire",
  "assessment",
  "quality",
  "life",
  "health",
  "survey",
  "rating",
  "measure",
  "outcome",
  "clinical",
  "symptom",
  "severity",
]);

/** Simple, dependency-free fuzzy match: normalize + token overlap on
 * specific (non-generic) words only, plus an acronym/ID substring check.
 * Good enough for the small seeded instrument_reference table; swap for
 * pg_trgm similarity() if the table grows large enough to need it. */
export function matchInstrument(outcomeName: string, instruments: InstrumentRefRow[]): string | null {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  // Direct acronym/ID match first (e.g. outcome text literally says "WOMAC"
  // or "SF-36") — normalize both underscores and hyphens to spaces so
  // "SF_36" matches "SF-36" as well as "SF 36".
  const outcomeUpperNormalized = outcomeName.toUpperCase().replace(/[-_]/g, " ");
  for (const instrument of instruments) {
    const idAsWords = instrument.instrument_id.replace(/[-_]/g, " ");
    if (outcomeUpperNormalized.includes(idAsWords)) {
      return instrument.instrument_id;
    }
  }

  const outcomeTokens = new Set(normalize(outcomeName));
  if (outcomeTokens.size === 0) return null;

  let best: { id: string; score: number } | null = null;
  for (const instrument of instruments) {
    const nameTokens = new Set(normalize(instrument.instrument_full_name));
    if (nameTokens.size === 0) continue;
    const overlap = [...nameTokens].filter((t) => outcomeTokens.has(t)).length;
    // Require at least 2 specific shared words, not just a high ratio —
    // a single shared specific word is still too weak a signal.
    if (overlap < 2) continue;
    const score = overlap / Math.min(nameTokens.size, outcomeTokens.size);
    if (score > 0.6 && (!best || score > best.score)) {
      best = { id: instrument.instrument_id, score };
    }
  }
  return best?.id ?? null;
}
