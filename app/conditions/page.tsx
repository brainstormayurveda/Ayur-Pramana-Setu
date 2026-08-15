import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function pct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 100)}%`;
}

export default async function ConditionsPage() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("condition_fragmentation_report")
    .select("*")
    .order("n_trials", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Measurement fragmentation report</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        For each condition, how many distinct outcome instruments are in use across trials, and what share
        are validated vs. investigator-devised — the answer to &ldquo;why do two trials on the same disease
        use two different scales.&rdquo;
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">ICD-10 category</th>
              <th className="px-4 py-3">Trials</th>
              <th className="px-4 py-3">Distinct instruments</th>
              <th className="px-4 py-3">Validated share</th>
              <th className="px-4 py-3">Investigator-devised share</th>
              <th className="px-4 py-3">Dominant instrument</th>
              <th className="px-4 py-3">COMET core set</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.condition_icd10_category} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="px-4 py-3 font-mono text-xs">{r.condition_icd10_category}</td>
                <td className="px-4 py-3">{r.n_trials}</td>
                <td className="px-4 py-3">{r.distinct_outcome_instruments_used}</td>
                <td className="px-4 py-3">{pct(r.share_validated)}</td>
                <td className="px-4 py-3">{pct(r.share_investigator_devised)}</td>
                <td className="px-4 py-3">{r.dominant_instrument_if_any ?? "—"}</td>
                <td className="px-4 py-3">
                  {r.comet_core_outcome_set_exists ? (
                    <span>
                      yes
                      {r.comet_core_outcome_set_adherence_rate !== null
                        ? ` (${pct(r.comet_core_outcome_set_adherence_rate)} adherence)`
                        : ""}
                    </span>
                  ) : (
                    "no known set"
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  No fragmentation data yet — run Phase 2 analysis first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
