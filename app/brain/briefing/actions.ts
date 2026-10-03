"use server";
/** Owner acknowledgement and actual local UI delivery metadata only. No proposal approval or execution. */
import { cookies } from "next/headers";
import { AYAS_SESSION_COOKIE, resolveAccessGate, verifySession } from "../../../src/lib/auth/accessGate";
import { loadAyasExecutiveOwnerView, type AyasExecutiveOwnerView } from "../../../src/lib/ayas/briefing/AyasExecutiveBriefingService";
import { recordOwnerAyasExecutiveAlert } from "../../../src/lib/ayas/briefing/AyasExecutiveAlertStore";
async function ownerSession(): Promise<string> {
  const session = (await cookies()).get(AYAS_SESSION_COOKIE)?.value, gate = resolveAccessGate();
  if (gate.mode !== "enforced" || !gate.key || !await verifySession(session,gate.key)) throw new Error("AYAS_BRIEFING_OWNER_SESSION_REQUIRED");
  return session!;
}
export async function refreshOwnerExecutiveBriefing(): Promise<AyasExecutiveOwnerView> {
  await ownerSession(); return loadAyasExecutiveOwnerView({synchronize:true,ownerAuthenticated:true});
}
export async function recordOwnerExecutiveAttention(raw: unknown): Promise<void> {
  const session = await ownerSession();
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join("|") !== "alertId|fingerprint|operation") throw new Error("AYAS_BRIEFING_ARGUMENT_INVALID");
  const v = raw as Record<string,unknown>;
  if (!["ACKNOWLEDGE","DELIVERED"].includes(String(v.operation)) || typeof v.alertId !== "string" || !/^[a-f0-9]{64}$/.test(v.alertId)
    || typeof v.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(v.fingerprint)) throw new Error("AYAS_BRIEFING_ARGUMENT_INVALID");
  await recordOwnerAyasExecutiveAlert({repoRoot:process.cwd(),operation:v.operation as "ACKNOWLEDGE"|"DELIVERED",alertId:v.alertId,fingerprint:v.fingerprint,ownerSession:session});
}
