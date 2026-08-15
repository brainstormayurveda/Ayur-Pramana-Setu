-- Tracks whether a trial's own results paper discloses its CTRI/trial
-- registration number anywhere in the text — distinct from whether the
-- paper was findable via a CTRI-ID citation search in the first place.
-- ICMJE-compliant biomedical journals generally require this; many
-- Ayurveda-specific journals don't enforce it, which breaks the audit
-- trail from registration to published result even for trials that do
-- get published. Judged by Claude alongside the rest of the
-- registered-vs-published comparison, so it covers every publication
-- row (Europe PMC-matched or manually entered) rather than only ones an
-- admin happens to flag by hand.
alter table trial_publications
  add column if not exists discloses_own_trial_registration boolean;
