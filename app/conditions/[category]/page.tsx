import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildConditionLabelMap } from "@/lib/reports/condition-labels";
import { generateFragmentationNarrative } from "@/lib/reports/narrative";

export const dynamic = "force-dynamic";

const COMPLIANCE_STYLES: Record<string, string> = {
  compliant: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  non_compliant: "bg-rose-100 text-rose-800",
};

function pct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 100)}%`;
}

export default async function ConditionReportPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const supabase = supabaseAdmin();

  const [{ data: row }, labels] = await Promise.all([
    supabase.from("condition_fragmentation_report").select("*").eq("condition_icd10_category", category).maybeSingle(),
    buildConditionLabelMap(),
  ]);
  if (!row) notFound();

  const label = labels.get(category);
  const narrative = generateFragmentationNarrative(row);

  const { data: trials } = await supabase
    .from("trials_raw")
    .select("ctri_id, title_public, title_scientific, registration_date, title_analysis(spirit_item1_compliance)")
    .eq("condition_icd10_category", category)
    .order("registration_date", { ascending: false });

  const trialList = (trials ?? []).map((t) => ({
    ...t,
    title_analysis: Array.isArray(t.title_analysis) ? (t.title_analysis[0] ?? null) : t.title_analysis,
  }));

  const ctriIds = trialList.map((t) => t.ctri_id);
  const { data: outcomes } = ctriIds.length
    ? await supabase
        .from("trial_outcomes")
        .select("outcome_name, outcome_type, classification, matched_instrument_id, assessment_criteria_text, ctri_id")
        .in("ctri_id", ctriIds)
    : { data: [] };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/conditions" className="text-sm text-stone-500 hover:text-stone-800">
        ← Back to fragmentation report
      </Link>

      <div className="mt-3">
        <div className="font-mono text-xs text-stone-500">{category}</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900">
          {label ?? "Unlabeled condition"}
        </h1>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
          <div className="text-xl font-semibold text-stone-900">{row.n_trials}</div>
          <div className="text-xs text-stone-500">Trials</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
          <div className="text-xl font-semibold text-stone-900">{row.distinct_outcome_instruments_used}</div>
          <div className="text-xs text-stone-500">Distinct instruments</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
          <div className="text-xl font-semibold text-stone-900">{pct(row.share_validated)}</div>
          <div className="text-xs text-stone-500">Validated share</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
          <div className="text-xl font-semibold text-stone-900">{pct(row.share_investigator_devised)}</div>
          <div className="text-xs text-stone-500">Investigator-devised</div>
        </div>
      </div>

      {/* Narrative reading */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-900">Reading</h2>
        <div className="mt-3 space-y-3">
          {narrative.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-stone-700">
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* Contributing trials */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-900">Contributing trials ({trialList.length})</h2>
        <ul className="mt-3 divide-y divide-stone-100">
          {trialList.map((t) => (
            <li key={t.ctri_id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link href={`/trials/${t.ctri_id}`} className="flex-1 truncate hover:underline">
                {t.title_public ?? t.title_scientific ?? t.ctri_id}
              </Link>
              {t.title_analysis?.spirit_item1_compliance && (
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COMPLIANCE_STYLES[t.title_analysis.spirit_item1_compliance] ?? "bg-stone-100 text-stone-600"}`}
                >
                  {t.title_analysis.spirit_item1_compliance.replace("_", " ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Outcome measures used */}
      {outcomes && outcomes.length > 0 && (
        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">Outcome measures used across these trials</h2>
          <ul className="mt-3 space-y-2">
            {outcomes.map((o, i) => (
              <li
                key={i}
                className={`rounded-md border px-3 py-2 text-sm ${o.classification === "investigator_devised_unvalidated" ? "border-amber-200 bg-amber-50" : "border-stone-100 bg-stone-50"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-stone-700">
                    <span className="mr-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs uppercase text-stone-600">{o.outcome_type}</span>
                    {o.outcome_name}
                  </span>
                  <span className="whitespace-nowrap text-xs text-stone-500">
                    {o.classification?.replace(/_/g, " ")}
                    {o.matched_instrument_id ? ` · ${o.matched_instrument_id}` : ""}
                  </span>
                </div>
                {o.assessment_criteria_text && (
                  <p className="mt-1.5 text-xs italic text-stone-600">Registered grading: {o.assessment_criteria_text}</p>
                )}
                <Link href={`/trials/${o.ctri_id}`} className="mt-1 inline-block font-mono text-xs text-stone-400 hover:text-stone-700 hover:underline">
                  {o.ctri_id}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
