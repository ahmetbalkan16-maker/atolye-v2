"use server";

import { cookies } from "next/headers";
import { AYAS_SESSION_COOKIE, resolveAccessGate, verifySession } from "@/lib/auth/accessGate";
import { loadBrainCouncil, type BrainCouncilView } from "@/lib/v3/council/BrainCouncilFeed";
import { resolveV3Paths } from "@/lib/v3/V3Paths";

/**
 * The office's only server call: the V3 council feed (who works now), read-only, behind the owner's session.
 *
 * A narrow module on purpose. Importing `app/brain/observerActions` would pull the Control Center and approval-inbox
 * loaders into the office page's import closure, and the action firewall (smoke-ayas-action-firewall-closure) then
 * counts the page as a new entry point reaching owner-only work. This file reaches only the council feed.
 */
export async function readOfficeCouncil(): Promise<BrainCouncilView> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode !== "disabled-dev") {
    if (gate.mode !== "enforced") throw new Error("office_live_unavailable");
    const token = (await cookies()).get(AYAS_SESSION_COOKIE)?.value;
    if (!await verifySession(token, gate.key as string)) throw new Error("authentication_required");
  }
  return loadBrainCouncil(resolveV3Paths().workRoot);
}
