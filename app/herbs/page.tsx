import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function HerbsPage() {
  const supabase = supabaseAdmin();
  const { data: rows, error } = await supabase.from("trial_herbs").select("herb_name, scientific_name, ctri_id");
  if (error) throw new Error(error.message);

  const byHerb = new Map<string, { herbName: string; scientificName: string | null; trialCount: number }>();
  for (const r of rows ?? []) {
    const key = r.herb_name.trim().toLowerCase();
    const existing = byHerb.get(key);
    if (existing) {
      existing.trialCount++;
      if (!existing.scientificName && r.scientific_name) existing.scientificName = r.scientific_name;
    } else {
      byHerb.set(key, { herbName: r.herb_name.trim(), scientificName: r.scientific_name, trialCount: 1 });
    }
  }
  const herbs = [...byHerb.values()].sort((a, b) => b.trialCount - a.trialCount || a.herbName.localeCompare(b.herbName));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Herb literature search</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        Every herb/plant-derived ingredient named in a registered trial&rsquo;s intervention text, extracted
        from your CTRI corpus. Click one to see which trials use it and search independent
        pharmacology/physiology literature on it via Semantic Scholar — not limited to papers tied to a
        specific registered trial.
      </p>

      {herbs.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          No herbs extracted yet. Run herb extraction from <Link href="/admin" className="underline">the admin panel</Link>.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {herbs.map((h) => (
            <Link
              key={h.herbName.toLowerCase()}
              href={`/herbs/${encodeURIComponent(h.herbName)}`}
              className="rounded-lg border border-stone-200 bg-white p-4 hover:border-emerald-300 hover:bg-emerald-50"
            >
              <div className="font-medium text-stone-900">{h.herbName}</div>
              {h.scientificName && <div className="text-xs italic text-stone-500">{h.scientificName}</div>}
              <div className="mt-1 text-xs text-stone-400">
                {h.trialCount} trial{h.trialCount === 1 ? "" : "s"} in this corpus
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
