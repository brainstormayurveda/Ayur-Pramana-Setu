-- Inclusion/exclusion criteria are present on WHO ICTRP's trial detail page
-- (confirmed live) but weren't being parsed — they render as a labeled
-- <span> rather than either of the two row shapes the scraper already
-- handles. Split into two columns rather than reusing the pre-existing,
-- never-populated trials_raw.inclusion_exclusion column, since keeping
-- them separate is more useful for display.
alter table trials_raw
  add column if not exists inclusion_criteria text,
  add column if not exists exclusion_criteria text;
