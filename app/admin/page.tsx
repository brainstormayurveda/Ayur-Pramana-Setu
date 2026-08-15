import { cookies } from "next/headers";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyPasscode, logoutAdmin, runIngestAction, runTitleAnalysisAction, runMethodsAnalysisAction, runFragmentationAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 280;

const COOKIE_NAME = "admin_passcode";

const RUN_LABELS: Record<string, string> = {
  ingest: "Pull new trials from WHO ICTRP",
  titles: "Title (SPIRIT) analysis",
  methods: "Methods & outcomes analysis",
  fragmentation: "Fragmentation report",
};

function LimitField() {
  return (
    <label className="flex items-center gap-2 text-xs text-stone-500">
      Limit
      <input
        type="number"
        name="limit"
        defaultValue={50}
        min={1}
        max={500}
        className="w-20 rounded border border-stone-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ran?: string; summary?: string }>;
}) {
  const { error, ran, summary } = await searchParams;
  const store = await cookies();
  const secret = process.env.CRON_SECRET;
  const isAuthed = !!secret && store.get(COOKIE_NAME)?.value === secret;

  if (!isAuthed) {
    return (
      <div className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-stone-600">Enter the admin passcode to run analysis manually.</p>
        <form action={verifyPasscode} className="mt-4 space-y-3">
          <input
            type="password"
            name="passcode"
            placeholder="Passcode"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            autoFocus
          />
          <button type="submit" className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
            Enter
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-rose-600">Incorrect passcode.</p>}
      </div>
    );
  }

  const supabase = supabaseAdmin();
  const [{ count: totalTrials }, { count: titleAnalyzed }, { count: methodsAnalyzed }] = await Promise.all([
    supabase.from("trials_raw").select("*", { count: "exact", head: true }),
    supabase.from("title_analysis").select("*", { count: "exact", head: true }),
    supabase.from("methods_analysis").select("*", { count: "exact", head: true }),
  ]);

  const pendingTitles = (totalTrials ?? 0) - (titleAnalyzed ?? 0);
  const pendingMethods = (titleAnalyzed ?? 0) - (methodsAnalyzed ?? 0);

  let parsedSummary: Record<string, unknown> | null = null;
  if (summary) {
    try {
      parsedSummary = JSON.parse(summary);
    } catch {
      parsedSummary = null;
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Pipeline control panel</h1>
          <p className="mt-1 text-sm text-stone-600">
            Manually trigger any pipeline stage instead of waiting for the weekly cron.{" "}
            <Link href="/" className="underline">
              ← Back to trials
            </Link>
          </p>
        </div>
        <form action={logoutAdmin}>
          <button type="submit" className="text-xs text-stone-400 underline hover:text-stone-700">
            Log out
          </button>
        </form>
      </div>

      {ran && (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <div className="font-medium text-emerald-800">
            {RUN_LABELS[ran] ?? ran} — completed
          </div>
          {parsedSummary && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-emerald-900">
              {JSON.stringify(parsedSummary, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">1. Ingest — pull new trials from WHO ICTRP</h2>
          <p className="mt-1 text-sm text-stone-500">
            Searches WHO&rsquo;s registry for Ayurveda-relevant CTRI trials and adds any not already in the
            database. Note: WHO&rsquo;s server tolerates roughly 25-35 detail-page fetches per run before
            rate-limiting — a larger limit than that may show some failed fetches, which is expected and safe
            to re-run later.
          </p>
          <form action={runIngestAction} className="mt-3 flex items-center gap-3">
            <LimitField />
            <button type="submit" className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
              Run ingest
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">
            2. Title (SPIRIT) analysis <span className="ml-2 font-normal text-stone-400">{pendingTitles} pending</span>
          </h2>
          <p className="mt-1 text-sm text-stone-500">Runs Claude&rsquo;s PICO/T + SPIRIT Item 1 audit on every trial not yet analyzed.</p>
          <form action={runTitleAnalysisAction} className="mt-3 flex items-center gap-3">
            <LimitField />
            <button type="submit" className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
              Run title analysis
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">
            3. Methods &amp; outcomes analysis <span className="ml-2 font-normal text-stone-400">{pendingMethods} pending</span>
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Runs Claude&rsquo;s randomization/blinding/outcome-instrument audit on every title-analyzed trial
            not yet methods-analyzed.
          </p>
          <form action={runMethodsAnalysisAction} className="mt-3 flex items-center gap-3">
            <LimitField />
            <button type="submit" className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
              Run methods analysis
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">4. Recompute fragmentation report</h2>
          <p className="mt-1 text-sm text-stone-500">
            Pure aggregation over current data — cheap, no Claude calls. Re-run any time after step 3.
          </p>
          <form action={runFragmentationAction} className="mt-3">
            <button type="submit" className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
              Recompute
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
