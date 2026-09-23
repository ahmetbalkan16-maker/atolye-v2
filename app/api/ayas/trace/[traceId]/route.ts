import { type NextRequest, NextResponse } from "next/server";

import { AYAS_SESSION_COOKIE, resolveAccessGate, verifySession } from "@/lib/auth/accessGate";
import { ayasTraceSessionScope, ayasTraceStore, isAyasTraceId } from "@/lib/ayas/trace/AyasUnifiedTrace";

export const dynamic = "force-dynamic";

async function requireAuthenticated(request: NextRequest): Promise<boolean> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode === "disabled-dev") return true;
  if (gate.mode !== "enforced") return false;
  const token = request.cookies.get(AYAS_SESSION_COOKIE)?.value;
  return verifySession(token, gate.key as string);
}

/** Read-only, same-session diagnostic view. A trace ID is never an authority token. */
export async function GET(request: NextRequest, context: { params: Promise<{ traceId: string }> }): Promise<Response> {
  if (!(await requireAuthenticated(request))) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { traceId } = await context.params;
  // Malformed, forged, foreign and unknown IDs are indistinguishable: all 404.
  const trace = isAyasTraceId(traceId) ? ayasTraceStore.get(traceId, ayasTraceSessionScope(request.cookies.get(AYAS_SESSION_COOKIE)?.value)) : undefined;
  return trace
    ? NextResponse.json(trace, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "trace_not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
