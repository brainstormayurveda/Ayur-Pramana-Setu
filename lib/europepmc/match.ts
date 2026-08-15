import { supabaseAdmin } from "@/lib/supabase/admin";
import { searchByTrialId } from "./client";

const SEARCH_DELAY_MS = 400;

export interface MatchPublicationsResult {
  trialsSearched: number;
  publicationsFound: number;
  errors: string[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * For every trial not yet searched, queries Europe PMC for its CTRI ID and
 * upserts any matches into trial_publications. Marks the trial as searched
 * regardless of outcome, so re-runs only cover trials not yet checked —
 * re-search old trials periodically by clearing publication_search_completed_at
 * if a "check for newly published papers" pass is ever wanted.
 */
export async function matchPublications({ limit = 100 }: { limit?: number } = {}): Promise<MatchPublicationsResult> {
  const supabase = supabaseAdmin();

  const { data: trials, error } = await supabase
    .from("trials_raw")
    .select("ctri_id")
    .is("publication_search_completed_at", null)
    .order("ingested_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load trials_raw: ${error.message}`);

  const result: MatchPublicationsResult = { trialsSearched: 0, publicationsFound: 0, errors: [] };

  for (const trial of trials ?? []) {
    try {
      const matches = await searchByTrialId(trial.ctri_id);
      for (const m of matches) {
        const { error: upsertErr } = await supabase.from("trial_publications").upsert(
          {
            ctri_id: trial.ctri_id,
            europepmc_id: m.europepmcId,
            source: m.source,
            pmid: m.pmid,
            pmcid: m.pmcid,
            doi: m.doi,
            title: m.title,
            author_string: m.authorString,
            journal: m.journal,
            pub_year: m.pubYear,
            first_publication_date: m.firstPublicationDate,
            pub_types: m.pubTypes,
            abstract: m.abstract,
            is_open_access: m.isOpenAccess,
            source_url: m.sourceUrl,
            matched_query: trial.ctri_id,
          },
          { onConflict: "ctri_id,europepmc_id" }
        );
        if (upsertErr) {
          result.errors.push(`${trial.ctri_id} / ${m.europepmcId}: ${upsertErr.message}`);
        } else {
          result.publicationsFound++;
        }
      }

      await supabase
        .from("trials_raw")
        .update({ publication_search_completed_at: new Date().toISOString() })
        .eq("ctri_id", trial.ctri_id);
      result.trialsSearched++;
    } catch (e) {
      result.errors.push(`${trial.ctri_id}: ${(e as Error).message}`);
    }
    await sleep(SEARCH_DELAY_MS);
  }

  return result;
}
