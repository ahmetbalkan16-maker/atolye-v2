import { NextResponse, type NextRequest } from "next/server";
import { AYAS_SESSION_COOKIE } from "@/lib/auth/accessGate";

/** POST /api/auth/logout — clear the session cookie. */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return response;
}
