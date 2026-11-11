import { NextResponse, type NextRequest } from "next/server";
import {
  admitLoginAttempt,
  AYAS_SESSION_COOKIE,
  AYAS_SESSION_TTL_SECONDS,
  clearAttempts,
  evaluateAttempt,
  isPlausibleAccessKey,
  isRequestOverHttps,
  issueSession,
  LOGIN_BRAKE_OPTIONS,
  loginClientBucket,
  newLoginBrakeState,
  pruneAttempts,
  resolveAccessGate,
  safeRedirectPath,
  settleLoginAttempt,
  timingSafeEqual,
  type AttemptLimiterState,
} from "@/lib/auth/accessGate";

/**
 * POST /api/auth/login — exchange the shared passcode for a session cookie.
 *
 * Accepts JSON (`{ "key": "..." }`) or an HTML form (`key=...`). A form post
 * gets a 303 redirect to `?next=` (or `/brain`); a JSON post gets `{ ok }`.
 * Online guessing is bounded by a per-client fixed window plus a worldwide brake
 * on failed attempts (11 Nov 2026 security review): past either, attempts are
 * checked one per slot after a short wait instead of being locked out.
 */

const attempts = new Map<string, AttemptLimiterState>();
const brake = newLoginBrakeState();
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_SECONDS = 10 * 60;
const MAX_BUCKETS = 1000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode !== "enforced") {
    return NextResponse.json(
      { error: `access_gate_${gate.mode.replace("-", "_")}`, detail: gate.reason },
      { status: gate.mode === "misconfigured" ? 503 : 409 },
    );
  }

  // The body is read first so that admission, the passcode check and the
  // failure count below run without an await between them (only the slow
  // lane's wait): a burst of parallel guesses cannot all pass before the first
  // failure is counted.
  const { key, isForm, next } = await readCredential(request);

  const bucket = loginClientBucket(request.headers.get("x-forwarded-for"));
  pruneAttempts(attempts, MAX_BUCKETS);
  const decision = evaluateAttempt(
    attempts,
    bucket,
    { limit: ATTEMPT_LIMIT, windowSeconds: ATTEMPT_WINDOW_SECONDS },
  );
  const admission = admitLoginAttempt(brake, !decision.allowed, LOGIN_BRAKE_OPTIONS);
  if (admission.kind === "refuse") {
    return NextResponse.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds) } },
    );
  }
  if (admission.kind === "wait") {
    await new Promise((resolve) => setTimeout(resolve, admission.waitMs));
  }

  const ok =
    isPlausibleAccessKey(key) && timingSafeEqual(key, gate.key as string);
  settleLoginAttempt(brake, ok, LOGIN_BRAKE_OPTIONS);

  if (!ok) {
    return respond(request, isForm, next, {
      status: 401,
      json: { error: "invalid_passcode" },
      redirectTo: `/login?error=1${next ? `&next=${encodeURIComponent(next)}` : ""}`,
    });
  }

  clearAttempts(attempts, bucket);
  const token = await issueSession(gate.key as string);
  const secure = isRequestOverHttps({
    urlProtocol: request.nextUrl.protocol,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedSsl: request.headers.get("x-forwarded-ssl"),
    nodeEnv: process.env.NODE_ENV,
  });
  const response = respond(request, isForm, next, {
    status: 200,
    json: { ok: true },
    redirectTo: safeRedirectPath(next) ?? "/brain",
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
    // A relative Location, not an absolute URL built from `request.nextUrl`:
    // under `next start`, `request.nextUrl` resolves to the server's own
    // bind address (`localhost:<port>`) regardless of the real Host /
    // X-Forwarded-Host, which broke this redirect for every client that
    // isn't the server itself (confirmed via the phone tunnel). A relative
    // Location is resolved by the browser against the page's actual origin
    // (RFC 7231 §7.1.2), so this is correct behind any reverse proxy.
    return new NextResponse(null, { status: 303, headers: { location: options.redirectTo } });
  }
  return NextResponse.json(options.json, { status: options.status });
}
