import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PICOT_LABEL: Record<string, string> = {
  present: "Present",
  implied: "Implied",
  absent: "Absent",
};

const COMPLIANCE_STYLES: Record<string, string> = {
  compliant: "bg-emerald-100 text-emerald-800 border-emerald-300",
  partial: "bg-amber-100 text-amber-800 border-amber-300",
  non_compliant: "bg-rose-100 text-rose-800 border-rose-300",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-stone-800">{value ?? "—"}</dd>
    </div>
  );
}

function PicotBadge({ label, value }: { label: string; value: string | null | undefined }) {
  const styles: Record<string, string> = {
    present: "bg-emerald-100 text-emerald-800",
    implied: "bg-amber-100 text-amber-800",
    absent: "bg-stone-200 text-stone-600",
  };
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-2">
      <span className="text-xs font-medium text-stone-500">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${value ? styles[value] : "bg-stone-100 text-stone-400"}`}>
        {value ? PICOT_LABEL[value] : "—"}
      </span>
    </div>
  );
}

export default async function TrialReportPage({ params }: { params: Promise<{ ctriId: string[] }> }) {
  const { ctriId: ctriIdParts } = await params;
  const ctriId = decodeURIComponent(ctriIdParts.join("/"));

  const supabase = supabaseAdmin();
  const { data: trial } = await supabase.from("trials_raw").select("*").eq("ctri_id", ctriId).maybeSingle();
  if (!trial) notFound();

  const { data: titleAnalysis } = await supabase.from("title_analysis").select("*").eq("ctri_id", ctriId).maybeSingle();
  const { data: methodsAnalysis } = await supabase.from("methods_analysis").select("*").eq("ctri_id", ctriId).maybeSingle();
  const { data: outcomes } = await supabase
    .from("trial_outcomes")
    .select("outcome_name, outcome_type, classification, matched_instrument_id")
    .eq("ctri_id", ctriId);

  const raw = (trial.raw_ictrp_record ?? {}) as Record<string, string>;
  const sourceUrl = raw["url"] || null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">
        ← Back to trials
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-stone-500">{trial.ctri_id}</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900">
            {trial.title_public ?? trial.title_scientific ?? "Untitled trial"}
          </h1>
          {trial.title_scientific && trial.title_public && trial.title_scientific !== trial.title_public && (
            <p className="mt-1 text-sm italic text-stone-500">Scientific title: {trial.title_scientific}</p>
          )}
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
          >
            View on CTRI ↗
          </a>
        )}
      </div>

      {/* Registry snapshot */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-900">Registry snapshot</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Condition" value={trial.condition} />
          <Field label="Intervention" value={<span className="line-clamp-3">{trial.intervention}</span>} />
          <Field label="Study type" value={trial.study_type} />
          <Field label="Phase" value={trial.phase} />
          <Field label="Recruitment status" value={trial.recruitment_status} />
          <Field label="Registration date" value={trial.registration_date} />
          <Field label="Target sample size" value={trial.target_sample_size_total} />
          <Field label="Primary sponsor" value={trial.primary_sponsor_type} />
          <Field label="Ethics approval" value={trial.ethics_committee_approval} />
        </dl>
        <Field label="Study design (as registered)" value={trial.study_design} />
      </section>

      {/* Phase 1: SPIRIT Item 1 report */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-900">SPIRIT 2013 Item 1 — title-reporting audit</h2>
          {titleAnalysis && (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${COMPLIANCE_STYLES[titleAnalysis.spirit_item1_compliance ?? ""] ?? "border-stone-300 bg-stone-100 text-stone-600"}`}
            >
              {titleAnalysis.spirit_item1_compliance?.replace("_", " ") ?? "not analyzed"}
            </span>
          )}
        </div>

        {!titleAnalysis ? (
          <p className="mt-3 text-sm text-stone-500">Not yet analyzed.</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
              <PicotBadge label="Population" value={titleAnalysis.population} />
              <PicotBadge label="Intervention" value={titleAnalysis.intervention} />
              <PicotBadge label="Comparator" value={titleAnalysis.comparator} />
              <PicotBadge label="Outcome" value={titleAnalysis.outcome} />
              <PicotBadge label="Timing" value={titleAnalysis.timing} />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Design named in title" value={titleAnalysis.design_identified_in_title ? "Yes" : "No"} />
              <Field
                label="Design vs. registry"
                value={
                  <span className={titleAnalysis.design_title_vs_registry_match === "mismatch" ? "font-semibold text-rose-700" : undefined}>
                    {titleAnalysis.design_title_vs_registry_match?.replace(/_/g, " ")}
                  </span>
                }
              />
              <Field label="Intervention specificity" value={titleAnalysis.intervention_specificity?.replace(/_/g, " ")} />
              <Field
                label="Dual nomenclature"
                value={titleAnalysis.dual_nomenclature_flag ? <span className="font-semibold text-amber-700">Flagged</span> : "No"}
              />
            </dl>

            <div className="mt-4 rounded-md bg-stone-50 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Assessment</div>
              <p className="mt-1 text-sm leading-relaxed text-stone-700">{titleAnalysis.notes}</p>
            </div>
          </>
        )}
      </section>

      {/* Phase 2: methods */}
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-900">Methods audit</h2>
        {!methodsAnalysis ? (
          <p className="mt-3 text-sm text-stone-500">Not yet analyzed.</p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Sequence generation" value={methodsAnalysis.sequence_generation?.replace(/_/g, " ")} />
              <Field label="Allocation concealment" value={methodsAnalysis.allocation_concealment_class?.replace(/_/g, " ")} />
              <Field label="Blinding" value={methodsAnalysis.blinding_class} />
              <Field label="Sample size justification" value={methodsAnalysis.sample_size_justification?.replace(/_/g, " ")} />
              <Field label="Statistical test reported" value="Not assessable from registration data" />
            </dl>
            {methodsAnalysis.internal_consistency_flag && (
              <div className="mt-3 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800">
                ⚠ {methodsAnalysis.internal_consistency_flag.replace(/_/g, " ")}
              </div>
            )}
          </>
        )}

        {outcomes && outcomes.length > 0 && (
          <div className="mt-5">
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Outcome measures</div>
            <ul className="mt-2 space-y-2">
              {outcomes.map((o, i) => (
                <li key={i} className="flex items-start justify-between gap-3 rounded-md border border-stone-100 bg-stone-50 px-3 py-2 text-sm">
                  <span className="text-stone-700">
                    <span className="mr-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs uppercase text-stone-600">{o.outcome_type}</span>
                    {o.outcome_name}
                  </span>
                  <span className="whitespace-nowrap text-xs text-stone-500">
                    {o.classification?.replace(/_/g, " ")}
                    {o.matched_instrument_id ? ` · ${o.matched_instrument_id}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
