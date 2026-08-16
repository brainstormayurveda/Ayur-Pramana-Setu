-- CONSORT for Abstracts compliance check — the abstract-specific EQUATOR
-- reporting guideline (Hopewell et al. 2008, still the current authoritative
-- version; CONSORT 2025's main statement explicitly says to keep using
-- existing extensions like this one until they're updated to match).
-- Only meaningful for confirmed primary-report papers of randomized trials
-- (matches "reportingGuideline"-style gating used elsewhere for this kind
-- of check) — applied at abstract level since that's the only text we have
-- for matched publications, unlike a full-manuscript reviewer.
create table if not exists publication_reporting_checklist (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid references trial_publications(id),
  guideline text not null default 'consort_for_abstracts',
  item_name text not null,
  reported boolean,
  note text,
  checked_at timestamptz default now()
);

alter table trial_publications
  add column if not exists reporting_checklist_applicable boolean,
  add column if not exists reporting_checklist_guideline text,
  add column if not exists reporting_checklist_items_reported int,
  add column if not exists reporting_checklist_items_total int;

alter table publication_reporting_checklist enable row level security;
create policy "public read publication_reporting_checklist" on publication_reporting_checklist for select using (true);
