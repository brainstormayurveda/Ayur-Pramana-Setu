import * as cheerio from "cheerio";

/**
 * Thin client for the WHO ICTRP Search Portal (trialsearch.who.int).
 *
 * The portal is a classic ASP.NET WebForms app with no JSON/REST API. This
 * client drives it as plain HTTP form posts (the site's "Add country"
 * widget needs client-side JS we can't replicate headlessly, so ingestion
 * filters via free-text title/condition/intervention search instead, then
 * narrows to true CTRI records using the "Register:" field on each trial's
 * detail page — see lib/ictrp/ingest.ts).
 *
 * WHO's own docs confirm this data is "publicly available for downloading
 * ... at no charge" with a weekly update cadence, matching our cron.
 */

const BASE = "https://trialsearch.who.int";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type HiddenFields = Record<string, string>;

export interface IctrpSession {
  cookies: string;
}

function extractHiddenFields($: cheerio.CheerioAPI): HiddenFields {
  const fields: HiddenFields = {};
  $("input[type=hidden]").each((_, el) => {
    const name = $(el).attr("name");
    if (name) fields[name] = $(el).attr("value") || "";
  });
  return fields;
}

function extractCookies(res: Response): string {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

export async function startSession(): Promise<{ session: IctrpSession; hidden: HiddenFields }> {
  const res = await fetch(`${BASE}/AdvSearch.aspx`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ICTRP form GET failed: ${res.status}`);
  const cookies = extractCookies(res);
  const html = await res.text();
  const $ = cheerio.load(html);
  return { session: { cookies }, hidden: extractHiddenFields($) };
}

export interface SearchParams {
  /** Free-text search term(s), supports inline "OR"/"AND"/"NOT", applied across title+condition+intervention. */
  term: string;
  /** "1" = Recruiting only, "ALL" = all recruitment statuses. */
  recruitingStatus?: "1" | "ALL";
  pageSize?: "10" | "20" | "50" | "100";
}

export interface SearchResult {
  html: string;
  hidden: HiddenFields;
  totalTrials: number | null;
}

function buildSearchBody(hidden: HiddenFields, params: SearchParams): URLSearchParams {
  // IMPORTANT: only include hidden fields from the fresh GET plus this
  // minimal set — proven against the live site. Adding fields that aren't
  // part of a fresh page load's EVENTVALIDATION-registered control set
  // (postbacktextbox/postbacktextbox1, lstCountries*, txtPrimarySponsor,
  // txtDateStart/End, ListBoxPhase, ddlPageSize, ...) makes the server
  // reject the postback and redirect to a generic "temporarily
  // unavailable" error page — even though those fields exist on the
  // rendered form and look harmless to set explicitly.
  return new URLSearchParams({
    ...hidden,
    "ctl00$ContentPlaceHolder1$ddlTitle": "OperatorNone",
    "ctl00$ContentPlaceHolder1$txtTitle": params.term,
    "ctl00$ContentPlaceHolder1$ddlOperatorCondition": "OperatorOR",
    "ctl00$ContentPlaceHolder1$txtCondition": params.term,
    "ctl00$ContentPlaceHolder1$ddlOperatorIntervention": "OperatorOR",
    "ctl00$ContentPlaceHolder1$txtIntervention": params.term,
    "ctl00$ContentPlaceHolder1$ddlRecruitingStatus": params.recruitingStatus ?? "ALL",
    "ctl00$ContentPlaceHolder1$btnSearch": "Search",
  });
}

function parseTotalTrials(html: string): number | null {
  const m = html.match(/([\d,]+)\s*records for\s*([\d,]+)\s*trials found/i);
  if (!m) return null;
  return parseInt(m[2].replace(/,/g, ""), 10);
}

export async function search(session: IctrpSession, hidden: HiddenFields, params: SearchParams): Promise<SearchResult> {
  const body = buildSearchBody(hidden, params);
  const res = await fetch(`${BASE}/AdvSearch.aspx`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: session.cookies,
      Referer: `${BASE}/AdvSearch.aspx`,
      Origin: BASE,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`ICTRP search POST failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  return { html, hidden: extractHiddenFields($), totalTrials: parseTotalTrials(html) };
}

/**
 * The GridView pager ("dlPager2") only shows a *window* of page-number
 * links at a time (e.g. from page 1: "2 3 4 5 6 7 8 9 10 Last") — there is
 * no direct link to page 11 until you click into the next window. Rather
 * than compute a page's control index by formula (fragile — the ctl
 * numbering restarts per window), find the target link's exact
 * __EVENTTARGET fresh from each response: either the next sequential page
 * number if it's in the currently visible window, or "Last" to jump ahead
 * when it isn't.
 */
export function findPagerTarget(html: string, wantPageLabel: string): string | null {
  const $ = cheerio.load(html);
  let target: string | null = null;
  $("a[href*='dlPager2'][href*='WebForm_DoPostBackWithOptions']").each((_, el) => {
    if ($(el).text().trim() === wantPageLabel) {
      const href = $(el).attr("href") || "";
      const m = href.match(/WebForm_PostBackOptions\("([^"]+)"/);
      if (m) target = m[1];
    }
  });
  return target;
}

export async function postback(session: IctrpSession, hidden: HiddenFields, eventTarget: string): Promise<SearchResult> {
  const body = new URLSearchParams({
    ...hidden,
    __EVENTTARGET: eventTarget,
    __EVENTARGUMENT: "",
  });
  const res = await fetch(`${BASE}/AdvSearch.aspx`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: session.cookies,
      Referer: `${BASE}/AdvSearch.aspx`,
      Origin: BASE,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`ICTRP pagination POST failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  return { html, hidden: extractHiddenFields($), totalTrials: parseTotalTrials(html) };
}

export function extractTrialIdsFromResults(html: string): string[] {
  const $ = cheerio.load(html);
  const ids: string[] = [];
  $("a[href*='Trial2.aspx?TrialID=']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/TrialID=([^&]+)/);
    if (m) ids.push(decodeURIComponent(m[1]));
  });
  return [...new Set(ids)];
}

export async function fetchTrialDetailHtml(trialId: string): Promise<string> {
  const res = await fetch(`${BASE}/Trial2.aspx?TrialID=${encodeURIComponent(trialId)}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`ICTRP trial detail GET failed for ${trialId}: ${res.status}`);
  return res.text();
}
