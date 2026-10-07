import { createDatabaseAdminClient } from "@/lib/database";
import {
  buildMonthlyGrowthData, growthMonthEnd, shiftGrowthMonth, type MonthlyGrowthChannel,
  type MonthlyGrowthDailyRow, type MonthlyGrowthSelection
} from "@/lib/monthly-growth";
import { rangeUsesMixedPublicViewMethodology } from "@/lib/youtube-performance-utils";

const COLUMNS = {
  views: ["views"], engagedViews: ["engaged_views"], watchHours: ["estimated_minutes_watched"],
  netSubscribers: ["subscribers_gained", "subscribers_lost"], estimatedRevenue: ["estimated_revenue"]
};

export async function getMonthlyGrowthData(selection: MonthlyGrowthSelection, channels: MonthlyGrowthChannel[], today: string) {
  const startDate = `${shiftGrowthMonth(selection.startMonth, -1)}-01`;
  const endDate = selection.endMonth === today.slice(0, 7) ? today : growthMonthEnd(selection.endMonth);
  const db = createDatabaseAdminClient();
  const columns = ["channel_id", "day", ...selection.metrics.flatMap((metric) => COLUMNS[metric])].join(",");
  const rows: MonthlyGrowthDailyRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("youtube_channel_daily_metrics").select(columns)
      .in("channel_id", selection.channelIds).gte("day", startDate).lte("day", endDate)
      .order("channel_id", { ascending: true }).order("day", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as MonthlyGrowthDailyRow[]));
    if (!data || data.length < pageSize) break;
  }
  return buildMonthlyGrowthData({
    selection, channels, rows, today,
    publicViewMethodologyWarning: selection.metrics.includes("views") && rangeUsesMixedPublicViewMethodology(startDate, endDate)
  });
}
