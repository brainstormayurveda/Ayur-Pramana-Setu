import { cookies } from "next/headers";

const COOKIE_NAME = "admin_passcode";

export async function requireAdmin() {
  const store = await cookies();
  const secret = process.env.CRON_SECRET;
  if (!secret || store.get(COOKIE_NAME)?.value !== secret) {
    throw new Error("Not authorized. Enter the admin passcode first.");
  }
}

export async function isAdminAuthed(): Promise<boolean> {
  const store = await cookies();
  const secret = process.env.CRON_SECRET;
  return !!secret && store.get(COOKIE_NAME)?.value === secret;
}
