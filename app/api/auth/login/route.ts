import { NextResponse, type NextRequest } from "next/server";
import {
  AYAS_SESSION_COOKIE,
  AYAS_SESSION_TTL_SECONDS,
  clearAttempts,
  evaluateAttempt,
  isPlausibleAccessKey,
  issueSession,
  resolveAccessGate,
  timingSafeEqual,
  type AttemptLimiterState,
} from "@/lib/auth/accessGate";

/**
 * POST /api/auth/login — exchange the shared passcode for a session cookie.
 *
 * Accepts JSON (`{ "key": "..." }`) or an HTML form (`key=...`). A form post
 * gets a 303 redirect to `?next=` (or `/brain`); a JSON post gets `{ ok }`.
 * Per-IP fixed-window rate limiting blunts online guessing.
 */

const attempts = new Map<string, AttemptLimiterState>();
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_SECONDS = 10 * 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode !== "enforced") {
    return NextResponse.json(
      { error: `access_gate_${gate.mode.replace("-", "_")}`, detail: gate.reason },
      { status: gate.mode === "misconfigured" ? 503 : 409 },
    );
  }

  const bucket = clientBucket(request);
  const decision = evaluateAttempt(
    attempts,
    bucket,
    { limit: ATTEMPT_LIMIT, windowSeconds: ATTEMPT_WINDOW_SECONDS },
  );
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }

  const { key, isForm, next } = await readCredential(request);
  const ok =
    isPlausibleAccessKey(key) && timingSafeEqual(key, gate.key as string);

  if (!ok) {
    return respond(request, isForm, next, {
      status: 401,
      json: { error: "invalid_passcode" },
      redirectTo: `/login?error=1${next ? `&next=${encodeURIComponent(next)}` : ""}`,
    });
  }

  clearAttempts(attempts, bucket);
  const token = await issueSession(gate.key as string);
  const secure = request.nextUrl.protocol === "https:";
  const response = respond(request, isForm, next, {
    status: 200,
    json: { ok: true },
    redirectTo: safeNext(next) ?? "/brain",
  });
  response.cookies.set({
    name: AYAS_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: AYAS_SESSION_TTL_SECONDS,
  });
  return response;
}

async function readCredential(
  request: NextRequest,
): Promise<{ key: string; isForm: boolean; next: string | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { key?: unknown };
      return {
        key: typeof body.key === "string" ? body.key : "",
        isForm: false,
        next: request.nextUrl.searchParams.get("next"),
      };
    }
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      const key = form.get("key");
      const next = form.get("next");
      return {
        key: typeof key === "string" ? key : "",
        isForm: true,
        next: typeof next === "string" ? next : null,
      };
    }
  } catch {
    // fall through to empty credential
  }
  return { key: "", isForm: false, next: null };
}

function respond(
  request: NextRequest,
  isForm: boolean,
  next: string | null,
  options: {
    status: number;
    json: Record<string, unknown>;
    redirectTo: string;
  },
): NextResponse {
  void next;
  if (isForm) {
    return NextResponse.redirect(new URL(options.redirectTo, request.nextUrl), 303);
  }
  return NextResponse.json(options.json, { status: options.status });
}

function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function clientBucket(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return `login:${ip}`;
}
