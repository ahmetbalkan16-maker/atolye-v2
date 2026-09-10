import { type NextRequest, NextResponse } from "next/server";

import {
  AYAS_SESSION_COOKIE,
  resolveAccessGate,
  verifySession,
  isSameOriginRequest,
} from "@/lib/auth/accessGate";
import { loadBrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import { loadBrainSelfHealSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { loadAyasStudioContext } from "@/lib/ayas/AyasStudioContext";
import { streamAyasChat, ayasChatStreamEventToSse } from "@/lib/ayas/AyasChatStream";
import {
  buildAyasReportSpokenAnswer,
  detectAyasReportIntent,
} from "@/lib/brain/selfheal/BrainReportCenter";
import type { BrainChatMessage } from "@/components/brain/brainCore";

/**
 * `POST /api/ayas/chat/stream` (spec §4) — token-streamed AYAS reply as SSE.
 *
 * Same auth as the rest of the app (middleware + a re-check here) + a same-origin
 * CSRF backstop for this state-changing verb. Body:
 *   { text: string, history?: {role,text}[], seq?: number }
 * Response: `text/event-stream` of `AyasChatStreamEvent` frames — `delta`* then
 * one `done`. The stream runs nothing: text in, text (deltas) out. The execution
 * gate is not touched.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_TEXT = 4_000;
const MAX_HISTORY = 12;

async function requireAuthenticated(request: NextRequest): Promise<boolean> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode === "disabled-dev") return true;
  if (gate.mode !== "enforced") return false;
  const token = request.cookies.get(AYAS_SESSION_COOKIE)?.value;
  return verifySession(token, gate.key as string);
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await requireAuthenticated(request))) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  if (
    !isSameOriginRequest({
      method: request.method,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      host: request.headers.get("host"),
    })
  ) {
    return NextResponse.json({ error: "cross_origin_request_blocked" }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as { text?: unknown; history?: unknown; seq?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > MAX_TEXT) {
    return NextResponse.json({ error: "invalid_text" }, { status: 400 });
  }
  const history: { role: BrainChatMessage["role"]; text: string }[] = Array.isArray(b.history)
    ? (b.history as unknown[])
        .filter(
          (t): t is { role: BrainChatMessage["role"]; text: string } =>
            !!t &&
            typeof t === "object" &&
            typeof (t as { text?: unknown }).text === "string" &&
            ["user", "brain", "system"].includes((t as { role?: unknown }).role as string),
        )
        .slice(-MAX_HISTORY)
    : [];
  const seq = Number.isSafeInteger(b.seq) ? (b.seq as number) : history.length + 1;

  const encoder = new TextEncoder();

  // "AYAS, rapor ver" / "onay bekleyen ne" (§11) — deterministic Report Center
  // answer, one terminal SSE frame, no model call, runs nothing.
  const reportIntent = detectAyasReportIntent(text);
  if (reportIntent) {
    const rc = loadBrainSelfHealSnapshot().reportCenter;
    const answer = buildAyasReportSpokenAnswer(rc, reportIntent);
    const oneShot = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            ayasChatStreamEventToSse({ type: "done", text: answer, source: "fallback", corrected: false }),
          ),
        );
        controller.close();
      },
    });
    return new Response(oneShot, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const [snapshot, studio] = await Promise.all([loadBrainConsoleSnapshot(), loadAyasStudioContext()]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamAyasChat({
          text,
          snapshot,
          studio,
          history,
          seq,
          signal: request.signal,
        })) {
          controller.enqueue(encoder.encode(ayasChatStreamEventToSse(event)));
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            ayasChatStreamEventToSse({
              type: "done",
              text: "AYAS şu an yanıt veremiyor; metin sohbeti çalışıyor.",
              source: "fallback",
              corrected: true,
              reason: "stream-error",
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
