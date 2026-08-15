-- Allow publications added by hand (DOI or free-text title/journal/author),
-- not just ones Europe PMC's CTRI-ID search happened to find.
alter table trial_publications alter column europepmc_id drop not null;

alter table trial_publications
  add column if not exists entry_source text not null default 'europepmc'
    check (entry_source in ('europepmc', 'manual'));
