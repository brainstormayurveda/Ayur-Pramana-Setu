import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Manual fallback ingestion path, for use if the WHO ICTRP scraper
 * (lib/ictrp) breaks due to an upstream HTML/markup change. Accepts a JSON
 * array of trial records — export the WHO search portal's own "Export
 * results to XML" output to CSV/JSON by hand (or paste a small batch) and
 * POST it here. Same bearer-token auth as the ingest cron.
 *
 * Body: { trials: Array<{ ctri_id: string; [any trials_raw column]: unknown }> }
 */

const ALLOWED_COLUMNS = new Set([
  "ctri_id",
  "title_scientific",
  "title_public",
  "trial_acronym",
  "study_type",
  "study_design",
  "phase",
  "condition",
  "condition_icd10_category",
  "intervention",
  "comparator",
  "inclusion_exclusion",
  "randomization_method",
  "allocation_concealment",
  "blinding",
  "primary_outcomes",
  "secondary_outcomes",
  "target_sample_size_total",
  "target_sample_size_india",
  "final_enrolment_total",
  "primary_sponsor_type",
  "recruitment_status",
  "registration_date",
  "date_first_enrollment",
  "ethics_committee_approval",
  "brief_summary",
  "publication_field",
  "raw_ictrp_record",
  "is_ayurveda_trial",
  "ayurveda_classification_confidence",
]);

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { trials?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.trials) || body.trials.length === 0) {
    return NextResponse.json({ error: "body.trials must be a non-empty array" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: logRow } = await supabase
    .from("ingestion_log")
    .insert({ status: "running", source: "manual_upload" })
    .select("id")
    .single();

  let newRecords = 0;
  let updatedRecords = 0;
  let failedRecords = 0;
  const errors: string[] = [];

  const { data: existingRows } = await supabase.from("trials_raw").select("ctri_id");
  const existingIds = new Set((existingRows ?? []).map((r) => r.ctri_id as string));

  for (const raw of body.trials as Array<Record<string, unknown>>) {
    if (!raw.ctri_id || typeof raw.ctri_id !== "string") {
      failedRecords++;
      errors.push("row missing ctri_id");
      continue;
    }
    const row: Record<string, unknown> = { last_updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(raw)) {
      if (ALLOWED_COLUMNS.has(key)) row[key] = value;
    }
    const wasExisting = existingIds.has(raw.ctri_id);
    const { error } = await supabase.from("trials_raw").upsert(row, { onConflict: "ctri_id" });
    if (error) {
      failedRecords++;
      errors.push(`${raw.ctri_id}: ${error.message}`);
    } else if (wasExisting) {
      updatedRecords++;
    } else {
      newRecords++;
    }
  }

  if (logRow) {
    await supabase
      .from("ingestion_log")
      .update({
        run_finished_at: new Date().toISOString(),
        new_records: newRecords,
        updated_records: updatedRecords,
        failed_records: failedRecords,
        status: failedRecords > 0 ? "partial_failure" : "success",
        error_detail: errors.length ? errors.slice(0, 50).join("\n") : null,
      })
      .eq("id", logRow.id);
  }

  return NextResponse.json({ ok: true, newRecords, updatedRecords, failedRecords, errors: errors.slice(0, 20) });
}
