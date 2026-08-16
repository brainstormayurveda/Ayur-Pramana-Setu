"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDoi } from "@/lib/crossref/client";
import { comparePublication, PublicationComparisonInput } from "@/lib/claude/publication-comparison";
import { runAndPersistConsortCheck, isRandomizedDesign } from "@/lib/claude/consort-abstract-check";
import { extractHerbs } from "@/lib/claude/herb-extraction";

function nonEmpty(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

/**
 * Lets an admin add a candidate publication by hand — via DOI (resolved
 * through CrossRef) or plain title/author/journal fields — for cases where
 * Europe PMC's automated CTRI-ID search didn't find it but the user located
 * the paper themselves. Runs the same registered-vs-published comparison
 * immediately, so it appears in the "Published paper" section right away.
 */
export async function addManualPublicationAction(formData: FormData) {
  await requireAdmin();

  const ctriId = String(formData.get("ctriId") ?? "");
  if (!ctriId) throw new Error("Missing CTRI ID.");

  const doiInput = nonEmpty(formData, "doi");
  let title = nonEmpty(formData, "title");
  let authorString = nonEmpty(formData, "authors");
  let journal = nonEmpty(formData, "journal");
  const pubYearInput = nonEmpty(formData, "pubYear");
  let pubYear = pubYearInput ? parseInt(pubYearInput, 10) : null;
  let abstract = nonEmpty(formData, "abstract");
  let sourceUrl = nonEmpty(formData, "sourceUrl");
  let pubTypes: string | null = null;
  let doi: string | null = null;

  if (doiInput) {
    const resolved = await resolveDoi(doiInput);
    if (resolved) {
      doi = resolved.doi;
      title = title ?? resolved.title;
      authorString = authorString ?? resolved.authorString;
      journal = journal ?? resolved.journal;
      pubYear = pubYear ?? resolved.pubYear;
      abstract = abstract ?? resolved.abstract;
      pubTypes = resolved.pubTypes;
      sourceUrl = sourceUrl ?? resolved.sourceUrl;
    } else {
      doi = doiInput.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
      sourceUrl = sourceUrl ?? `https://doi.org/${doi}`;
    }
  }

  if (!title) throw new Error("A title is required (either typed in, or resolvable from the DOI).");
  if (!sourceUrl) throw new Error("A source URL is required when no DOI is given.");

  const supabase = supabaseAdmin();
  const { data: inserted, error: insertErr } = await supabase
    .from("trial_publications")
    .insert({
      ctri_id: ctriId,
      europepmc_id: null,
      entry_source: "manual",
      source: "manual",
      doi,
      title,
      author_string: authorString,
      journal,
      pub_year: pubYear,
      pub_types: pubTypes,
      abstract,
      source_url: sourceUrl,
      matched_query: doi ? `doi:${doi}` : "manual entry",
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(insertErr.message);

  const [{ data: trial }, { data: titleAnalysis }, { data: methodsAnalysis }, { data: unvalidatedOutcomes }, { data: primaryOutcomes }] = await Promise.all([
    supabase
      .from("trials_raw")
      .select("title_public, title_scientific, condition, intervention, primary_outcomes, study_design")
      .eq("ctri_id", ctriId)
      .maybeSingle(),
    supabase.from("title_analysis").select("spirit_item1_compliance, notes").eq("ctri_id", ctriId).maybeSingle(),
    supabase
      .from("methods_analysis")
      .select("sequence_generation, allocation_concealment_class, blinding_class, internal_consistency_flag, sample_size_justification")
      .eq("ctri_id", ctriId)
      .maybeSingle(),
    supabase.from("trial_outcomes").select("outcome_name").eq("ctri_id", ctriId).eq("classification", "investigator_devised_unvalidated"),
    supabase.from("trial_outcomes").select("outcome_name, classification, assessment_criteria_text").eq("ctri_id", ctriId).eq("outcome_type", "primary"),
  ]);

  const input: PublicationComparisonInput = {
    ctriId,
    registeredTitlePublic: trial?.title_public ?? null,
    registeredTitleScientific: trial?.title_scientific ?? null,
    registeredCondition: trial?.condition ?? null,
    registeredIntervention: trial?.intervention ?? null,
    registeredPrimaryOutcomes: trial?.primary_outcomes ?? null,
    registeredStudyDesign: trial?.study_design ?? null,
    spiritCompliance: titleAnalysis?.spirit_item1_compliance ?? null,
    spiritNotes: titleAnalysis?.notes ?? null,
    sequenceGeneration: methodsAnalysis?.sequence_generation ?? null,
    allocationConcealmentClass: methodsAnalysis?.allocation_concealment_class ?? null,
    blindingClass: methodsAnalysis?.blinding_class ?? null,
    internalConsistencyFlag: methodsAnalysis?.internal_consistency_flag ?? null,
    sampleSizeJustification: methodsAnalysis?.sample_size_justification ?? null,
    investigatorDevisedOutcomeNames: (unvalidatedOutcomes ?? []).map((o) => o.outcome_name).filter((n): n is string => !!n),
    primaryOutcomesDetail: (primaryOutcomes ?? []).map((o) => ({
      name: o.outcome_name ?? "",
      classification: o.classification ?? "unclassified",
      gradingText: o.assessment_criteria_text ?? null,
    })),
    publicationTitle: title,
    publicationAuthors: authorString,
    publicationJournal: journal,
    publicationYear: pubYear,
    publicationTypes: pubTypes,
    publicationAbstract: abstract,
  };

  try {
    const comparison = await comparePublication(input);
    await supabase
      .from("trial_publications")
      .update({
        is_primary_report: comparison.is_primary_report,
        outcome_switching_flag: comparison.outcome_switching_flag,
        limitations_disclosed: comparison.limitations_disclosed,
        discloses_own_trial_registration: comparison.discloses_own_trial_registration,
        statistical_test_stated: comparison.statistical_test_stated,
        statistical_test_assessment: comparison.statistical_test_assessment,
        statistical_test_notes: comparison.statistical_test_notes,
        framing_assessment: comparison.framing_assessment,
        comparison_notes: comparison.comparison_notes,
        comparison_analyzed_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);
  } catch {
    // Row is saved either way; comparison_analyzed_at stays null so the
    // weekly compare-publications cron (or a manual admin re-run) can retry it.
  }

  redirect(`/trials/${ctriId}`);
}

/**
 * Extracts named herbs from this one trial's registered intervention text —
 * on-demand, per-trial, not run in bulk (the user explicitly didn't want an
 * automatic full-corpus batch; they wanted to pick a trial and trigger it).
 */
export async function extractHerbsForTrialAction(formData: FormData) {
  await requireAdmin();

  const ctriId = String(formData.get("ctriId") ?? "");
  if (!ctriId) throw new Error("Missing CTRI ID.");

  const supabase = supabaseAdmin();
  const { data: trial } = await supabase.from("trials_raw").select("intervention, condition").eq("ctri_id", ctriId).maybeSingle();

  const herbs = await extractHerbs({
    ctriId,
    intervention: trial?.intervention ?? null,
    condition: trial?.condition ?? null,
  });

  await supabase.from("trial_herbs").delete().eq("ctri_id", ctriId);
  if (herbs.length > 0) {
    await supabase.from("trial_herbs").insert(
      herbs.map((h) => ({
        ctri_id: ctriId,
        herb_name: h.herb_name,
        scientific_name: h.scientific_name,
        source_text: h.source_text,
      }))
    );
  }
  await supabase.from("trials_raw").update({ herb_extraction_completed_at: new Date().toISOString() }).eq("ctri_id", ctriId);

  redirect(`/trials/${ctriId}`);
}

/**
 * Runs the CONSORT for Abstracts checklist for one specific publication —
 * on-demand, per-publication, deliberately not run automatically alongside
 * the registered-vs-published comparison (the user wants explicit control
 * over when this specific Claude call fires, same reasoning as herb
 * extraction above).
 */
export async function runConsortCheckAction(formData: FormData) {
  await requireAdmin();

  const publicationId = String(formData.get("publicationId") ?? "");
  const ctriId = String(formData.get("ctriId") ?? "");
  if (!publicationId || !ctriId) throw new Error("Missing publication or CTRI ID.");

  const supabase = supabaseAdmin();
  const [{ data: pub }, { data: trial }] = await Promise.all([
    supabase.from("trial_publications").select("title, abstract, is_primary_report").eq("id", publicationId).maybeSingle(),
    supabase.from("trials_raw").select("study_design").eq("ctri_id", ctriId).maybeSingle(),
  ]);
  if (!pub) throw new Error("Publication not found.");
  if (!pub.is_primary_report) throw new Error("Only applicable to a confirmed primary results paper.");
  if (!isRandomizedDesign(trial?.study_design ?? null)) throw new Error("Only applicable to randomized trial designs.");

  await runAndPersistConsortCheck(supabase, publicationId, ctriId, trial?.study_design ?? null, pub.is_primary_report, pub.title, pub.abstract);

  redirect(`/trials/${ctriId}`);
}
