/**
 * Thin client for the Semantic Scholar Academic Graph API (free, no auth
 * required for basic use). ~200M papers across all disciplines, including
 * pharmacology/physiology — used here for a herb-literature search
 * independent of the CTRI trial-matching pipeline, since a herb's
 * pharmacology isn't tied to any one registered trial.
 *
 * Real characteristic found live: the unauthenticated pool is shared
 * globally and can return 429 under load even for a single request — an
 * optional SEMANTIC_SCHOLAR_API_KEY env var (free, self-service request at
 * semanticscholar.org/product/api) raises the rate limit if this becomes a
 * problem in practice; not required to ship the feature.
 */

const BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "title,abstract,year,venue,authors,externalIds,openAccessPdf";

export interface SemanticScholarPaper {
  paperId: string;
  title: string | null;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  authors: string[];
  doi: string | null;
  url: string;
  openAccessPdfUrl: string | null;
}

interface RawAuthor {
  name?: string;
}

interface RawPaper {
  paperId: string;
  title?: string;
  abstract?: string;
  year?: number;
  venue?: string;
  authors?: RawAuthor[];
  externalIds?: { DOI?: string };
  openAccessPdf?: { url?: string };
}

function parsePaper(r: RawPaper): SemanticScholarPaper {
  return {
    paperId: r.paperId,
    title: r.title ?? null,
    abstract: r.abstract ?? null,
    year: r.year ?? null,
    venue: r.venue ?? null,
    authors: (r.authors ?? []).map((a) => a.name).filter((n): n is string => !!n),
    doi: r.externalIds?.DOI ?? null,
    url: `https://www.semanticscholar.org/paper/${r.paperId}`,
    openAccessPdfUrl: r.openAccessPdf?.url ?? null,
  };
}

export async function searchPapers(query: string, { limit = 20 }: { limit?: number } = {}): Promise<SemanticScholarPaper[]> {
  const url = `${BASE}/paper/search?query=${encodeURIComponent(query)}&fields=${FIELDS}&limit=${limit}`;
  const headers: Record<string, string> = { "User-Agent": "AyurPramanaSetu research tool" };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;

  const res = await fetch(url, { headers });
  if (res.status === 429) {
    throw new Error("Semantic Scholar is rate-limiting unauthenticated requests right now — try again shortly.");
  }
  if (!res.ok) throw new Error(`Semantic Scholar search failed for "${query}": ${res.status}`);
  const data = (await res.json()) as { data?: RawPaper[] };
  return (data.data ?? []).map(parsePaper);
}
