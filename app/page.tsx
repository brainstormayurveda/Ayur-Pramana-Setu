import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface TrialRow {
  ctri_id: string;
  title_public: string | null;
  title_scientific: string | null;
  condition: string | null;
  recruitment_status: string | null;
  registration_date: string | null;
  publication_search_completed_at: string | null;
  title_analysis: {
    spirit_item1_compliance: string | null;
    design_title_vs_registry_match: string | null;
    dual_nomenclature_flag: boolean | null;
  } | null;
}

interface SearchParams {
  compliance?: string;
  mismatch?: string;
  q?: string;
  from?: string;
  to?: string;
}

const COMPLIANCE_STYLES: Record<string, string> = {
  compliant: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  non_compliant: "bg-rose-100 text-rose-800",
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-5 py-4">
      <div className="text-2xl font-semibold text-stone-900">{value}</div>
      <div className="text-sm text-stone-500">{label}</div>
    </div>
  );
}

/** Preserve the other active filters when toggling one link-based filter. */
function filterHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function TrialsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { compliance, mismatch, q, from, to } = sp;
  const supabase = supabaseAdmin();

  const [{ count: totalTrials }, { count: analyzedCount }, { count: ayurvedaCount }] = await Promise.all([
    supabase.from("trials_raw").select("*", { count: "exact", head: true }),
    supabase.from("title_analysis").select("*", { count: "exact", head: true }),
    supabase.from("trials_raw").select("*", { count: "exact", head: true }).eq("is_ayurveda_trial", true),
  ]);

  let query = supabase
    .from("trials_raw")
    .select(
      "ctri_id, title_public, title_scientific, condition, recruitment_status, registration_date, publication_search_completed_at, title_analysis(spirit_item1_compliance, design_title_vs_registry_match, dual_nomenclature_flag)"
    )
    .order("registration_date", { ascending: false, nullsFirst: false })
    .limit(500);

  if (q) {
    const term = q.trim();
    query = query.or(
      `title_public.ilike.%${term}%,title_scientific.ilike.%${term}%,condition.ilike.%${term}%,ctri_id.ilike.%${term}%`
    );
  }
  if (from) query = query.gte("registration_date", from);
  if (to) query = query.lte("registration_date", to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const { data: pubRows, error: pubError } = await supabase.from("trial_publications").select("ctri_id");
  if (pubError) throw new Error(pubError.message);
  const trialsWithPublication = new Set((pubRows ?? []).map((r) => r.ctri_id));

  let trials = (data ?? []) as unknown as TrialRow[];
  // Normalize the embedded relation: PostgREST returns a single object for
  // this PK-based 1:1 FK, but supabase-js infers it as an array without
  // generated DB types.
  trials = trials.map((t) => ({
    ...t,
    title_analysis: Array.isArray(t.title_analysis) ? (t.title_analysis[0] ?? null) : t.title_analysis,
  }));

  if (compliance) {
    trials = trials.filter((t) => t.title_analysis?.spirit_item1_compliance === compliance);
  }
  if (mismatch === "1") {
    trials = trials.filter((t) => t.title_analysis?.design_title_vs_registry_match === "mismatch");
  }

  const hasAnyFilter = compliance || mismatch || q || from || to;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trial-level evidence audit</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Ayurveda clinical trials registered on CTRI (via WHO ICTRP), assessed against SPIRIT 2013 Item 1
            title-reporting standards. Read-only research tool — not an efficacy judgment on any intervention.
          </p>
        </div>
        <Link
          href="/admin"
          className="whitespace-nowrap rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100"
        >
          Run analysis →
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Trials ingested" value={totalTrials ?? 0} />
        <StatCard label="Ayurveda-flagged" value={ayurvedaCount ?? 0} />
        <StatCard label="Title-analyzed" value={analyzedCount ?? 0} />
        <StatCard label="Pending analysis" value={(totalTrials ?? 0) - (analyzedCount ?? 0)} />
      </div>

      {/* Search + date range */}
      <form method="GET" className="mt-8 flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-4 text-sm">
        {compliance && <input type="hidden" name="compliance" value={compliance} />}
        {mismatch && <input type="hidden" name="mismatch" value={mismatch} />}
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-stone-500">Search title / condition / CTRI ID</label>
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="e.g. diabetes, Ashwagandha, CTRI/2025..."
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500">Registered from</label>
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            className="mt-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500">Registered to</label>
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            className="mt-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>
        <button type="submit" className="rounded-md bg-stone-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700">
          Search
        </button>
        {hasAnyFilter && (
          <Link href="/" className="text-sm text-stone-500 underline hover:text-stone-800">
            clear all
          </Link>
        )}
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-stone-700">SPIRIT compliance:</span>
        {["compliant", "partial", "non_compliant"].map((c) => (
          <Link
            key={c}
            href={filterHref(sp, { compliance: compliance === c ? undefined : c })}
            className={`rounded-full px-3 py-1 ${compliance === c ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
          >
            {c.replace("_", " ")}
          </Link>
        ))}
        <Link
          href={filterHref(sp, { mismatch: mismatch === "1" ? undefined : "1" })}
          className={`rounded-full px-3 py-1 ${mismatch === "1" ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
        >
          design mismatch only
        </Link>
        <span className="text-stone-400">{trials.length} shown</span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">CTRI ID</th>
              <th className="px-4 py-3">Public Title</th>
              <th className="px-4 py-3">Condition</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">SPIRIT Item 1</th>
              <th className="px-4 py-3">Design match</th>
              <th className="px-4 py-3">Publication (Europe PMC)</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((t) => (
              <tr key={t.ctri_id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="px-4 py-3 font-mono text-xs text-stone-500">
                  <Link href={`/trials/${t.ctri_id}`} className="hover:underline">
                    {t.ctri_id}
                  </Link>
                </td>
                <td className="max-w-xs px-4 py-3">
                  <Link href={`/trials/${t.ctri_id}`} className="hover:underline">
                    {t.title_public ?? t.title_scientific ?? "—"}
                  </Link>
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-stone-600">{t.condition ?? "—"}</td>
                <td className="px-4 py-3 text-stone-600">{t.recruitment_status ?? "—"}</td>
                <td className="px-4 py-3">
                  {t.title_analysis?.spirit_item1_compliance ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${COMPLIANCE_STYLES[t.title_analysis.spirit_item1_compliance] ?? "bg-stone-100 text-stone-600"}`}
                    >
                      {t.title_analysis.spirit_item1_compliance.replace("_", " ")}
                    </span>
                  ) : (
                    <span className="text-xs text-stone-400">not yet analyzed</span>
                  )}
                </td>
                <td className="px-4 py-3 text-stone-600">
                  {t.title_analysis?.design_title_vs_registry_match === "mismatch" ? (
                    <span className="font-medium text-rose-700">mismatch</span>
                  ) : (
                    (t.title_analysis?.design_title_vs_registry_match ?? "—")
                  )}
                </td>
                <td className="px-4 py-3">
                  {trialsWithPublication.has(t.ctri_id) ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      found
                    </span>
                  ) : t.publication_search_completed_at ? (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                      not found
                    </span>
                  ) : (
                    <span className="text-xs text-stone-400">not yet searched</span>
                  )}
                </td>
              </tr>
            ))}
            {trials.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  No trials match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
