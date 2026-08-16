import { claudeClient } from "./client";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * CONSORT for Abstracts (Hopewell et al. 2008, PMC2211558) — the 17-item
 * EQUATOR checklist specifically for RCT abstracts, not the ~30-item full
 * CONSORT 2025 checklist (which needs full-manuscript methods/results
 * sections we don't have for matched publications — only an abstract).
 * CONSORT 2025's own statement says to keep using this existing extension
 * until it's updated to match, so this is the current authoritative version,
 * not a stale one. Modeled on the same "reporting-guideline compliance as
 * its own pipeline stage" design used by the Pramana Council manuscript
 * reviewer for IJA (a separate project) — reimplemented here at abstract
 * scale for matched CTRI-trial publications, not calling that service.
 */

const CHECKLIST_ITEMS = [
  { item: "Title", descriptor: "Identification of the study as randomized" },
  { item: "Trial design", descriptor: "Description of the trial design (e.g. parallel, cluster, non-inferiority)" },
  { item: "Participants", descriptor: "Eligibility criteria for participants and the settings where data were collected" },
  { item: "Interventions", descriptor: "Interventions intended for each group" },
  { item: "Objective", descriptor: "Specific objective or hypothesis" },
  { item: "Outcome", descriptor: "Clearly defined primary outcome for this report" },
  { item: "Randomization", descriptor: "How participants were allocated to interventions" },
  { item: "Blinding", descriptor: "Whether or not participants, caregivers, and those assessing outcomes were blinded" },
  { item: "Numbers randomized", descriptor: "Number of participants randomized to each group" },
  { item: "Recruitment", descriptor: "Trial status (recruiting, completed, etc.)" },
  { item: "Numbers analysed", descriptor: "Number of participants analysed in each group" },
  { item: "Outcome results", descriptor: "For the primary outcome, a result for each group and the estimated effect size" },
  { item: "Harms", descriptor: "Important adverse events or side effects" },
  { item: "Conclusions", descriptor: "General interpretation of the results" },
  { item: "Trial registration", descriptor: "Registration number and name of trial register" },
  { item: "Funding", descriptor: "Source of funding" },
] as const;

export interface ConsortAbstractInput {
  ctriId: string;
  publicationTitle: string | null;
  publicationAbstract: string | null;
}

export interface ConsortAbstractChecklistItem {
  item_name: string;
  reported: boolean;
  note: string;
}

export interface ConsortAbstractResult {
  items: ConsortAbstractChecklistItem[];
}

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_name: { type: "string", enum: CHECKLIST_ITEMS.map((i) => i.item) },
          reported: { type: "boolean", description: "True only if this abstract's text actually contains this information — do not assume it's true because it's common practice." },
          note: { type: "string", description: "One short sentence: what the abstract says (or doesn't) for this item." },
        },
        required: ["item_name", "reported", "note"],
        additionalProperties: false,
      },
      minItems: CHECKLIST_ITEMS.length,
      maxItems: CHECKLIST_ITEMS.length,
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

function buildPrompt(t: ConsortAbstractInput): string {
  const itemList = CHECKLIST_ITEMS.map((i) => `- ${i.item}: ${i.descriptor}`).join("\n");
  return `You are checking a published randomized-trial abstract against the CONSORT for Abstracts checklist
(Hopewell et al. 2008) — the current EQUATOR-endorsed reporting guideline specifically for RCT abstracts.
Judge only what THIS abstract's text actually contains; do not credit an item as reported because it's
standard practice or because you'd expect it to be true.

Publication title: ${t.publicationTitle ?? "(not provided)"}
Abstract: ${t.publicationAbstract ?? "(not provided)"}

Checklist items:
${itemList}

For each of the ${CHECKLIST_ITEMS.length} items above, in the same order, judge whether the abstract text
reports it (reported: true/false) and write one short note citing what the abstract says or confirming it's
absent. Return your assessment as structured output matching the given schema.`;
}

export async function checkConsortAbstract(input: ConsortAbstractInput): Promise<ConsortAbstractResult> {
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
  return JSON.parse(textBlock.text) as ConsortAbstractResult;
}

/** An RCT-design gate, checked client-side so non-randomized trials never trigger a call. */
export function isRandomizedDesign(studyDesign: string | null): boolean {
  return !!studyDesign && /randomi[sz]ed/i.test(studyDesign);
}

/**
 * Shared by both the batch runner and the manual-entry action: runs the
 * checklist (only when applicable) and persists both the itemized rows and
 * the summary counts on trial_publications. Never throws — a failure here
 * shouldn't undo an otherwise-successful comparison.
 */
export async function runAndPersistConsortCheck(
  supabase: SupabaseClient,
  publicationId: string,
  ctriId: string,
  studyDesign: string | null,
  isPrimaryReport: boolean,
  publicationTitle: string | null,
  publicationAbstract: string | null
): Promise<void> {
  const applicable = isPrimaryReport && isRandomizedDesign(studyDesign) && !!publicationAbstract;
  await supabase
    .from("trial_publications")
    .update({
      reporting_checklist_applicable: applicable,
      reporting_checklist_guideline: applicable ? "consort_for_abstracts" : null,
    })
    .eq("id", publicationId);
  if (!applicable) return;

  const result = await checkConsortAbstract({ ctriId, publicationTitle, publicationAbstract });
  await supabase.from("publication_reporting_checklist").delete().eq("publication_id", publicationId);
  await supabase.from("publication_reporting_checklist").insert(
    result.items.map((it) => ({
      publication_id: publicationId,
      guideline: "consort_for_abstracts",
      item_name: it.item_name,
      reported: it.reported,
      note: it.note,
    }))
  );
  const reportedCount = result.items.filter((it) => it.reported).length;
  await supabase
    .from("trial_publications")
    .update({
      reporting_checklist_items_reported: reportedCount,
      reporting_checklist_items_total: result.items.length,
    })
    .eq("id", publicationId);
}
