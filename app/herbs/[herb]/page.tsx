import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { searchPapers, SemanticScholarPaper } from "@/lib/semanticscholar/client";

export const dynamic = "force-dynamic";

export default async function HerbDetailPage({ params }: { params: Promise<{ herb: string }> }) {
  const { herb: herbParam } = await params;
  const herbName = decodeURIComponent(herbParam);

  const supabase = supabaseAdmin();
  const { data: rows } = await supabase
    .from("trial_herbs")
    .select("ctri_id, scientific_name, source_text, trials_raw(title_public, title_scientific)")
    .ilike("herb_name", herbName);
  if (!rows || rows.length === 0) notFound();

  const scientificName = rows.find((r) => r.scientific_name)?.scientific_name ?? null;
  const trials = rows.map((r) => ({
    ctriId: r.ctri_id,
    sourceText: r.source_text,
    trial: Array.isArray(r.trials_raw) ? r.trials_raw[0] : r.trials_raw,
  }));

  const searchQuery = scientificName ? `${scientificName} ${herbName} pharmacology` : `${herbName} pharmacology`;
  let papers: SemanticScholarPaper[] = [];
  let searchError: string | null = null;
  try {
    papers = await searchPapers(searchQuery, { limit: 20 });
  } catch (e) {
    searchError = (e as Error).message;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/herbs" className="text-sm text-stone-500 hover:text-stone-800">
        ← Back to herb list
      </Link>

      <div className="mt-3">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{herbName}</h1>
        {scientificName && <p className="mt-1 text-sm italic text-stone-500">{scientificName}</p>}
      </div>

      {/* Trials in this corpus */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-900">
          Registered trials using {herbName} ({trials.length})
        </h2>
        <ul className="mt-3 divide-y divide-stone-100">
          {trials.map((t) => (
            <li key={t.ctriId} className="py-2 text-sm">
              <Link href={`/trials/${t.ctriId}`} className="font-medium text-stone-800 hover:underline">
                {t.trial?.title_public ?? t.trial?.title_scientific ?? t.ctriId}
              </Link>
              {t.sourceText && <p className="mt-0.5 text-xs text-stone-500">&ldquo;{t.sourceText}&rdquo;</p>}
            </li>
          ))}
        </ul>
      </section>

      {/* Independent literature */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-900">
          Pharmacology / physiology literature (via Semantic Scholar)
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          Independent search, not limited to papers about a specific registered trial. Query: &ldquo;{searchQuery}&rdquo;
        </p>

        {searchError ? (
          <p className="mt-3 text-sm text-rose-600">{searchError}</p>
        ) : papers.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No results found.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {papers.map((p) => (
              <div key={p.paperId} className="rounded-md border border-stone-100 p-3">
                <a
                  href={p.openAccessPdfUrl ?? p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-stone-900 hover:underline"
                >
                  {p.title ?? "Untitled"} ↗
                </a>
                <p className="mt-0.5 text-xs text-stone-500">
                  {p.venue ? `${p.venue} · ` : ""}
                  {p.year ?? ""}
                  {p.authors.length ? ` · ${p.authors.slice(0, 3).join(", ")}${p.authors.length > 3 ? " et al." : ""}` : ""}
                </p>
                {p.abstract && <p className="mt-2 line-clamp-3 text-sm text-stone-700">{p.abstract}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
