import { NextResponse, type NextRequest } from "next/server";
import {
  AYAS_SESSION_COOKIE,
  resolveAccessGate,
  verifySession,
} from "@/lib/auth/accessGate";
import { createAyasIntentLedger } from "@/lib/ayas/intake/AyasIntentLedger";
import { readAyasBoundedJsonBody } from "@/lib/ayas/security/AyasBoundedRequestBody";
import type { AyasQueuedIntent } from "@/lib/ayas/intake/AyasIntentPipeline";

/**
 * AYAS reconnect intake (Master Sprint §21–23).
 *
 * `POST` — the phone syncs the batch of intents it recorded while the PC was
 * offline. Every intent runs the full chain
 * (AUTH → AUTHORIZATION → ACTION POLICY → EXECUTION GATE); the response carries
 * a per-intent decision. Execution/forbidden intents are DENIED at the closed
 * gate and never run. Idempotent — replaying a batch is a no-op.
 *
 * `GET` — the ledger state (`entries`, `highWaterSeq`) the phone reconciles
 * against.
 *
 * The route is already behind `middleware.ts`; it also re-verifies the session
 * itself when the gate is enforced, so the pipeline's AUTH step is real.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

async function requireAuthenticated(request: NextRequest): Promise<boolean> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode === "disabled-dev") return true;
  if (gate.mode !== "enforced") return false;
  const token = request.cookies.get(AYAS_SESSION_COOKIE)?.value;
  return verifySession(token, gate.key as string);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await requireAuthenticated(request))) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  try {
    const state = createAyasIntentLedger().read();
    return NextResponse.json({
      executionGate: "CLOSED",
      highWaterSeq: state.highWaterSeq,
      updatedAt: state.updatedAt,
      entries: state.entries,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "ledger_unreadable", detail: errorCode(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authenticated = await requireAuthenticated(request);
  if (!authenticated) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const parsed = await readAyasBoundedJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: parsed.reason === "payload_too_large" ? 413 : 400 });
  const body = parsed.value;
  const intents = (body as { intents?: unknown })?.intents;
  if (!Array.isArray(intents)) {
    return NextResponse.json(
      { error: "expected_intents_array" },
      { status: 400 },
    );
  }

  try {
    const result = createAyasIntentLedger().admit(
      intents as AyasQueuedIntent[],
      { authenticated: true },
    );
    return NextResponse.json({
      executionGate: "CLOSED",
      highWaterSeq: result.highWaterSeq,
      ledgerChanged: result.ledgerChanged,
      outcomes: result.outcomes.map((outcome) => ({
        clientIntentId: outcome.clientIntentId,
        clientSeq: outcome.clientSeq,
        decision: outcome.decision,
        duplicate: outcome.duplicate,
        stored: outcome.stored,
        classification: outcome.evaluation?.classification ?? outcome.entry?.classification ?? null,
        reason: outcome.evaluation?.reason ?? outcome.entry?.reason ?? "",
        steps: outcome.evaluation?.steps ?? [],
      })),
    });
  } catch (error) {
    const code = errorCode(error);
    const status = code.includes("BATCH_TOO_LARGE")
      ? 413
      : code.includes("FULL")
        ? 409
        : code.includes("SECRET_LEAK") || code.includes("CORRUPT") || code.includes("SCHEMA")
          ? 422
          : 500;
    return NextResponse.json({ error: "intake_failed", detail: code }, { status });
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}
