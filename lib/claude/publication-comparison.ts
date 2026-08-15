import { claudeClient } from "./client";

/**
 * Phase 3 — registered-vs-published comparison. A Europe PMC string match
 * on the CTRI ID is noisy: it can be the trial's own results paper, or a
 * review/registry-listing article that merely cites the registration in
 * passing. This module folds that judgment (is_primary_report) into the
 * same call that does the deeper comparison, since Claude has to read the
 * abstract carefully either way.
 */

export interface PublicationComparisonInput {
  ctriId: string;
  registeredTitlePublic: string | null;
  registeredTitleScientific: string | null;
  registeredCondition: string | null;
  registeredIntervention: string | null;
  registeredPrimaryOutcomes: string | null;
  registeredStudyDesign: string | null;
  spiritCompliance: string | null;
  spiritNotes: string | null;
  sequenceGeneration: string | null;
  allocationConcealmentClass: string | null;
  blindingClass: string | null;
  internalConsistencyFlag: string | null;
  sampleSizeJustification: string | null;
  investigatorDevisedOutcomeNames: string[];

  publicationTitle: string | null;
  publicationAuthors: string | null;
  publicationJournal: string | null;
  publicationYear: number | null;
  publicationTypes: string | null;
  publicationAbstract: string | null;
}

export interface PublicationComparisonResult {
  is_primary_report: boolean;
  outcome_switching_flag: boolean | null;
  limitations_disclosed: boolean | null;
  framing_assessment: "appropriately_cautious" | "overstated" | "consistent" | "not_assessable";
  comparison_notes: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    is_primary_report: {
      type: "boolean",
      description: "True only if this publication appears to BE the trial's own results paper — not a review, systematic review, or 'list of registered trials' article that merely cites the registration number in passing.",
    },
    outcome_switching_flag: {
      type: ["boolean", "null"],
      description: "True if the publication's stated primary outcome differs from the registered primary outcome. Null if is_primary_report is false or not assessable.",
    },
    limitations_disclosed: {
      type: ["boolean", "null"],
      description: "True if the abstract/publication acknowledges the methodological weaknesses already identified at registration (e.g. non-randomized, high-risk sequence generation, open-label despite comparator, investigator-devised outcomes, absent sample-size justification). Null if is_primary_report is false or not assessable.",
    },
    framing_assessment: {
      type: "string",
      enum: ["appropriately_cautious", "overstated", "consistent", "not_assessable"],
      description: "How the publication's framing of its own findings compares to what the registered methodology actually supports. Use not_assessable when is_primary_report is false.",
    },
    comparison_notes: {
      type: "string",
      description: "Narrative explanation of the is_primary_report judgment and, if true, the comparison — written for a reader auditing research quality, not the trial's own investigators.",
    },
  },
  required: ["is_primary_report", "outcome_switching_flag", "limitations_disclosed", "framing_assessment", "comparison_notes"],
  additionalProperties: false,
} as const;

function buildPrompt(t: PublicationComparisonInput): string {
  return `You are auditing whether a candidate publication found via a citation search is actually the results
report of a specific registered Ayurveda clinical trial, and if so, how its framing compares to what the
trial's registered methodology actually supports. This candidate was found by searching for the trial's
CTRI registration number as a literal string — that search is noisy and frequently surfaces review articles,
"list of ongoing trials" papers, or other tangential mentions rather than the trial's own results paper.

REGISTERED TRIAL (from CTRI):
CTRI ID: ${t.ctriId}
Public title: ${t.registeredTitlePublic ?? "(not provided)"}
Scientific title: ${t.registeredTitleScientific ?? "(not provided)"}
Condition: ${t.registeredCondition ?? "(not provided)"}
Intervention: ${t.registeredIntervention ?? "(not provided)"}
Registered primary outcome(s): ${t.registeredPrimaryOutcomes ?? "(not provided)"}
Study design: ${t.registeredStudyDesign ?? "(not provided)"}

ALREADY-IDENTIFIED METHODOLOGICAL FINDINGS FOR THIS TRIAL (from our own prior audit — ground truth, do not re-derive):
SPIRIT Item 1 title compliance: ${t.spiritCompliance ?? "not analyzed"} — ${t.spiritNotes ?? ""}
Sequence generation: ${t.sequenceGeneration ?? "not analyzed"}
Allocation concealment: ${t.allocationConcealmentClass ?? "not analyzed"}
Blinding: ${t.blindingClass ?? "not analyzed"}
Internal consistency flag: ${t.internalConsistencyFlag ?? "none"}
Sample size justification: ${t.sampleSizeJustification ?? "not analyzed"}
Investigator-devised (unvalidated) outcome measures used: ${t.investigatorDevisedOutcomeNames.length ? t.investigatorDevisedOutcomeNames.join("; ") : "none identified"}

CANDIDATE PUBLICATION (found via Europe PMC citation search on the CTRI ID above):
Title: ${t.publicationTitle ?? "(not provided)"}
Authors: ${t.publicationAuthors ?? "(not provided)"}
Journal: ${t.publicationJournal ?? "(not provided)"}
Year: ${t.publicationYear ?? "(not provided)"}
Publication type(s): ${t.publicationTypes ?? "(not provided)"}
Abstract: ${t.publicationAbstract ?? "(not provided)"}

Task:
1. Judge is_primary_report: does this publication's abstract describe a study matching the registered
   condition, intervention, and design — i.e. is this plausibly the trial's own results paper? Or does it
   read as a review, meta-analysis, systematic review, protocol-listing, or unrelated paper that happens to
   mention the registration number (e.g. in a table of included/ongoing studies)? A mismatch in population,
   intervention, or study type (e.g. publication type "Review") is a strong signal against is_primary_report.
2. If is_primary_report is true:
   a. Assess outcome_switching_flag — does the abstract's stated primary outcome/endpoint differ from the
      registered primary outcome? Only flag a genuine substantive difference, not a wording paraphrase.
   b. Assess limitations_disclosed — does the abstract or evident framing acknowledge any of the
      already-identified methodological weaknesses listed above? Do not assume disclosure that isn't
      textually present.
   c. Assess framing_assessment: "overstated" if the publication's conclusions claim more certainty or
      efficacy than the registered methodology (esp. randomization/blinding/sample-size-justification
      weaknesses) can support; "appropriately_cautious" if the publication's own language reflects those
      limitations; "consistent" if there's nothing notable either way.
3. If is_primary_report is false, set outcome_switching_flag and limitations_disclosed to null and
   framing_assessment to "not_assessable".
4. Write comparison_notes explaining your reasoning for a reader auditing Ayurveda research quality —
   be concrete about what in the abstract text supports your judgment.
5. Return your assessment as structured output matching the given schema.`;
}

export async function comparePublication(input: PublicationComparisonInput): Promise<PublicationComparisonResult> {
  const client = claudeClient();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`No text block in response for ${input.ctriId}`);
  }
  return JSON.parse(textBlock.text) as PublicationComparisonResult;
}
