import { after, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  authenticateAccount,
  createSessionToken,
  getAuthCookieOptions,
  isAuthConfigured,
  sanitizeNextPath
} from "@/lib/auth";
import { runLoginYoutubeSync } from "@/lib/login-youtube-sync";

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = getFormValue(formData, "username");
  const password = getFormValue(formData, "password");
  const nextPath = sanitizeNextPath(getFormValue(formData, "next"));

  if (!isAuthConfigured()) {
    return redirectToLogin(request, "config", nextPath);
  }

  const account = authenticateAccount(username, password);
  if (!account) {
    return redirectToLogin(request, "invalid", nextPath);
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
  response.cookies.set(CHANNEL_PULSE_SESSION_COOKIE, await createSessionToken(account.username), getAuthCookieOptions());
  after(async () => {
    await runLoginYoutubeSync(account);
  });

  return response;
}

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function redirectToLogin(request: Request, error: string, nextPath: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  url.searchParams.set("next", nextPath);

  return NextResponse.redirect(url, { status: 303 });
}
