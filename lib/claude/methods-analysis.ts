import { claudeClient } from "./client";

/**
 * Phase 2 — methods, sample size, and outcome-measure classification, per
 * the build brief's verbatim prompt. Structured outputs instead of a
 * "return ONLY JSON" instruction, same rationale as Phase 1.
 */

export interface MethodsAnalysisInput {
  ctriId: string;
  studyDesign: string | null;
  comparator: string | null;
  targetSampleSizeTotal: number | null;
  targetSampleSizeIndia: number | null;
  briefSummary: string | null;
  primaryOutcomes: string | null;
  secondaryOutcomes: string | null;
}

export type OutcomeClassification =
  | "validated_standard_instrument"
  | "objective_biomarker"
  | "investigator_devised_unvalidated"
  | "classical_ayurvedic_parameter"
  | "modified_validated_instrument";

export interface MethodsAnalysisResult {
  sequence_generation: "adequate" | "higher_risk_method" | "not_randomized" | "not_reported";
  allocation_concealment_class: "adequate" | "inadequate" | "not_reported";
  blinding_class: string;
  open_label_despite_placebo_comparator: boolean;
  sample_size_justification: "present_in_summary" | "absent_from_summary";
  outcomes: Array<{
    outcome_name: string;
    outcome_type: "primary" | "secondary";
    classification: OutcomeClassification;
    assessment_criteria_text: string | null;
  }>;
}

const OUTCOME_CLASSIFICATIONS = [
  "validated_standard_instrument",
  "objective_biomarker",
  "investigator_devised_unvalidated",
  "classical_ayurvedic_parameter",
  "modified_validated_instrument",
];

const SCHEMA = {
  type: "object",
  properties: {
    sequence_generation: { type: "string", enum: ["adequate", "higher_risk_method", "not_randomized", "not_reported"] },
    allocation_concealment_class: { type: "string", enum: ["adequate", "inadequate", "not_reported"] },
    blinding_class: { type: "string" },
    open_label_despite_placebo_comparator: { type: "boolean" },
    sample_size_justification: { type: "string", enum: ["present_in_summary", "absent_from_summary"] },
    outcomes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          outcome_name: { type: "string" },
          outcome_type: { type: "string", enum: ["primary", "secondary"] },
          classification: { type: "string", enum: OUTCOME_CLASSIFICATIONS },
          assessment_criteria_text: {
            type: ["string", "null"],
            description:
              "The registry's own description of how this outcome is scored or graded, if stated (e.g. a numeric scale with defined levels like '0 to 3 signifying none, mild, moderate, severe'). Closely follow the registry's own wording — do not invent or standardize grade definitions it doesn't state. Null if the registry names the outcome without specifying any scoring/grading detail.",
          },
        },
        required: ["outcome_name", "outcome_type", "classification", "assessment_criteria_text"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "sequence_generation",
    "allocation_concealment_class",
    "blinding_class",
    "open_label_despite_placebo_comparator",
    "sample_size_justification",
    "outcomes",
  ],
  additionalProperties: false,
} as const;

function buildPrompt(t: MethodsAnalysisInput): string {
  return `You are analyzing the methodology fields of a single Ayurveda clinical trial registration from CTRI.
Use only the fields provided below — do not assess statistical test correctness, since CTRI registrations
do not capture a statistical analysis plan.

Registry data:
Study Design: ${t.studyDesign ?? "(not provided)"}
Comparator: ${t.comparator ?? "(not provided)"}
Target Sample Size (Total): ${t.targetSampleSizeTotal ?? "(not provided)"}
Target Sample Size (India): ${t.targetSampleSizeIndia ?? "(not provided)"}
Brief Summary: ${t.briefSummary ?? "(not provided)"}
Primary Outcomes: ${t.primaryOutcomes ?? "(not provided)"}
Secondary Outcomes: ${t.secondaryOutcomes ?? "(not provided)"}

Task:
1. Classify sequence generation: adequate (random number table, computer-generated, stratified/permuted
   block) | higher_risk_method (coin toss, lottery, card shuffling) | not_randomized | not_reported.
   The Study Design field text is where randomization method, if any, is typically described.
2. Classify allocation concealment: adequate (central allocation, sealed opaque envelopes, pharmacy-controlled)
   | inadequate (open list, alternation, date-of-birth) | not_reported.
3. Record blinding level as stated in blinding_class (e.g. "open label", "double blind", "not_reported" if
   absent from the provided fields). Set open_label_despite_placebo_comparator to true only if blinding is
   open label AND a placebo/sham comparator is named in the Comparator field.
4. Search Brief Summary text for sample-size-justification markers (power, effect size, alpha, pilot study
   reference). Report present_in_summary or absent_from_summary — do not infer a justification that isn't
   textually present.
5. For each primary and secondary outcome listed, classify as: validated_standard_instrument |
   objective_biomarker | investigator_devised_unvalidated | classical_ayurvedic_parameter |
   modified_validated_instrument. Base this on whether the named outcome matches a known validated
   instrument — if uncertain, default to investigator_devised_unvalidated and note the uncertainty in
   how you name it, do not assume validation. List each outcome named in Primary/Secondary Outcomes as a
   separate entry with its own outcome_name (keep names concise — the specific measure, not the full
   sentence), outcome_type, and classification.
6. For each outcome, also extract assessment_criteria_text: if the registry text states how that outcome is
   scored or graded (a numeric scale with defined levels, e.g. "0 to 3 signifying none, mild, moderate,
   severe"; a named grading system with defined categories, e.g. "Grade 1-present, Grade 2-absent"; or an
   explicit scoring range), pull that definition out closely following the registry's own wording. This
   matters most for investigator_devised_unvalidated outcomes, where the actual grading definition — not
   just the outcome's name — is often the only way to judge whether it constitutes real measurement or an
   arbitrary made-up scale. Set to null if the registry names the outcome without specifying grading detail.
7. Return your assessment as structured output matching the given schema. Do not assess statistical test
   reporting or appropriateness — that is handled separately and fixed for all trials at this phase.`;
}

export async function analyzeMethodsTrial(input: MethodsAnalysisInput): Promise<MethodsAnalysisResult> {
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
  return JSON.parse(textBlock.text) as MethodsAnalysisResult;
}
