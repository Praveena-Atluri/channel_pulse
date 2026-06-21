import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountViewRevenue,
  getSessionAccount
} from "@/lib/auth";
import { resolveWeeklyRequest } from "@/lib/weekly-request";
import {
  ensureWeeklyPerformanceData,
  getWeeklyPerformanceDashboard
} from "@/lib/weekly-performance";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountViewRevenue(account)) {
    return NextResponse.json({ error: "Only admins can view weekly performance." }, { status: 403 });
  }

  const resolved = await resolveWeeklyRequest(request, account);
  if ("error" in resolved) return resolved.error;

  try {
    await ensureWeeklyPerformanceData(resolved);
    const dashboard = await getWeeklyPerformanceDashboard(resolved);
    return NextResponse.json(dashboard);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 502 });
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unable to load weekly performance.";
  }
}
