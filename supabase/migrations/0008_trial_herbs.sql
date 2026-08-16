-- Extracted herb/plant-derived ingredients per trial, pulled from the
-- registered intervention text. Separate table (not an array column) so a
-- herb can be looked up across trials and linked out to external
-- pharmacology/physiology literature searches (Semantic Scholar) by name.
create table if not exists trial_herbs (
  id uuid primary key default gen_random_uuid(),
  ctri_id text references trials_raw(ctri_id),
  herb_name text not null, -- normalized common name, e.g. "Ashwagandha"
  scientific_name text, -- Latin binomial if identifiable, e.g. "Withania somnifera"
  source_text text, -- the intervention snippet this was extracted from
  extracted_at timestamptz default now()
);

alter table trials_raw add column if not exists herb_extraction_completed_at timestamptz;

alter table trial_herbs enable row level security;
create policy "public read trial_herbs" on trial_herbs for select using (true);
