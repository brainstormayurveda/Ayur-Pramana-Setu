-- CTRI registration (as exposed via WHO ICTRP) never states a planned
-- statistical method, so there's nothing registered to check a published
-- paper's analysis against directly. Instead, this judges whether the
-- statistical test *stated in the published paper* fits what the
-- registered primary outcome's data type (ordinal/continuous/binary, from
-- trial_outcomes.classification + assessment_criteria_text) and study
-- design actually call for.
alter table trial_publications
  add column if not exists statistical_test_stated text,
  add column if not exists statistical_test_assessment text, -- appropriate|questionable|not_stated|not_assessable
  add column if not exists statistical_test_notes text;
