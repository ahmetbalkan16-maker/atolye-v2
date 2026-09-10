import { type NextRequest, NextResponse } from "next/server";

import {
  AYAS_SESSION_COOKIE,
  resolveAccessGate,
  verifySession,
  isSameOriginRequest,
  evaluateAttempt,
  type AttemptLimiterState,
} from "@/lib/auth/accessGate";
import { resolveAyasSttConfig } from "@/lib/ayas/stt/AyasSttConfig";
import { transcribeAyasAudio, type AyasSttFailureCode } from "@/lib/ayas/stt/AyasSttService";
import { ayasSttThermalHold } from "@/lib/ayas/stt/AyasSttThermal";

/**
 * `POST /api/ayas/stt` — one audio clip → one Turkish transcript.
 *
 * Same auth as `/api/ayas/chat/stream` (session cookie + same-origin CSRF
 * backstop) + a per-session rate limit. The audio blob goes to a temp file and
 * fixed local executables (ffmpeg, whisper.cpp — both resolved from env, never
 * from the request); nothing here runs a shell, opens the execution gate, runs
 * a pipeline, or writes to a project. The transcript is handed back to the
 * client, which sends it down the EXISTING chat path.
 *
 * OFF by default: with no `AYAS_WHISPER_EXECUTABLE` / `AYAS_WHISPER_MODEL` this
 * returns `503 stt-not-configured` and nothing spawns.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT = { limit: 30, windowSeconds: 60 };
const attempts = new Map<string, AttemptLimiterState>();

async function requireAuthenticated(request: NextRequest): Promise<{ ok: boolean; bucket: string }> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode === "disabled-dev") return { ok: true, bucket: "dev" };
  if (gate.mode !== "enforced") return { ok: false, bucket: "none" };
  const token = request.cookies.get(AYAS_SESSION_COOKIE)?.value;
  const ok = await verifySession(token, gate.key as string);
  return { ok, bucket: token ? token.slice(0, 24) : "anon" };
}

const STATUS_BY_CODE: Partial<Record<AyasSttFailureCode, number>> = {
  "stt-not-configured": 503,
  "thermal-hold": 503,
  "audio-too-large": 413,
  "audio-unsupported": 415,
  "audio-empty": 400,
  "audio-too-long": 400,
  "decode-failed": 422,
  "transcribe-failed": 500,
  "transcribe-timeout": 504,
  "empty-transcript": 422,
};

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuthenticated(request);
  if (!auth.ok) {
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

  const rate = evaluateAttempt(attempts, `stt:${auth.bucket}`, RATE_LIMIT);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const config = resolveAyasSttConfig(process.env);
  if (!config.enabled) {
    return NextResponse.json({ error: "stt-not-configured", detail: config.reason }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > config.maxAudioBytes) {
    return NextResponse.json({ error: "audio-too-large" }, { status: 413 });
  }
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json") || contentType.includes("text/")) {
    return NextResponse.json({ error: "audio-unsupported" }, { status: 415 });
  }

  let audio: Uint8Array;
  try {
    audio = new Uint8Array(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "audio-empty" }, { status: 400 });
  }
  if (audio.byteLength > config.maxAudioBytes) {
    return NextResponse.json({ error: "audio-too-large" }, { status: 413 });
  }

  const result = await transcribeAyasAudio(audio, { config, thermalHold: ayasSttThermalHold });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, detail: result.detail },
      { status: STATUS_BY_CODE[result.code] ?? 500 },
    );
  }

  return NextResponse.json({
    text: result.text,
    language: result.language,
    audioSeconds: result.audioSeconds,
    processingMs: result.processingMs,
    realTimeFactor: result.realTimeFactor,
    // Whisper's own per-token confidence (min / mean, 0..1) — observability only,
    // lets the client tell "mis-heard the words" from "misunderstood the words".
    confidence: result.confidence,
  });
}
