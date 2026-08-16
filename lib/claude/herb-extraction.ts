import { claudeClient } from "./client";

/**
 * Extracts genuine Ayurvedic herb/plant-derived ingredients from a trial's
 * registered intervention text, so they can be looked up against external
 * pharmacology/physiology literature (Semantic Scholar) independent of the
 * CTRI-to-publication matching pipeline. Intervention text is often messy —
 * dosage instructions, placeholder names ("Test Product A"), non-herbal
 * comparators (minoxidil) — so this is a judgment call, not a keyword match.
 */

export interface HerbExtractionInput {
  ctriId: string;
  intervention: string | null;
  condition: string | null;
}

export interface ExtractedHerb {
  herb_name: string;
  scientific_name: string | null;
  source_text: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    herbs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          herb_name: {
            type: "string",
            description: "Normalized common/Sanskrit name of the herb or plant-derived ingredient, e.g. 'Ashwagandha', 'Guduchi', 'Triphala'. Use the most recognizable common name, not a brand/product name.",
          },
          scientific_name: {
            type: ["string", "null"],
            description: "Latin binomial if identifiable from the text or well-established common knowledge (e.g. 'Withania somnifera' for Ashwagandha). Null if genuinely uncertain — do not guess.",
          },
          source_text: {
            type: "string",
            description: "The short snippet of the intervention text that names this herb, quoted or closely paraphrased.",
          },
        },
        required: ["herb_name", "scientific_name", "source_text"],
        additionalProperties: false,
      },
    },
  },
  required: ["herbs"],
  additionalProperties: false,
} as const;

function buildPrompt(t: HerbExtractionInput): string {
  return `Extract every genuine Ayurvedic herb or plant-derived ingredient named in this trial's registered
intervention text. This is for building a literature-search index, so precision matters more than recall —
skip anything you're not confident is an actual named herb/plant.

Condition: ${t.condition ?? "(not provided)"}
Intervention (as registered): ${t.intervention ?? "(not provided)"}

Rules:
- Extract only genuine herbs, plants, or classical Ayurvedic plant-derived formulations (e.g. Triphala,
  Chyawanprash) — not placeholder/brand product names ("Test Product A", "CelWel"), not non-herbal
  comparators (minoxidil, placebo), not generic terms ("herbal oil" with no named ingredient).
- If a branded/named product's underlying herbal ingredients ARE stated in the text (e.g. "CelWel
  product-containing natural extracts of tinospora cordifolia... guduchi"), extract the actual herb
  (Tinospora cordifolia / Guduchi), not the brand name.
- Deduplicate: if the same herb is named more than once (e.g. by both common and Sanskrit name referring to
  the same plant), list it once.
- If genuinely no identifiable herb is named (e.g. the intervention is yoga, a device, or an unnamed
  "polyherbal" product with no ingredients listed), return an empty array — do not invent herbs.
- Return your assessment as structured output matching the given schema.`;
}

export async function extractHerbs(input: HerbExtractionInput): Promise<ExtractedHerb[]> {
  const client = claudeClient();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`No text block in response for ${input.ctriId}`);
  }
  const parsed = JSON.parse(textBlock.text) as { herbs: ExtractedHerb[] };
  return parsed.herbs;
}
