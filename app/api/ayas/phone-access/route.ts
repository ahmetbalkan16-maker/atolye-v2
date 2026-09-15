import { NextResponse } from "next/server";
import { readAyasPhoneAccessHealth, type AyasPhoneAccessHealth } from "@/lib/runtime/access/AyasPhoneAccessHealth";

/**
 * AYAS phone access status (Phone Access Practicality sprint).
 *
 * Read-only. Protected by the same access gate as every other `/api/**`
 * route (no `OPEN_*` entry added for this path) — a logged-in session, on
 * LAN or through an already-open tunnel, can check the CURRENT daemon status
 * (including the live, ephemeral Quick Tunnel URL) through the app itself
 * instead of needing terminal/file access on the PC. This turns "the status
 * file exists" into "a user can actually determine the current phone-access
 * endpoint" — closing that gap for anyone who is already connected somehow
 * (LAN, or a still-live prior tunnel session).
 *
 * Does NOT solve remote discovery of a BRAND NEW tunnel URL after a reboot
 * for someone with no LAN access at all — that residual is real and
 * documented (REMOTE URL DISCOVERY RESIDUAL), not something this route can
 * paper over: reaching this route at all already requires reaching *some*
 * live AYAS endpoint first.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(): NextResponse<AyasPhoneAccessHealth> {
  const health = readAyasPhoneAccessHealth();
  return NextResponse.json(health, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
