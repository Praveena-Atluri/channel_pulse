import { NextRequest, NextResponse } from "next/server";
import { CHANNEL_PULSE_SESSION_COOKIE, canAccountViewRevenue, getSessionAccount } from "@/lib/auth";
import { validateDailyStatusSelection } from "@/lib/daily-status";
import { getDailyStatusData, getRangeRecentFetcher } from "@/lib/daily-status-data";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") ?? "";
  const ids = [...new Set(request.nextUrl.searchParams.getAll("channel"))];
  const refresh = request.nextUrl.searchParams.get("refresh");
  if (refresh !== null && refresh !== "0" && refresh !== "1") return NextResponse.json({ error: "Invalid refresh option." }, { status: 400 });
  try {
    const channels = (await listStoredYoutubeManagedChannels()).filter((channel) =>
      account.channelIds === null || account.channelIds.includes(channel.channelId));
    try { validateDailyStatusSelection(date, ids, channels.map((channel) => channel.channelId)); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid selection." }, { status: 400 }); }
    const rangeStart = request.nextUrl.searchParams.get("rangeStart");
    const rangeEnd = request.nextUrl.searchParams.get("rangeEnd");
    if (rangeStart !== null || rangeEnd !== null) {
      try {
        validateDailyStatusSelection(rangeStart ?? "", ids, channels.map((channel) => channel.channelId));
        validateDailyStatusSelection(rangeEnd ?? "", ids, channels.map((channel) => channel.channelId));
        if (rangeStart! > date || rangeEnd! < date || Date.parse(rangeEnd!) - Date.parse(rangeStart!) > 1095 * 86_400_000) throw new Error("Invalid range.");
      } catch { return NextResponse.json({ error: "Invalid recent-video refresh range." }, { status: 400 }); }
    }
    const selectedChannels = channels.filter((channel) => ids.includes(channel.channelId)).map(({ channelId, title }) => ({ channelId, title }));
    const data = await getDailyStatusData({ date, channels: selectedChannels, canViewRevenue: canAccountViewRevenue(account), forceRefresh: refresh === "1",
      ...(rangeStart && rangeEnd ? { recentFetcher: getRangeRecentFetcher(rangeStart, rangeEnd) } : {}) });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load daily status. Please try again." }, { status: 502 });
  }
}
