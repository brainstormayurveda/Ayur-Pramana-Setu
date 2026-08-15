-- Phase 3: CTRI-to-publication matching + registered-vs-published comparison.
-- Tracks whether we've searched a trial yet (separate from whether a match
-- was found), since "searched, no publication found" is itself meaningful
-- and shouldn't cause repeated re-searching on every ingest run.
alter table trials_raw add column if not exists publication_search_completed_at timestamptz;

create table if not exists trial_publications (
  id uuid primary key default gen_random_uuid(),
  ctri_id text references trials_raw(ctri_id),
  europepmc_id text not null,
  source text, -- MED|PPR|PMC|... (Europe PMC's own source registry code)
  pmid text,
  pmcid text,
  doi text,
  title text,
  author_string text,
  journal text,
  pub_year int,
  first_publication_date date,
  pub_types text, -- comma-joined, e.g. "Journal Article,Randomized Controlled Trial"
  abstract text,
  is_open_access boolean,
  source_url text not null,
  matched_query text, -- the CTRI ID string searched, for audit

  -- Claude's registered-vs-published comparison (nullable until analyzed)
  is_primary_report boolean, -- true = this looks like the trial's own results paper; false = a citation/review that merely mentions the registration
  outcome_switching_flag boolean,
  limitations_disclosed boolean,
  framing_assessment text, -- appropriately_cautious|overstated|consistent|not_assessable
  comparison_notes text,
  comparison_analyzed_at timestamptz,

  ingested_at timestamptz default now(),
  unique (ctri_id, europepmc_id)
);

alter table trial_publications enable row level security;
create policy "public read trial_publications" on trial_publications for select using (true);
