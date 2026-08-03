import { NextRequest, NextResponse } from "next/server";

import { CHANNEL_PULSE_SESSION_COOKIE, isAuthConfigured, isSessionTokenValid } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  if (!isAuthConfigured()) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Dashboard authentication is not configured." }, { status: 503 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "config");
    loginUrl.searchParams.set("next", getNextPath(request));
    return NextResponse.redirect(loginUrl);
  }

  const sessionToken = request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value;
  if (await isSessionTokenValid(sessionToken)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", getNextPath(request));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/",
    "/monthly/:path*",
    "/compare/:path*",
    "/reports/:path*",
    "/manual-refresh/:path*",
    "/api/youtube/:path*",
    "/api/reports/:path*"
  ]
};

function getNextPath(request: NextRequest) {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}
