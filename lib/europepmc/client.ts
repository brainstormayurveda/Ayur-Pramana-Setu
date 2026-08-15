/**
 * Thin client for the Europe PMC REST API (free, no auth required).
 * Indexes PubMed, PubMed Central (open-access full text), and preprints —
 * used here to find published papers that cite a trial's CTRI registration
 * number, per the Phase 3 roadmap note in the original build brief.
 *
 * Verified live: exact-phrase search on the CTRI ID string works and finds
 * real matches, but is noisy — a match can be the trial's own results
 * paper, OR a review/registry-listing article that merely *cites* the ID
 * in passing. That distinction is handled downstream by Claude (see
 * lib/claude/publication-comparison.ts), not filtered here.
 */

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export interface EuropePmcResult {
  europepmcId: string;
  source: string | null;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  title: string | null;
  authorString: string | null;
  journal: string | null;
  pubYear: number | null;
  firstPublicationDate: string | null;
  pubTypes: string | null;
  abstract: string | null;
  isOpenAccess: boolean;
  sourceUrl: string;
}

interface RawResult {
  id: string;
  source: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  journalInfo?: { journal?: { title?: string } };
  pubYear?: string;
  firstPublicationDate?: string;
  pubTypeList?: { pubType?: string[] };
  abstractText?: string;
  isOpenAccess?: string;
}

function parseResult(r: RawResult): EuropePmcResult {
  return {
    europepmcId: r.id,
    source: r.source ?? null,
    pmid: r.pmid ?? null,
    pmcid: r.pmcid ?? null,
    doi: r.doi ?? null,
    title: r.title ?? null,
    authorString: r.authorString ?? null,
    journal: r.journalInfo?.journal?.title ?? null,
    pubYear: r.pubYear ? parseInt(r.pubYear, 10) : null,
    firstPublicationDate: r.firstPublicationDate ?? null,
    pubTypes: r.pubTypeList?.pubType?.join(", ") ?? null,
    abstract: r.abstractText ?? null,
    isOpenAccess: r.isOpenAccess === "Y",
    sourceUrl: `https://europepmc.org/article/${r.source}/${r.id}`,
  };
}

export async function searchByTrialId(ctriId: string): Promise<EuropePmcResult[]> {
  const query = `"${ctriId}"`;
  const url = `${BASE}/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=25`;
  const res = await fetch(url, { headers: { "User-Agent": "AyurPramanaSetu research tool" } });
  if (!res.ok) throw new Error(`Europe PMC search failed for ${ctriId}: ${res.status}`);
  const data = (await res.json()) as { hitCount: number; resultList?: { result?: RawResult[] } };
  return (data.resultList?.result ?? []).map(parseResult);
}
