-- AyurPramanaSetu Phase 0 schema
-- Raw ingested trial records from ICTRP, filtered to CTRI + Ayurveda
create table if not exists trials_raw (
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
  -- Not carried by WHO ICTRP's common data set (CTRI-specific classification);
  -- populated by keyword pre-filter at scrape time, refined by Claude in Phase 1.
  is_ayurveda_trial boolean,
  ayurveda_classification_confidence text, -- keyword_match|claude_confirmed|claude_rejected
  ingested_at timestamptz default now(),
  last_updated_at timestamptz default now()
);

-- Phase 1 output: title-level PICO/T and SPIRIT analysis
create table if not exists title_analysis (
  ctri_id text primary key references trials_raw(ctri_id),
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
  analyzed_at timestamptz default now()
);

-- Reference table of validated outcome instruments (seeded, grows over time)
create table if not exists instrument_reference (
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

-- Phase 2 output: randomization, sample size, outcome classification
create table if not exists methods_analysis (
  ctri_id text primary key references trials_raw(ctri_id),
  sequence_generation text, -- adequate|higher_risk_method|not_randomized|not_reported
  allocation_concealment_class text, -- adequate|inadequate|not_reported
  blinding_class text,
  internal_consistency_flag text,
  sample_size_target_total int,
  sample_size_target_india int,
  sample_size_justification text, -- present_in_summary|absent_from_summary
  statistical_test_reported boolean default false,
  statistical_test_appropriateness text default 'not_assessable_from_registration',
  analyzed_at timestamptz default now()
);

-- Outcome instruments used per trial (one row per outcome, trial can have multiple)
create table if not exists trial_outcomes (
  id uuid primary key default gen_random_uuid(),
  ctri_id text references trials_raw(ctri_id),
  outcome_name text,
  outcome_type text, -- primary|secondary
  classification text, -- validated_standard_instrument|objective_biomarker|investigator_devised_unvalidated|classical_ayurvedic_parameter|modified_validated_instrument
  matched_instrument_id text references instrument_reference(instrument_id),
  matched_comet_core_outcome_set boolean default false
);

-- Corpus-level aggregate: measurement fragmentation per condition
create table if not exists condition_fragmentation_report (
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

-- Ingestion run visibility (Phase 0 success criterion: pipeline health checkable without digging into Supabase)
create table if not exists ingestion_log (
  id uuid primary key default gen_random_uuid(),
  run_started_at timestamptz not null default now(),
  run_finished_at timestamptz,
  source text not null default 'ictrp_who_search_portal',
  new_records int default 0,
  updated_records int default 0,
  failed_records int default 0,
  status text not null default 'running', -- running|success|partial_failure|failed
  error_detail text
);

-- RLS: enable on every table; public read-only. All writes happen server-side
-- via the service-role key, which bypasses RLS entirely.
alter table trials_raw enable row level security;
alter table title_analysis enable row level security;
alter table instrument_reference enable row level security;
alter table methods_analysis enable row level security;
alter table trial_outcomes enable row level security;
alter table condition_fragmentation_report enable row level security;
alter table ingestion_log enable row level security;

create policy "public read trials_raw" on trials_raw for select using (true);
create policy "public read title_analysis" on title_analysis for select using (true);
create policy "public read instrument_reference" on instrument_reference for select using (true);
create policy "public read methods_analysis" on methods_analysis for select using (true);
create policy "public read trial_outcomes" on trial_outcomes for select using (true);
create policy "public read condition_fragmentation_report" on condition_fragmentation_report for select using (true);
create policy "public read ingestion_log" on ingestion_log for select using (true);

-- Seed instrument_reference with the brief's worked-example instruments
insert into instrument_reference (instrument_id, instrument_full_name, domain, applicable_conditions, validation_citation, scoring_type, score_range, mcid_known, mcid_value, comet_core_outcome_set_member, source)
values
  ('WOMAC', 'Western Ontario and McMaster Universities Osteoarthritis Index', 'pain/function/stiffness', 'osteoarthritis (knee, hip)', 'Bellamy et al. 1988, J Rheumatol', 'likert_summed', '0-96 (or 0-100 normalized)', true, '~9-12 points (varies by subscale)', true, 'seed'),
  ('VAS_PAIN', 'Visual Analogue Scale for Pain', 'pain', 'general pain, multiple conditions', 'Huskisson 1974, Lancet', 'continuous', '0-100mm or 0-10', true, '~10-20mm (varies)', true, 'seed'),
  ('PASI', 'Psoriasis Area and Severity Index', 'dermatology severity', 'psoriasis', 'Fredriksson & Pettersson 1978', 'composite', '0-72', true, '75% reduction (PASI75) commonly used', true, 'seed'),
  ('DLQI', 'Dermatology Life Quality Index', 'quality of life', 'dermatological conditions', 'Finlay & Khan 1994', 'summed', '0-30', true, '4 points', true, 'seed'),
  ('HAM_D', 'Hamilton Depression Rating Scale', 'depression severity', 'depression', 'Hamilton 1960', 'clinician_rated_summed', '0-52 (17-item version 0-52)', true, '~3 points', true, 'seed'),
  ('PHQ_9', 'Patient Health Questionnaire-9', 'depression severity', 'depression', 'Kroenke et al. 2001', 'self_report_summed', '0-27', true, '5 points', true, 'seed'),
  ('MMSE', 'Mini-Mental State Examination', 'cognitive function', 'cognitive impairment, dementia', 'Folstein et al. 1975', 'summed', '0-30', true, '1-3 points', false, 'seed'),
  ('SF_36', 'Short Form 36 Health Survey', 'general health-related quality of life', 'general/multiple conditions', 'Ware & Sherbourne 1992', 'multi_domain_scored', '0-100 per domain', true, '~5 points per domain (varies)', true, 'seed'),
  ('IPSS', 'International Prostate Symptom Score', 'urinary symptoms', 'benign prostatic hyperplasia', 'Barry et al. 1992', 'summed', '0-35', true, '3 points', true, 'seed'),
  ('ODI', 'Oswestry Disability Index', 'disability/function', 'low back pain', 'Fairbank et al. 1980', 'percentage', '0-100%', true, '10 percentage points', true, 'seed'),
  ('KOOS', 'Knee injury and Osteoarthritis Outcome Score', 'pain/function/quality of life', 'knee injury, osteoarthritis', 'Roos et al. 1998', 'multi_subscale_0_100', '0-100 per subscale', true, '8-10 points (varies by subscale)', true, 'seed'),
  ('ACR20', 'American College of Rheumatology 20% Improvement Criteria', 'composite response', 'rheumatoid arthritis', 'Felson et al. 1995', 'binary_response', 'responder/non-responder', false, null, true, 'seed'),
  ('ACR50', 'American College of Rheumatology 50% Improvement Criteria', 'composite response', 'rheumatoid arthritis', 'Felson et al. 1995', 'binary_response', 'responder/non-responder', false, null, true, 'seed'),
  ('ACR70', 'American College of Rheumatology 70% Improvement Criteria', 'composite response', 'rheumatoid arthritis', 'Felson et al. 1995', 'binary_response', 'responder/non-responder', false, null, true, 'seed'),
  ('HBA1C', 'Glycated Hemoglobin (HbA1c)', 'objective biomarker', 'diabetes mellitus', 'DCCT/UKPDS standardization', 'lab_measured_percentage', '4-15% typical range', true, '0.3-0.5%', true, 'seed')
on conflict (instrument_id) do nothing;
