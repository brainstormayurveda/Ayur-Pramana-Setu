export interface FragmentationRow {
  condition_icd10_category: string;
  n_trials: number;
  distinct_outcome_instruments_used: number;
  share_validated: number | null;
  share_investigator_devised: number | null;
  dominant_instrument_if_any: string | null;
  comet_core_outcome_set_exists: boolean | null;
  comet_core_outcome_set_adherence_rate: number | null;
}

function pct(n: number | null): string {
  if (n === null || n === undefined) return "unknown";
  return `${Math.round(n * 100)}%`;
}

/**
 * Deterministic, template-generated interpretation of one condition's
 * fragmentation numbers — no separate Claude call, since the story is
 * fully derivable from the stats already computed. Keeps the report
 * reproducible and free of hallucination risk.
 */
export function generateFragmentationNarrative(row: FragmentationRow): string[] {
  const paragraphs: string[] = [];
  const { n_trials, distinct_outcome_instruments_used: distinct, share_validated, share_investigator_devised, dominant_instrument_if_any, comet_core_outcome_set_exists, comet_core_outcome_set_adherence_rate } = row;

  // Volume / statistical-maturity framing
  if (n_trials <= 1) {
    paragraphs.push(
      `Only ${n_trials} trial has been ingested for this condition so far, using ${distinct} outcome measure${distinct === 1 ? "" : "s"}. With a single trial there is nothing yet to compare it against — this is a starting point, not a fragmentation signal. Revisit this condition once more trials are ingested.`
    );
  } else {
    const ratio = distinct / n_trials;
    if (ratio >= 2) {
      paragraphs.push(
        `${n_trials} trials study this condition, but between them they use ${distinct} distinct outcome-measurement approaches — far more measures than trials. That means most trials here are not measuring the same thing the same way, which makes it difficult or impossible to pool their results into a meta-analysis or draw a consistent evidence picture across the condition. This is a genuinely fragmented measurement landscape.`
      );
    } else if (ratio > 1.2) {
      paragraphs.push(
        `${n_trials} trials study this condition, using ${distinct} distinct outcome measures between them — some overlap exists, but there is still more variety in what's being measured than the trial count alone would suggest. Partial fragmentation: comparing across trials is possible but not straightforward.`
      );
    } else {
      paragraphs.push(
        `${n_trials} trials study this condition, using ${distinct} distinct outcome measure${distinct === 1 ? "" : "s"} between them — a relatively convergent picture. Trials here are largely measuring the condition the same way, which makes cross-trial comparison and evidence synthesis more feasible.`
      );
    }
  }

  // Validated vs. investigator-devised
  if (share_validated !== null || share_investigator_devised !== null) {
    const validatedPct = pct(share_validated);
    const devisedPct = pct(share_investigator_devised);
    let rigor: string;
    if ((share_investigator_devised ?? 0) >= 0.5) {
      rigor = "This is a substantial share of custom, non-standardized measures — a marker of weaker methodological rigor, since ad-hoc scales generally lack established validity and reliability, and make it harder to trust or compare results.";
    } else if ((share_validated ?? 0) >= 0.7) {
      rigor = "Most outcome measures here are established instruments or objective biomarkers, which is the stronger methodological pattern.";
    } else {
      rigor = "A mixed picture — a meaningful share of measures are recognized instruments, but a non-trivial portion are ad-hoc or uncertain.";
    }
    paragraphs.push(`${validatedPct} of the outcome measures used are validated instruments or objective biomarkers; ${devisedPct} are investigator-devised, ad-hoc measures with no established validation. ${rigor}`);
  }

  // Dominant instrument
  if (dominant_instrument_if_any && n_trials > 1) {
    paragraphs.push(`The most frequently used instrument for this condition is ${dominant_instrument_if_any}. Trials that adopted it are directly comparable to each other on that measure; trials that didn't are not.`);
  } else if (dominant_instrument_if_any) {
    paragraphs.push(`This trial used ${dominant_instrument_if_any} among its outcome measures — a recognized instrument, useful as a comparison point once more trials on this condition are ingested.`);
  } else if (n_trials > 1) {
    paragraphs.push(`No single instrument is shared by more than one trial — every trial in this condition took its own measurement approach, with nothing to anchor comparison across them.`);
  }

  // COMET
  if (comet_core_outcome_set_exists) {
    paragraphs.push(
      `At least one outcome instrument used here is a member of a recognized COMET core outcome set for this condition. ${pct(comet_core_outcome_set_adherence_rate)} of *primary* outcomes across these trials actually used a COMET-recommended instrument — the closer this is to 100%, the more these trials are following the internationally recommended standard for what to measure in this condition.`
    );
  } else {
    paragraphs.push(
      `No instrument used in these trials is currently recognized in our COMET reference table as part of a core outcome set for this condition. Note this reference table is deliberately small and grows over time (seeded with ~15 well-known instruments) — this may mean no core set is known to us yet, not necessarily that none exists.`
    );
  }

  return paragraphs;
}
