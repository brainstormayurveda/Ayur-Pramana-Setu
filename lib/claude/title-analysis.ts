import { claudeClient } from "./client";

/**
 * Phase 1 — title-level PICO/T + SPIRIT 2013 Item 1 analysis, per the build
 * brief's verbatim prompt. Uses structured outputs (output_config.format)
 * instead of the brief's "return ONLY a JSON object" text instruction —
 * guarantees schema-valid JSON rather than relying on the model to follow a
 * formatting instruction, removing most of the parse-failure risk the
 * brief's general instructions ask us to guard against.
 */

export interface TitleAnalysisInput {
  ctriId: string;
  titleScientific: string | null;
  titlePublic: string | null;
  studyDesign: string | null;
  condition: string | null;
  intervention: string | null;
  studyType: string | null;
}

export interface TitleAnalysisResult {
  population: "present" | "implied" | "absent";
  intervention: "present" | "implied" | "absent";
  comparator: "present" | "implied" | "absent";
  outcome: "present" | "implied" | "absent";
  timing: "present" | "implied" | "absent";
  design_identified_in_title: boolean;
  design_title_vs_registry_match: "match" | "mismatch" | "title_underspecified";
  intervention_specificity: "named_formulation" | "vague_descriptor";
  dual_nomenclature_flag: boolean;
  spirit_item1_compliance: "compliant" | "partial" | "non_compliant";
  notes: string;
}

const PICOT_ENUM = ["present", "implied", "absent"];

const SCHEMA = {
  type: "object",
  properties: {
    population: { type: "string", enum: PICOT_ENUM },
    intervention: { type: "string", enum: PICOT_ENUM },
    comparator: { type: "string", enum: PICOT_ENUM },
    outcome: { type: "string", enum: PICOT_ENUM },
    timing: { type: "string", enum: PICOT_ENUM },
    design_identified_in_title: { type: "boolean" },
    design_title_vs_registry_match: { type: "string", enum: ["match", "mismatch", "title_underspecified"] },
    intervention_specificity: { type: "string", enum: ["named_formulation", "vague_descriptor"] },
    dual_nomenclature_flag: { type: "boolean" },
    spirit_item1_compliance: { type: "string", enum: ["compliant", "partial", "non_compliant"] },
    notes: { type: "string" },
  },
  required: [
    "population",
    "intervention",
    "comparator",
    "outcome",
    "timing",
    "design_identified_in_title",
    "design_title_vs_registry_match",
    "intervention_specificity",
    "dual_nomenclature_flag",
    "spirit_item1_compliance",
    "notes",
  ],
  additionalProperties: false,
} as const;

function buildPrompt(t: TitleAnalysisInput): string {
  return `You are analyzing a single Ayurveda clinical trial registration from the Clinical Trials Registry – India (CTRI).
You are given the trial's Scientific Title, Public Title, and structured registry fields (condition, intervention,
study design, sample size). Do not use outside knowledge of the intervention's efficacy — this is a reporting-quality
assessment of the TITLE only, benchmarked against SPIRIT 2013 Item 1, not an efficacy judgment.

Registry data:
Scientific Title: ${t.titleScientific ?? "(not provided)"}
Public Title: ${t.titlePublic ?? "(not provided)"}
Study Design (registry field): ${t.studyDesign ?? "(not provided)"}
Condition (registry field): ${t.condition ?? "(not provided)"}
Intervention (registry field): ${t.intervention ?? "(not provided)"}
Study Type: ${t.studyType ?? "(not provided)"}

Task:
1. Extract PICO/T from the title text alone (Population, Intervention, Comparator, Outcome, Timing) —
   mark each element Present, Implied, or Absent based on the title wording, not the registry fields.
2. State whether the title identifies the study design, per SPIRIT Item 1.
3. Compare the title's stated/implied design against the registry's Study Design field —
   report match, mismatch, or title_underspecified.
4. Assess intervention specificity: named formulation vs vague descriptor.
5. Flag dual-nomenclature cases (classical Ayurvedic diagnostic term used without any biomedical
   condition label anywhere in the provided fields).
6. Return your assessment as structured output matching the given schema.`;
}

export async function analyzeTitleTrial(input: TitleAnalysisInput): Promise<TitleAnalysisResult> {
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
  return JSON.parse(textBlock.text) as TitleAnalysisResult;
}
