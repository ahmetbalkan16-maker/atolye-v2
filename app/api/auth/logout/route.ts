import { NextResponse, type NextRequest } from "next/server";
import { AYAS_SESSION_COOKIE, isRequestOverHttps, isSameOriginRequest, resolveAccessGate } from "@/lib/auth/accessGate";
import { revokeSession } from "@/lib/auth/sessionRevocation";

/**
 * POST /api/auth/logout — end the session: the server records the cookie as logged out (`sessionRevocation.ts`, owner
 * approval 19 Nov 2026), so a copy of it is refused from now on, and the browser is told to forget it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // `/api/auth/` is open in `middleware.ts`, so its same-origin backstop never ran here (14 Nov 2026 audit): any site
  // could post a form here and sign the owner out. Same rule as every gated state-changing request.
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

  const gate = resolveAccessGate(process.env);
  if (gate.mode === "enforced") {
    const revocation = await revokeSession(request.cookies.get(AYAS_SESSION_COOKIE)?.value, gate.key as string);
    // The browser cookie is cleared below either way; a failed record is logged, never hidden as a success.
    if (revocation.kind === "write-failed") console.error(`[ayas-logout] server-side revocation not recorded: ${revocation.reason}`);
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  const response = isForm
    ? // Relative Location (same as the login route): `request.nextUrl` carries the
      // server's bind address, so an absolute URL sent phones to localhost.
      new NextResponse(null, { status: 303, headers: { location: "/login" } })
    : NextResponse.json({ ok: true });

  response.cookies.set({
    name: AYAS_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    // The same `Secure` decision as the login that set the cookie: under `next start` behind the tunnel
    // `request.nextUrl` is always `http://127.0.0.1`, so the old protocol check never matched the login's attributes.
    secure: isRequestOverHttps({
      urlProtocol: request.nextUrl.protocol,
      forwardedProto: request.headers.get("x-forwarded-proto"),
      forwardedSsl: request.headers.get("x-forwarded-ssl"),
      nodeEnv: process.env.NODE_ENV,
    }),
    path: "/",
    maxAge: 0,
  });
  return response;
}
