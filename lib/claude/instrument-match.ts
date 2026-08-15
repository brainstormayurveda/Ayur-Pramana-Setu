export interface InstrumentRefRow {
  instrument_id: string;
  instrument_full_name: string;
}

/** Simple, dependency-free fuzzy match: normalize + token overlap. Good
 * enough for the small seeded instrument_reference table; swap for
 * pg_trgm similarity() if the table grows large enough to need it. */
export function matchInstrument(outcomeName: string, instruments: InstrumentRefRow[]): string | null {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const outcomeTokens = new Set(normalize(outcomeName));
  if (outcomeTokens.size === 0) return null;

  // Direct acronym/ID match first (e.g. outcome text literally says "WOMAC").
  for (const instrument of instruments) {
    if (outcomeName.toUpperCase().includes(instrument.instrument_id.replace(/_/g, " "))) {
      return instrument.instrument_id;
    }
  }

  let best: { id: string; score: number } | null = null;
  for (const instrument of instruments) {
    const nameTokens = new Set(normalize(instrument.instrument_full_name));
    if (nameTokens.size === 0) continue;
    const overlap = [...nameTokens].filter((t) => outcomeTokens.has(t)).length;
    const score = overlap / Math.min(nameTokens.size, outcomeTokens.size);
    if (score > 0.5 && (!best || score > best.score)) {
      best = { id: instrument.instrument_id, score };
    }
  }
  return best?.id ?? null;
}
