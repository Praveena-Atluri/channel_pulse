import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountViewRevenue,
  getSessionAccount
} from "@/lib/auth";
import { resolveWeeklyRequest } from "@/lib/weekly-request";
import {
  ensureWeeklyPerformanceData,
  getWeeklyPerformanceDashboard,
  sanitizeWeeklyPerformanceForViewer
} from "@/lib/weekly-performance";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const resolved = await resolveWeeklyRequest(request, account);
  if ("error" in resolved) return resolved.error;
  const canViewRevenue = canAccountViewRevenue(account);

  try {
    await ensureWeeklyPerformanceData({ ...resolved, requireRevenue: canViewRevenue });
    const dashboard = await getWeeklyPerformanceDashboard(resolved);
    const visibleDashboard = canViewRevenue ? dashboard : sanitizeWeeklyPerformanceForViewer(dashboard);
    return NextResponse.json(visibleDashboard);
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
