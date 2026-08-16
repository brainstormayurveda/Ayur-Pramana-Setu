"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDoi } from "@/lib/crossref/client";
import { comparePublication, PublicationComparisonInput } from "@/lib/claude/publication-comparison";

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
