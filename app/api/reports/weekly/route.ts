import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountViewRevenue,
  getSessionAccount
} from "@/lib/auth";
import {
  buildWeeklyReportRows,
  ensureWeeklyPerformanceData,
  getWeeklyPerformanceDashboard
} from "@/lib/weekly-performance";
import { resolveWeeklyRequest } from "@/lib/weekly-request";
import { buildXlsxWorkbook } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountViewRevenue(account)) {
    return NextResponse.json({ error: "Only admins can download weekly reports." }, { status: 403 });
  }

  const resolved = await resolveWeeklyRequest(request, account);
  if ("error" in resolved) return resolved.error;

  try {
    await ensureWeeklyPerformanceData(resolved);
    const dashboard = await getWeeklyPerformanceDashboard(resolved);
    const rows = buildWeeklyReportRows(dashboard);
    const workbook = buildXlsxWorkbook({
      columnWidth: 22,
      rows,
      sheetName: "Weekly Performance"
    });
    const filename = [
      "channel-pulse-weekly-performance",
      resolved.startDate,
      "to",
      resolved.endDate,
      `${resolved.channels.length}-channels`
    ].join("-");

    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
        "Content-Type": EXCEL_MIME_TYPE
      }
    });
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
    return "Unable to download weekly performance.";
  }
}
