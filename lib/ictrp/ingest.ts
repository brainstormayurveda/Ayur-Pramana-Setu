import { supabaseAdmin } from "@/lib/supabase/admin";
import { startSession, search, findPagerTarget, postback, extractTrialIdsFromResults, fetchTrialDetailHtml } from "./client";
import { parseTrialDetail, keywordSuggestsAyurveda } from "./parse";
import { extractIcd10Category } from "@/lib/icd10";

const SEARCH_TERM = "ayurveda OR ayurvedic";
const DETAIL_FETCH_DELAY_MS = 900;

export interface IngestResult {
  totalFound: number;
  candidateTrialIds: number;
  newRecords: number;
  updatedRecords: number;
  skippedNonCtri: number;
  failedRecords: number;
  errors: string[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one ingestion pass: search WHO ICTRP for Ayurveda-relevant trials,
 * collect trial IDs across all result pages, fetch up to `limit` trial
 * detail pages (prioritizing IDs not already in trials_raw so repeated
 * runs make incremental progress), keep only true CTRI records (Register
 * === "CTRI"), and upsert into trials_raw. Every run is logged to
 * ingestion_log regardless of outcome.
 */
export async function ingestOnce({ limit = 150 }: { limit?: number } = {}): Promise<IngestResult> {
  const supabase = supabaseAdmin();
  const { data: logRow, error: logInsertErr } = await supabase
    .from("ingestion_log")
    .insert({ status: "running" })
    .select("id")
    .single();
  if (logInsertErr || !logRow) throw new Error(`Failed to create ingestion_log row: ${logInsertErr?.message}`);
  const logId = logRow.id as string;

  const result: IngestResult = {
    totalFound: 0,
    candidateTrialIds: 0,
    newRecords: 0,
    updatedRecords: 0,
    skippedNonCtri: 0,
    failedRecords: 0,
    errors: [],
  };

  try {
    const { session, hidden } = await startSession();
    const first = await search(session, hidden, { term: SEARCH_TERM, recruitingStatus: "ALL", pageSize: "100" });
    result.totalFound = first.totalTrials ?? 0;

    const allIds = new Set(extractTrialIdsFromResults(first.html));
    let currentHidden = first.hidden;
    let currentHtml = first.html;
    const recordsPerPage = extractTrialIdsFromResults(first.html).length || 10;
    const totalPages = Math.max(1, Math.ceil((first.totalTrials ?? 0) / recordsPerPage));

    // Records-per-page is fixed at 10 by the site; the pager only exposes a
    // window of ~10 page links at a time, so we walk sequentially and fall
    // back to "Last" to jump into the next window once we hit its edge.
    const MAX_PAGES_PER_RUN = 60;
    let pagesVisited = 1;
    let currentPageNum = 1;
    let usedLastJump = false;

    while (pagesVisited < totalPages && pagesVisited < MAX_PAGES_PER_RUN) {
      const wantLabel = String(currentPageNum + 1);
      let target = findPagerTarget(currentHtml, wantLabel);
      let usingLast = false;
      if (!target && !usedLastJump) {
        target = findPagerTarget(currentHtml, "Last");
        usingLast = true;
      }
      if (!target) break; // no further pages reachable from this window

      try {
        const next = await postback(session, currentHidden, target);
        currentHidden = next.hidden;
        currentHtml = next.html;
        for (const id of extractTrialIdsFromResults(next.html)) allIds.add(id);
        pagesVisited++;
        currentPageNum = usingLast ? totalPages : currentPageNum + 1;
        if (usingLast) usedLastJump = true;
        await sleep(DETAIL_FETCH_DELAY_MS);
      } catch (e) {
        result.errors.push(`pagination near page ${currentPageNum}: ${(e as Error).message}`);
        break; // stop paginating on failure; keep what we already collected
      }
    }

    result.candidateTrialIds = allIds.size;

    // Prioritize trial IDs we don't have yet, so repeated runs (weekly cron,
    // or a manual re-trigger) make incremental progress toward the full set.
    const idList = [...allIds];
    const { data: existingRows } = await supabase.from("trials_raw").select("ctri_id");
    const existingIds = new Set((existingRows ?? []).map((r) => r.ctri_id as string));
    const newFirst = [...idList].sort((a, b) => Number(existingIds.has(a)) - Number(existingIds.has(b)));
    const toFetch = newFirst.slice(0, limit);

    for (const trialId of toFetch) {
      try {
        let html = await fetchTrialDetailHtml(trialId);
        let parsed = parseTrialDetail(html);
        if (!parsed) {
          // WHO's server occasionally returns a transient error page under
          // rapid sequential requests; one retry clears most of these.
          await sleep(DETAIL_FETCH_DELAY_MS * 2);
          html = await fetchTrialDetailHtml(trialId);
          parsed = parseTrialDetail(html);
        }
        if (!parsed) {
          result.failedRecords++;
          result.errors.push(`${trialId}: could not parse detail page`);
          continue;
        }
        if (parsed.register.toUpperCase() !== "CTRI") {
          result.skippedNonCtri++;
          continue;
        }

        const wasExisting = existingIds.has(parsed.ctriId);
        const { error: upsertErr } = await supabase.from("trials_raw").upsert(
          {
            ctri_id: parsed.ctriId,
            title_scientific: parsed.titleScientific,
            title_public: parsed.titlePublic,
            study_type: parsed.studyType,
            study_design: parsed.studyDesign,
            phase: parsed.phase,
            condition: parsed.condition,
            condition_icd10_category: extractIcd10Category(parsed.condition),
            intervention: parsed.intervention,
            primary_outcomes: parsed.primaryOutcomes,
            secondary_outcomes: parsed.secondaryOutcomes,
            target_sample_size_total: parsed.targetSampleSizeTotal,
            primary_sponsor_type: parsed.primarySponsor,
            recruitment_status: parsed.recruitmentStatus,
            registration_date: parsed.registrationDate,
            date_first_enrollment: parsed.dateFirstEnrollment,
            ethics_committee_approval: parsed.ethicsApprovalStatus,
            raw_ictrp_record: parsed.raw,
            is_ayurveda_trial: keywordSuggestsAyurveda(parsed),
            ayurveda_classification_confidence: "keyword_match",
            last_updated_at: new Date().toISOString(),
          },
          { onConflict: "ctri_id" }
        );

        if (upsertErr) {
          result.failedRecords++;
          result.errors.push(`${trialId}: upsert failed: ${upsertErr.message}`);
        } else if (wasExisting) {
          result.updatedRecords++;
        } else {
          result.newRecords++;
        }
      } catch (e) {
        result.failedRecords++;
        result.errors.push(`${trialId}: ${(e as Error).message}`);
      }
      await sleep(DETAIL_FETCH_DELAY_MS);
    }

    await supabase
      .from("ingestion_log")
      .update({
        run_finished_at: new Date().toISOString(),
        new_records: result.newRecords,
        updated_records: result.updatedRecords,
        failed_records: result.failedRecords,
        status: result.failedRecords > 0 ? "partial_failure" : "success",
        error_detail: result.errors.length ? result.errors.slice(0, 50).join("\n") : null,
      })
      .eq("id", logId);

    return result;
  } catch (e) {
    await supabase
      .from("ingestion_log")
      .update({
        run_finished_at: new Date().toISOString(),
        status: "failed",
        error_detail: (e as Error).message,
      })
      .eq("id", logId);
    throw e;
  }
}
