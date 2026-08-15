-- Captures the registry's own description of how an outcome is scored or
-- graded (e.g. "0 to 3 signifying none, mild, moderate, or severe"), when
-- the registration states it — distinct from outcome_name, which is
-- Claude's short label for the outcome, not its grading definition. Most
-- useful for investigator_devised_unvalidated outcomes: the grading
-- definition, not just the outcome's name, is often the only way to judge
-- whether it constitutes a real measurement (e.g. a Shoola/pain scale
-- scored 0-3 with no validation behind those grade boundaries).
alter table trial_outcomes
  add column if not exists assessment_criteria_text text;
