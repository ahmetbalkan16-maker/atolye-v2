import { NextResponse, type NextRequest } from "next/server";
import {
  AYAS_SESSION_COOKIE,
  isLoopbackDevRequest,
  isProtectedPath,
  isSameOriginRequest,
  resolveAccessGate,
  verifySession,
} from "@/lib/auth/accessGate";
import { contentSecurityPolicyFor, type ContentSecurityPolicyHeader } from "@/lib/auth/contentSecurityPolicy";
import { isSessionTokenRevoked } from "@/lib/auth/sessionRevocation";

/**
 * AYAS access gate (Master Sprint §24).
 *
 * - `enforced`  → protected paths need a valid `ayas_session` cookie; state-
 *   changing requests also need a same-origin `Origin`/`Referer` (CSRF backstop).
 * - `disabled-dev` → no `AYAS_ACCESS_KEY` set and not production: pass through
 *   for requests made on this machine (stamped with a header so the state is
 *   visible); any other request gets 403.
 * - `misconfigured` → production with no / too-short key: fail closed (503) on
 *   protected paths rather than serve an open studio.
 *
 * Every response also carries the per-request Content-Security-Policy (`contentSecurityPolicy.ts`), whose nonce is
 * handed to Next on the request so it can stamp its own scripts. Runs on the Node.js runtime (19 Nov 2026) so the
 * session check can see logouts recorded on disk (`sessionRevocation.ts`); the edge runtime shares no file or memory
 * with the route that records them.
 *
 * The Execution Gate is untouched by this file — authentication only.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  // API responses are data, not documents, and keep their own policy: a header set here would win over the route's
  // (Next appends a route header only when the middleware did not set it), e.g. the inert policy on served SVG assets.
  const csp = request.nextUrl.pathname.startsWith("/api/")
    ? null
    : contentSecurityPolicyFor(process.env, process.env.NEXT_PUBLIC_AYAS_WORKER_URL);
  return withPolicy(await gate(request, csp), csp);
}

async function gate(request: NextRequest, csp: ContentSecurityPolicyHeader | null): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return pass(request, csp);
  }

  const gate = resolveAccessGate(process.env);

  if (gate.mode === "disabled-dev") {
    // An open gate serves only this machine (11 Nov 2026 security review;
    // limits in `isLoopbackDevRequest`). `enforced` / `misconfigured` never
    // reach this check.
    if (
      !isLoopbackDevRequest({
        host: request.headers.get("host"),
        forwardedFor: request.headers.get("x-forwarded-for"),
        cfConnectingIp: request.headers.get("cf-connecting-ip"),
      })
    ) {
      return devRemoteRefusal(pathname, request);
    }
    const response = pass(request, csp);
    response.headers.set("x-ayas-access-gate", "disabled-dev");
    return response;
  }

  if (gate.mode === "misconfigured") {
    return jsonOrRedirect(request, pathname, 503, {
      error: "access_gate_misconfigured",
      detail: gate.reason,
    });
  }

  // enforced
  if (
    !isSameOriginRequest({
      method: request.method,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      host: request.headers.get("host"),
    })
  ) {
    return NextResponse.json(
      { error: "cross_origin_request_blocked" },
      { status: 403 },
    );
  }

  const token = request.cookies.get(AYAS_SESSION_COOKIE)?.value;
  // Signature and expiry first; only a cookie that passes them is looked up among the logged-out ones.
  const valid = await verifySession(token, gate.key as string) && !await isSessionTokenRevoked(token, gate.key as string);
  if (valid) {
    const response = pass(request, csp);
    response.headers.set("x-ayas-access-gate", "enforced");
    return response;
  }

  return jsonOrRedirect(request, pathname, 401, { error: "authentication_required" });
}

/** Lets the request through with the policy on the request headers, where Next reads the nonce while rendering. */
function pass(request: NextRequest, csp: ContentSecurityPolicyHeader | null): NextResponse {
  if (!csp) return NextResponse.next();
  const headers = new Headers(request.headers);
  // A client-sent policy header must never choose the nonce Next stamps on its scripts.
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.set(csp.name, csp.value);
  return NextResponse.next({ request: { headers } });
}

function withPolicy(response: NextResponse, csp: ContentSecurityPolicyHeader | null): NextResponse {
  if (csp) response.headers.set(csp.name, csp.value);
  return response;
}

const DEV_REMOTE_REFUSAL =
  "AYAS bu bilgisayarda erişim anahtarı olmadan (geliştirme modu) çalışıyor; bu modda yalnız bu bilgisayardan " +
  "(localhost) açılabilir. Başka bir cihazdan açmak için .env.local dosyasına en az 12 karakterlik " +
  "AYAS_ACCESS_KEY yazıp sunucuyu yeniden başlatın.";

function devRemoteRefusal(pathname: string, request: NextRequest): NextResponse {
  const wantsJson =
    pathname.startsWith("/api/") ||
    (request.headers.get("accept") ?? "").includes("application/json");
  const response = wantsJson
    ? NextResponse.json({ error: "access_gate_dev_local_only", detail: DEV_REMOTE_REFUSAL }, { status: 403 })
    : new NextResponse(DEV_REMOTE_REFUSAL, {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
  response.headers.set("x-ayas-access-gate", "disabled-dev");
  return response;
}

function jsonOrRedirect(
  request: NextRequest,
  pathname: string,
  status: number,
  body: Record<string, string>,
): NextResponse {
  const wantsJson =
    pathname.startsWith("/api/") ||
    (request.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) {
    return NextResponse.json(body, { status });
  }
  const loginUrl = new URL("/login", request.nextUrl);
  // Preserve the FULL path+query, not just the pathname — a request like
  // `/brain?ayasPhoneKey=<key>` (the Phone LLM gateway's one-time bootstrap
  // link, see `ayasPhoneFallback.ts`) previously lost `ayasPhoneKey` right
  // here: an unauthenticated visit redirected to `/login?next=%2Fbrain`,
  // the query string silently dropped, so after login `BrainCoreConsole`
  // mounted on bare `/brain` with no `ayasPhoneKey` to bootstrap into
  // localStorage — the Phone LLM Lab page's `resolvePhoneLlmNetworkFetch`
  // then always saw `getStoredAyasPhoneKey() === null` and failed with
  // `gateway-not-configured`, regardless of how many times the bootstrap
  // link was opened. `app/login/page.tsx`'s `safeNext` and
  // `app/api/auth/login/route.ts`'s `safeNext` both already accept and
  // preserve a full path+query `next` value unchanged — this was the only
  // broken link in that chain.
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  const redirect = NextResponse.redirect(loginUrl);
  redirect.headers.set("x-ayas-access-gate", status === 503 ? "misconfigured" : "enforced");
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};
