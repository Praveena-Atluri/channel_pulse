import { getDailyStatusToday, shiftDailyStatusDay, type DailyStatusChannel, type DailyStatusData } from "@/lib/daily-status";

export function getDailyStatusRefreshWindow(now = new Date()) {
  const endDate = shiftDailyStatusDay(getDailyStatusToday(now), -1);
  const startDate = shiftDailyStatusDay(endDate, -9);
  return { startDate, endDate, dates: Array.from({ length: 10 }, (_, index) => shiftDailyStatusDay(startDate, index)) };
}
export function getBackfillWindow(startDate: string, endDate: string) {
  for (const date of [startDate, endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Invalid backfill date.");
  }
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  if (days < 1 || days > 1096 || endDate > getDailyStatusToday()) throw new Error("Invalid backfill range.");
  return { startDate, endDate, dates: Array.from({ length: days }, (_, index) => shiftDailyStatusDay(startDate, index)) };
}
export type DailyStatusRefreshProgress = { storedDays: number; pendingDays: number; failedDays: number };

export async function refreshDailyStatusWindow(input: {
  channels: DailyStatusChannel[];
  now?: Date;
  range?: ReturnType<typeof getBackfillWindow>;
  signal?: AbortSignal;
  refreshTotals: (channel: DailyStatusChannel, startDate: string, endDate: string) => Promise<void>;
  refreshDay: (channel: DailyStatusChannel, date: string) => Promise<DailyStatusData>;
  progress?: (progress: DailyStatusRefreshProgress) => Promise<void>;
}) {
  const range = input.range ?? getDailyStatusRefreshWindow(input.now);
  const progress: DailyStatusRefreshProgress = { storedDays: 0, pendingDays: 0, failedDays: 0 };
  const queue = [...input.channels];
  let stopped = false;
  const checkStopped = () => { if (input.signal?.aborted || stopped) throw new Error("Refresh interrupted"); };
  const results = await Promise.allSettled(Array.from({ length: Math.min(2, queue.length) }, () => (async () => {
    for (let channel = queue.shift(); channel; channel = queue.shift()) {
      checkStopped();
      let totalsFailed = false;
      try { await input.refreshTotals(channel, range.startDate, range.endDate); }
      catch { totalsFailed = true; }
      for (const date of range.dates) {
        checkStopped();
        try {
          const data = await input.refreshDay(channel, date);
          const row = data.rows.find((row) => row.channelId === channel!.channelId);
          const recent = row?.recentVideos;
          if (recent?.status === "available" && (recent.source === "youtube" || recent.source === "cache") && !recent.cacheWarning) {
            progress.storedDays++;
            if (totalsFailed || row!.allVideos.status !== "available" || recent.values?.estimatedRevenue === null || recent.values?.estimatedRevenue === undefined ||
              (recent.updatedAt !== undefined && recent.revenueUpdatedAt !== recent.updatedAt)) progress.pendingDays++;
          } else progress.failedDays++;
        } catch { progress.failedDays++; }
        await input.progress?.({ ...progress });
      }
    }
  })().catch((error) => { stopped = true; throw error; })));
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return { ...range, ...progress };
}
