# AyurPramanaSetu — Claude Code Build Brief (Phase 0, 1 & 2)

## Project overview

AyurPramanaSetu is a research-integrity tool that ingests Ayurveda clinical trial registrations from the WHO ICTRP (sourced from CTRI, India's primary trial registry), and subjects each trial's title and methodology to a structured evidence-quality analysis modeled on the same rigor standards used in Dr. Kembhavi's Pramana Council editorial tool — SPIRIT 2013, Cochrane RoB2, and COMET core-outcome-set benchmarking. Output is both per-trial structured findings and a corpus-level "measurement fragmentation report" showing how consistently (or inconsistently) Ayurveda trials on the same condition measure outcomes.

**Not in scope for this brief:** statistical-test correctness analysis (deferred to Phase 3, gated on the publication-matching pipeline — CTRI's registration schema has no field for statistical analysis plans, so this cannot be done from registration data alone).

## Tech stack (consistent with existing project family)

- **Frontend/backend:** Next.js
- **Database/auth:** Supabase (Postgres)
- **Hosting:** Vercel
- **AI analysis layer:** Anthropic API (Claude), same pattern as Pramana Council
- **Scheduled ingestion:** Vercel Cron or Supabase Edge Function, weekly (matching ICTRP's own update cadence)

## Repo and credentials — setup instructions for Claude Code

- GitHub repo and Supabase project already created under `brainstormayurveda@gmail.com`.
- Repo/Supabase keys are stored locally at: `E:\AyuPramanaSetu\` (text document with GitHub repo URL and Supabase keys).
- **Claude Code should NOT be given the raw key values in chat or committed to the repo.** Instructions for Claude Code:
  1. Ask the user to paste the Supabase URL, Supabase anon/service-role keys, and Anthropic API key directly into a local `.env.local` file (never into a prompt or a committed file).
  2. Add `.env.local` to `.gitignore` immediately, before any other setup step.
  3. Reference environment variables by name only (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_ANON_KEY`) throughout all code — never hardcode.
  4. Confirm `.env.local` is excluded from git tracking before the first commit.

---

## PHASE 0 — Infrastructure and schema

### Goals
Stand up the repo, connect Supabase, define the full database schema up front (even though later phases populate it incrementally), and get a working ICTRP ingestion job pulling real data into `trials_raw`.

### Database schema (Supabase/Postgres)

```sql
-- Raw ingested trial records from ICTRP, filtered to CTRI + Ayurveda
create table trials_raw (
  ctri_id text primary key,
  title_scientific text,
  title_public text,
  trial_acronym text,
  study_type text,
  study_design text,
  phase text,
  condition text,
  condition_icd10_category text,
  intervention text,
  comparator text,
  inclusion_exclusion text,
  randomization_method text,
  allocation_concealment text,
  blinding text,
  primary_outcomes text,
  secondary_outcomes text,
  target_sample_size_total int,
  target_sample_size_india int,
  final_enrolment_total int,
  primary_sponsor_type text,
  recruitment_status text,
  registration_date date,
  date_first_enrollment date,
  ethics_committee_approval text,
  brief_summary text,
  publication_field text,
  raw_ictrp_record jsonb,
  ingested_at timestamptz default now(),
  last_updated_at timestamptz default now()
);

-- Phase 1 output: title-level PICO/T and SPIRIT analysis
create table title_analysis (
  ctri_id text references trials_raw(ctri_id),
  population text, -- present|implied|absent
  intervention text,
  comparator text,
  outcome text,
  timing text,
  design_identified_in_title boolean,
  design_title_vs_registry_match text, -- match|mismatch|title_underspecified
  intervention_specificity text, -- named_formulation|vague_descriptor
  dual_nomenclature_flag boolean,
  spirit_item1_compliance text, -- compliant|partial|non_compliant
  notes text,
  analyzed_at timestamptz default now(),
  primary key (ctri_id)
);

-- Phase 2 output: randomization, sample size, outcome classification
create table methods_analysis (
  ctri_id text references trials_raw(ctri_id),
  sequence_generation text, -- adequate|higher_risk_method|not_randomized|not_reported
  allocation_concealment_class text, -- adequate|inadequate|not_reported
  blinding_class text,
  internal_consistency_flag text,
  sample_size_target_total int,
  sample_size_target_india int,
  sample_size_justification text, -- present_in_summary|absent_from_summary
  statistical_test_reported boolean default false,
  statistical_test_appropriateness text default 'not_assessable_from_registration',
  analyzed_at timestamptz default now(),
  primary key (ctri_id)
);

-- Outcome instruments used per trial (one row per outcome, trial can have multiple)
create table trial_outcomes (
  id uuid primary key default gen_random_uuid(),
  ctri_id text references trials_raw(ctri_id),
  outcome_name text,
  outcome_type text, -- primary|secondary
  classification text, -- validated_standard_instrument|objective_biomarker|investigator_devised_unvalidated|classical_ayurvedic_parameter|modified_validated_instrument
  matched_instrument_id text references instrument_reference(instrument_id),
  matched_comet_core_outcome_set boolean default false
);

-- Reference table of validated outcome instruments (Phase 2 dependency, populated incrementally)
create table instrument_reference (
  instrument_id text primary key,
  instrument_full_name text,
  domain text,
  applicable_conditions text,
  validation_citation text,
  scoring_type text,
  score_range text,
  mcid_known boolean,
  mcid_value text,
  comet_core_outcome_set_member boolean,
  source text
);

-- Corpus-level aggregate: measurement fragmentation per condition
create table condition_fragmentation_report (
  condition_icd10_category text primary key,
  n_trials int,
  distinct_outcome_instruments_used int,
  share_validated numeric,
  share_investigator_devised numeric,
  dominant_instrument_if_any text,
  comet_core_outcome_set_exists boolean,
  comet_core_outcome_set_adherence_rate numeric,
  last_computed_at timestamptz default now()
);
```

### Ingestion job (Phase 0 deliverable)

1. Weekly scheduled function (Vercel Cron or Supabase Edge Function).
2. Pull the WHO ICTRP CSV/XML bulk export (official free download route — do not attempt to scrape `ctri.nic.in`'s search interface directly, it is CAPTCHA-protected).
3. Filter to `Primary Registry = CTRI` AND `Type of Study = Ayurveda`.
4. Upsert into `trials_raw` on `ctri_id`, updating `last_updated_at`.
5. Log ingestion run count (new records, updated records) somewhere visible — even a simple `ingestion_log` table — so pipeline health is checkable without digging into Supabase manually.

### Phase 0 success criteria
- `trials_raw` populated with real CTRI Ayurveda trial data from an actual ICTRP pull (not mock data).
- Weekly ingestion job runs on schedule and upserts correctly on re-run without duplicating rows.
- All secrets confirmed absent from git history before first push.

---

## PHASE 1 — Title-level PICO/T and SPIRIT analysis

### Goal
For every row in `trials_raw`, produce a `title_analysis` row via a Claude API call analyzing the title fields against SPIRIT 2013 Item 1 and PICO/T extraction — using the registry's own structured fields as ground truth, not just the title text in isolation.

### Claude prompt (use verbatim as the starting point, tune after pilot testing)

```
You are analyzing a single Ayurveda clinical trial registration from the Clinical Trials Registry – India (CTRI).
You are given the trial's Scientific Title, Public Title, and structured registry fields (condition, intervention,
study design, sample size). Do not use outside knowledge of the intervention's efficacy — this is a reporting-quality
assessment of the TITLE only, benchmarked against SPIRIT 2013 Item 1, not an efficacy judgment.

Registry data:
Scientific Title: {title_scientific}
Public Title: {title_public}
Study Design (registry field): {study_design}
Condition (registry field): {condition}
Intervention (registry field): {intervention}
Study Type: {study_type}

Task:
1. Extract PICO/T from the title text alone (Population, Intervention, Comparator, Outcome, Timing) —
   mark each element Present, Implied, or Absent based on the title wording, not the registry fields.
2. State whether the title identifies the study design, per SPIRIT Item 1.
3. Compare the title's stated/implied design against the registry's Study Design field —
   report match, mismatch, or title_underspecified.
4. Assess intervention specificity: named formulation vs vague descriptor.
5. Flag dual-nomenclature cases (classical Ayurvedic diagnostic term used without any biomedical
   condition label anywhere in the provided fields).
6. Return ONLY a JSON object matching this schema, no preamble or commentary:

{
  "population": "present|implied|absent",
  "intervention": "present|implied|absent",
  "comparator": "present|implied|absent",
  "outcome": "present|implied|absent",
  "timing": "present|implied|absent",
  "design_identified_in_title": true/false,
  "design_title_vs_registry_match": "match|mismatch|title_underspecified",
  "intervention_specificity": "named_formulation|vague_descriptor",
  "dual_nomenclature_flag": true/false,
  "spirit_item1_compliance": "compliant|partial|non_compliant",
  "notes": ""
}
```

### Build steps
1. Batch job (can run as part of or right after ingestion) — for every `trials_raw` row without a corresponding `title_analysis` row, call Claude with the above prompt, parse the JSON, upsert into `title_analysis`.
2. Handle parse failures gracefully — log the raw model output for manual review rather than silently dropping the row.
3. Build a minimal Next.js dashboard view: table of trials with SPIRIT compliance status, filterable by compliance level and by design-mismatch flag.

### Phase 1 success criteria
- Pilot batch of ~100 real CTRI Ayurveda trials run through the module with valid, parseable JSON output for every trial.
- Spot-check a sample of `non_compliant` and `mismatch` flags manually against the actual CTRI record to confirm the model's calls are sound before trusting it at scale.

---

## PHASE 2 — Methods, sample size, outcome measures

### Goal
For every trial with a completed `title_analysis`, produce a `methods_analysis` row plus one or more `trial_outcomes` rows, using the structured randomization/blinding/outcome fields already present in `trials_raw`.

### Claude prompt (methods/outcomes module)

```
You are analyzing the methodology fields of a single Ayurveda clinical trial registration from CTRI.
Use only the fields provided below — do not assess statistical test correctness, since CTRI registrations
do not capture a statistical analysis plan.

Registry data:
Study Design: {study_design}
Randomization Method: {randomization_method}
Allocation Concealment: {allocation_concealment}
Blinding: {blinding}
Comparator: {comparator}
Target Sample Size (Total): {target_sample_size_total}
Target Sample Size (India): {target_sample_size_india}
Brief Summary: {brief_summary}
Primary Outcomes: {primary_outcomes}
Secondary Outcomes: {secondary_outcomes}

Task:
1. Classify sequence generation: adequate (random number table, computer-generated, stratified/permuted
   block) | higher_risk_method (coin toss, lottery, card shuffling) | not_randomized | not_reported.
2. Classify allocation concealment: adequate (central allocation, sealed opaque envelopes, pharmacy-controlled)
   | inadequate (open list, alternation, date-of-birth) | not_reported.
3. Record blinding level as stated. Flag "open_label_despite_placebo_comparator" if blinding is open label
   but a placebo/sham comparator is named.
4. Search Brief Summary text for sample-size-justification markers (power, effect size, alpha, pilot study
   reference). Report present_in_summary or absent_from_summary — do not infer a justification that isn't
   textually present.
5. For each primary and secondary outcome listed, classify as: validated_standard_instrument |
   objective_biomarker | investigator_devised_unvalidated | classical_ayurvedic_parameter |
   modified_validated_instrument. Base this on whether the named outcome matches a known validated
   instrument — if uncertain, default to investigator_devised_unvalidated and note the uncertainty,
   do not assume validation.
6. Set statistical_test_reported to false and statistical_test_appropriateness to
   "not_assessable_from_registration" — this is fixed for all Phase 2 output, not something to assess here.
7. Return ONLY a JSON object matching the methods_analysis and trial_outcomes schema. No preamble.
```

### Build steps
1. Batch job over trials with completed `title_analysis`, populate `methods_analysis`.
2. For each outcome named, populate `trial_outcomes` rows; attempt a match against `instrument_reference` (initially near-empty — see below) via fuzzy string match on `instrument_full_name`, falling back to Claude's own classification when no reference match exists.
3. **Seed `instrument_reference`** with the worked-example instruments already identified (WOMAC, VAS_PAIN, PASI, DLQI, HAM_D, PHQ_9, MMSE, SF_36, IPSS, ODI, KOOS, ACR20/50/70, HbA1c) as a starting point — this table is meant to grow, not be complete at launch.
4. Build the `condition_fragmentation_report` as a scheduled aggregation job: group `trial_outcomes` by `condition_icd10_category`, count distinct instruments, compute validated/unvalidated shares.
5. Dashboard: add a per-condition fragmentation view — this is the output most directly answering "why do two trials on the same disease use two different scales."

### Phase 2 success criteria
- Randomization/blinding/outcome classification runs cleanly on the same pilot batch used in Phase 1.
- `condition_fragmentation_report` produces a sensible, human-readable summary for at least 2–3 conditions with enough trial volume to be meaningful (e.g., diabetes, osteoarthritis).
- Manual spot-check confirms outcome classifications are defensible, particularly the investigator_devised_unvalidated calls, since this is the most consequential and error-prone category.

---

## Roadmap note (not part of this build — Phase 3, later)

CTRI-to-publication matching (via Europe PMC's free full-text API, searching for the literal CTRI ID string in published papers) is the prerequisite for the statistical-test-correctness analysis. This is intentionally out of scope for Phase 0–2 and should only be scoped once Phase 2 is validated on real data.

## General instructions for Claude Code across all phases

- Every JSON-returning Claude call must be wrapped in try/catch with graceful handling of malformed output — log and skip, never crash the batch job.
- Prefer batching trial analysis in small chunks (e.g., 10–20 at a time) with rate-limit-aware delays, not a single massive loop.
- No trial should be silently dropped from any table — every failure state (parse error, no match found, missing field) should be logged, not swallowed.
- Keep the dashboard minimal and functional for Phase 0–2 — a working data table and the fragmentation view are sufficient; visual polish can come later.
