"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ingestOnce } from "@/lib/ictrp/ingest";
import { runTitleAnalysis } from "@/lib/claude/run-title-analysis";
import { runMethodsAnalysis } from "@/lib/claude/run-methods-analysis";
import { computeFragmentationReport } from "@/lib/reports/fragmentation";
import { matchPublications } from "@/lib/europepmc/match";
import { runPublicationComparison } from "@/lib/claude/run-publication-comparison";

const COOKIE_NAME = "admin_passcode";

async function requireAdmin() {
  const store = await cookies();
  const secret = process.env.CRON_SECRET;
  if (!secret || store.get(COOKIE_NAME)?.value !== secret) {
    throw new Error("Not authorized. Enter the admin passcode first.");
  }
}

export async function verifyPasscode(formData: FormData) {
  const passcode = String(formData.get("passcode") ?? "");
  const secret = process.env.CRON_SECRET;
  if (!secret || passcode !== secret) {
    redirect("/admin?error=1");
  }
  const store = await cookies();
  store.set(COOKIE_NAME, passcode, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  redirect("/admin");
}

export async function logoutAdmin() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  redirect("/admin");
}

function parseLimit(formData: FormData): number | undefined {
  const raw = formData.get("limit");
  const n = raw ? parseInt(String(raw), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function runIngestAction(formData: FormData) {
  await requireAdmin();
  const limit = parseLimit(formData);
  const result = await ingestOnce(limit ? { limit } : {});
  redirect(`/admin?ran=ingest&summary=${encodeURIComponent(JSON.stringify(result))}`);
}

export async function runTitleAnalysisAction(formData: FormData) {
  await requireAdmin();
  const limit = parseLimit(formData);
  const result = await runTitleAnalysis(limit ? { limit } : {});
  redirect(`/admin?ran=titles&summary=${encodeURIComponent(JSON.stringify(result))}`);
}

export async function runMethodsAnalysisAction(formData: FormData) {
  await requireAdmin();
  const limit = parseLimit(formData);
  const result = await runMethodsAnalysis(limit ? { limit } : {});
  redirect(`/admin?ran=methods&summary=${encodeURIComponent(JSON.stringify(result))}`);
}

export async function runFragmentationAction() {
  await requireAdmin();
  const result = await computeFragmentationReport();
  redirect(`/admin?ran=fragmentation&summary=${encodeURIComponent(JSON.stringify(result))}`);
}

export async function runMatchPublicationsAction(formData: FormData) {
  await requireAdmin();
  const limit = parseLimit(formData);
  const result = await matchPublications(limit ? { limit } : {});
  redirect(`/admin?ran=matchpubs&summary=${encodeURIComponent(JSON.stringify(result))}`);
}

export async function runComparePublicationsAction(formData: FormData) {
  await requireAdmin();
  const limit = parseLimit(formData);
  const result = await runPublicationComparison(limit ? { limit } : {});
  redirect(`/admin?ran=comparepubs&summary=${encodeURIComponent(JSON.stringify(result))}`);
}
