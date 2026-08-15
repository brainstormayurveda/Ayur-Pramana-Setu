/**
 * Thin client for the CrossRef REST API (free, no auth). Used by the manual
 * publication-entry flow: Europe PMC's CTRI-ID citation search only finds a
 * real match for a small fraction of trials (see lib/europepmc), so when a
 * user has found the paper themselves (via Google, a journal site,
 * ResearchGate, etc.) and has its DOI, this resolves title/authors/journal/
 * abstract without needing them to retype it all by hand.
 *
 * Verified live: even a small regional publisher (Journal of Ayurveda and
 * Integrated Medical Sciences) has full abstracts on CrossRef, so this isn't
 * limited to major journals.
 */

export interface CrossrefWork {
  doi: string;
  title: string | null;
  authorString: string | null;
  journal: string | null;
  pubYear: number | null;
  pubTypes: string | null;
  abstract: string | null;
  sourceUrl: string;
}

interface RawAuthor {
  given?: string;
  family?: string;
}

interface RawWork {
  title?: string[];
  author?: RawAuthor[];
  "container-title"?: string[];
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  type?: string;
  abstract?: string;
}

function stripJatsTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDoi(input: string): string {
  return input.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

export async function resolveDoi(doiInput: string): Promise<CrossrefWork | null> {
  const doi = cleanDoi(doiInput);
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": "AyurPramanaSetu research tool (mailto:drkembhavikpl@gmail.com)" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CrossRef lookup failed for ${doi}: ${res.status}`);

  const data = (await res.json()) as { message: RawWork };
  const w = data.message;

  const authorString = w.author?.length
    ? w.author.map((a) => [a.given, a.family].filter(Boolean).join(" ")).join(", ")
    : null;

  const year =
    w["published-print"]?.["date-parts"]?.[0]?.[0] ??
    w["published-online"]?.["date-parts"]?.[0]?.[0] ??
    w.issued?.["date-parts"]?.[0]?.[0] ??
    null;

  return {
    doi,
    title: w.title?.[0] ?? null,
    authorString,
    journal: w["container-title"]?.[0] ?? null,
    pubYear: year,
    pubTypes: w.type ?? null,
    abstract: w.abstract ? stripJatsTags(w.abstract) : null,
    sourceUrl: `https://doi.org/${doi}`,
  };
}
