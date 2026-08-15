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
  title_analysis: {
    spirit_item1_compliance: string | null;
    design_title_vs_registry_match: string | null;
    dual_nomenclature_flag: boolean | null;
  } | null;
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

export default async function TrialsPage({
  searchParams,
}: {
  searchParams: Promise<{ compliance?: string; mismatch?: string }>;
}) {
  const { compliance, mismatch } = await searchParams;
  const supabase = supabaseAdmin();

  const [{ count: totalTrials }, { count: analyzedCount }, { count: ayurvedaCount }] = await Promise.all([
    supabase.from("trials_raw").select("*", { count: "exact", head: true }),
    supabase.from("title_analysis").select("*", { count: "exact", head: true }),
    supabase.from("trials_raw").select("*", { count: "exact", head: true }).eq("is_ayurveda_trial", true),
  ]);

  let query = supabase
    .from("trials_raw")
    .select(
      "ctri_id, title_public, title_scientific, condition, recruitment_status, registration_date, title_analysis(spirit_item1_compliance, design_title_vs_registry_match, dual_nomenclature_flag)"
    )
    .order("registration_date", { ascending: false, nullsFirst: false })
    .limit(200);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

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

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Trial-level evidence audit</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        Ayurveda clinical trials registered on CTRI (via WHO ICTRP), assessed against SPIRIT 2013 Item 1
        title-reporting standards. Read-only research tool — not an efficacy judgment on any intervention.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Trials ingested" value={totalTrials ?? 0} />
        <StatCard label="Ayurveda-flagged" value={ayurvedaCount ?? 0} />
        <StatCard label="Title-analyzed" value={analyzedCount ?? 0} />
        <StatCard label="Pending analysis" value={(totalTrials ?? 0) - (analyzedCount ?? 0)} />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-stone-700">Filter by SPIRIT compliance:</span>
        {["compliant", "partial", "non_compliant"].map((c) => (
          <Link
            key={c}
            href={`/?compliance=${c}${mismatch === "1" ? "&mismatch=1" : ""}`}
            className={`rounded-full px-3 py-1 ${compliance === c ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
          >
            {c.replace("_", " ")}
          </Link>
        ))}
        <Link
          href={mismatch === "1" ? `/${compliance ? `?compliance=${compliance}` : ""}` : `/?mismatch=1${compliance ? `&compliance=${compliance}` : ""}`}
          className={`rounded-full px-3 py-1 ${mismatch === "1" ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-700 hover:bg-stone-300"}`}
        >
          design mismatch only
        </Link>
        {(compliance || mismatch) && (
          <Link href="/" className="text-stone-500 underline hover:text-stone-800">
            clear filters
          </Link>
        )}
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
            </tr>
          </thead>
          <tbody>
            {trials.map((t) => (
              <tr key={t.ctri_id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="px-4 py-3 font-mono text-xs text-stone-500">{t.ctri_id}</td>
                <td className="max-w-xs px-4 py-3">{t.title_public ?? t.title_scientific ?? "—"}</td>
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
              </tr>
            ))}
            {trials.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
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
