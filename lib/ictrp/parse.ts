import * as cheerio from "cheerio";

export interface ParsedTrial {
  ctriId: string;
  register: string;
  titleScientific: string | null;
  titlePublic: string | null;
  studyType: string | null;
  studyDesign: string | null;
  phase: string | null;
  condition: string | null;
  intervention: string | null;
  primaryOutcomes: string | null;
  secondaryOutcomes: string | null;
  targetSampleSizeTotal: number | null;
  primarySponsor: string | null;
  recruitmentStatus: string | null;
  registrationDate: string | null;
  dateFirstEnrollment: string | null;
  ethicsApprovalStatus: string | null;
  countriesOfRecruitment: string | null;
  secondaryIds: string | null;
  raw: Record<string, string>;
}

/** dd-mm-yyyy (ICTRP's display format) -> yyyy-mm-dd, or null if unparseable. */
function toIsoDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function toInt(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Section labels rendered as a header row followed by a separate value row,
 * rather than the page's usual "Label: value" two-cell rows. */
const SECTION_HEADER_LABELS = new Set([
  "health condition(s) or problem(s) studied",
  "intervention(s)",
  "primary outcome(s)",
  "secondary outcome(s)",
]);

/**
 * WHO's trial detail page ("This record shows only N elements of the WHO
 * Trial Registration Data Set") mixes two row shapes for the fields we
 * need: most fields ("Register:", "Main ID:", dates, ...) are clean
 * two-cell "Label: value" rows; a handful of longer free-text sections
 * (condition, intervention, primary/secondary outcomes) instead render as
 * a one-cell header row ("Health Condition(s) or Problem(s) studied", no
 * colon) immediately followed by a separate one-cell value row.
 */
export function parseTrialDetail(html: string): ParsedTrial | null {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};

  const rows = $("table tr").toArray();
  for (let i = 0; i < rows.length; i++) {
    const cells = $(rows[i])
      .find("td, th")
      .map((_, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();

    if (cells.length === 2 && /:$/.test(cells[0])) {
      const label = cells[0].replace(/:$/, "").trim().toLowerCase();
      // Don't overwrite an already-populated field with a later, blanker duplicate
      // (e.g. "Contact type:" repeats for Scientific/Public contacts).
      if (!(label in fields) || (!fields[label] && cells[1])) {
        fields[label] = cells[1];
      }
      continue;
    }

    if (cells.length === 1) {
      const label = cells[0].trim().toLowerCase();
      if (SECTION_HEADER_LABELS.has(label) && !(label in fields)) {
        const valueCells = $(rows[i + 1])
          ?.find("td, th")
          .map((_, td) => $(td).text().replace(/\s+/g, " ").trim())
          .get();
        if (valueCells && valueCells.length === 1) {
          fields[label] = valueCells[0];
        }
      }
    }
  }

  const ctriId = fields["main id"];
  const register = fields["register"];
  if (!ctriId || !register) return null;

  return {
    ctriId,
    register,
    titleScientific: fields["scientific title"] || null,
    titlePublic: fields["public title"] || null,
    studyType: fields["study type"] || null,
    studyDesign: fields["study design"] || null,
    phase: fields["phase"] || null,
    condition: fields["health condition(s) or problem(s) studied"] || null,
    intervention: fields["intervention(s)"] || null,
    primaryOutcomes: fields["primary outcome(s)"] || null,
    secondaryOutcomes: fields["secondary outcome(s)"] || null,
    targetSampleSizeTotal: toInt(fields["target sample size"]),
    primarySponsor: fields["primary sponsor"] || null,
    recruitmentStatus: fields["recruitment status"] || null,
    registrationDate: toIsoDate(fields["date of registration"]),
    dateFirstEnrollment: toIsoDate(fields["date of first enrolment"]),
    ethicsApprovalStatus: fields["status"] || null,
    countriesOfRecruitment: fields["countries of recruitment"] || null,
    secondaryIds: fields["secondary id(s)"] || null,
    raw: fields,
  };
}

/** Keyword pre-filter, refined later by Claude during Phase 1 title analysis. */
export function keywordSuggestsAyurveda(t: ParsedTrial): boolean {
  const haystack = [t.titleScientific, t.titlePublic, t.intervention, t.condition, t.primarySponsor]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /ayurved/.test(haystack);
}
