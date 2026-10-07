import { NextRequest, NextResponse } from "next/server";
import { CHANNEL_PULSE_SESSION_COOKIE, canAccountViewRevenue, getSessionAccount } from "@/lib/auth";
import { getMonthlyGrowthToday, validateMonthlyGrowthSelection } from "@/lib/monthly-growth";
import { getMonthlyGrowthData } from "@/lib/monthly-growth-data";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const channels = (await listStoredYoutubeManagedChannels()).filter(
      (channel) => account.channelIds === null || account.channelIds.includes(channel.channelId)
    );
    const params = request.nextUrl.searchParams;
    const today = getMonthlyGrowthToday();
    let selection;
    try {
      selection = validateMonthlyGrowthSelection({
        startMonth: params.get("startMonth") ?? "", endMonth: params.get("endMonth") ?? "",
        channelIds: params.getAll("channel"), metrics: params.getAll("metric")
      }, today.slice(0, 7), channels.map((channel) => channel.channelId), canAccountViewRevenue(account));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid filters." }, { status: 400 });
    }
    return NextResponse.json(await getMonthlyGrowthData(selection, channels, today), {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Unable to load monthly growth. Please try again." }, { status: 502 });
  }
}
