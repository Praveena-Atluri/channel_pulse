export type DailyStatusChannel = { channelId: string; title: string };
export type DailyStatusMetrics = { views: number; watchHours: number; netSubscribers: number; estimatedRevenue?: number };
export type RecentVideoMetrics = { views: number; watchHours: number; videoCount: number; estimatedRevenue?: number | null };
export const DAILY_STATUS_METRICS = [
  { key: "views", label: "Total views", section: "allVideos", valueKey: "views" },
  { key: "watchHours", label: "Watch hours", section: "allVideos", valueKey: "watchHours" },
  { key: "netSubscribers", label: "Net subscribers", section: "allVideos", valueKey: "netSubscribers" },
  { key: "estimatedRevenue", label: "Estimated revenue (USD)", section: "allVideos", valueKey: "estimatedRevenue" },
  { key: "recentViews", label: "Recent-video views", section: "recentVideos", valueKey: "views" },
  { key: "recentWatchHours", label: "Recent-video watch hours", section: "recentVideos", valueKey: "watchHours" },
  { key: "recentRevenue", label: "Recent-video revenue (USD)", section: "recentVideos", valueKey: "estimatedRevenue" }
] as const;
export type DailyStatusMetric = (typeof DAILY_STATUS_METRICS)[number]["key"];
export function getSelectedDailyStatusMetrics(selected: readonly DailyStatusMetric[], canViewRevenue: boolean) {
  return DAILY_STATUS_METRICS.filter((metric) => selected.includes(metric.key) && (canViewRevenue || metric.valueKey !== "estimatedRevenue"));
}
export type DailyStatusSection<T> = {
  status: "available" | "missing" | "error" | "incomplete";
  values: T | null;
  message?: string;
  source?: "cache" | "youtube";
  updatedAt?: string;
  stale?: boolean;
  cacheWarning?: string;
  revenueUpdatedAt?: string;
};
export type DailyStatusRow = DailyStatusChannel & {
  allVideos: DailyStatusSection<DailyStatusMetrics>;
  recentVideos: DailyStatusSection<RecentVideoMetrics>;
};
export type DailyStatusData = {
  date: string;
  publicationWindow: ReturnType<typeof getDailyStatusWindow>;
  generatedAt: string;
  rows: DailyStatusRow[];
  totals: Pick<DailyStatusRow, "allVideos" | "recentVideos">;
};
export type DailyStatusStoredRow = {
  channel_id: string; day: string; views: number | string;
  estimated_minutes_watched: number | string;
  subscribers_gained: number | string; subscribers_lost: number | string;
  estimated_revenue?: number | string;
};

const DAY_MS = 86_400_000;
export function getDailyStatusToday(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
export function shiftDailyStatusDay(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
export function validateDailyStatusSelection(date: string, ids: string[], allowedIds: string[], today = getDailyStatusToday()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date < "2005-01-01" || date > today) {
    throw new Error("Select a valid date from 2005 through today.");
  }
  if (!ids.length || ids.some((id) => !allowedIds.includes(id))) throw new Error("Select at least one accessible channel.");
}
export function getDailyStatusWindow(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 3, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  const startDate = target.toISOString().slice(0, 10);
  return {
    startDate, endDate: date,
    startDateTime: new Date(Date.parse(`${startDate}T00:00:00Z`) - 330 * 60_000).toISOString(),
    endDateTime: new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS - 330 * 60_000).toISOString()
  };
}
export function isInDailyStatusWindow(publishedAt: string | null, window: ReturnType<typeof getDailyStatusWindow>) {
  const timestamp = Date.parse(publishedAt ?? "");
  return timestamp >= Date.parse(window.startDateTime) && timestamp < Date.parse(window.endDateTime);
}
export function statusNumber(value: unknown) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
    throw new Error("A required analytics metric is unavailable.");
  }
  return Number(value);
}

// These dependencies deliberately exclude the period-based video metrics table.
export async function loadRecentVideoStatus(input: {
  date: string; channelId: string;
  catalog: (window: ReturnType<typeof getDailyStatusWindow>) => Promise<Array<{ videoId: string; channelId: string; publishedAt: string | null }>>;
  report: (videoIds?: string[]) => Promise<Array<Record<string, unknown>>>;
  revenueReport?: (videoIds?: string[]) => Promise<Array<Record<string, unknown>>>;
}): Promise<DailyStatusSection<RecentVideoMetrics>> {
  try {
    const window = getDailyStatusWindow(input.date);
    const catalog = await input.catalog(window);
    if (catalog.some((video) => !video.publishedAt || !Number.isFinite(Date.parse(video.publishedAt)))) {
      throw new Error("Incomplete publication metadata.");
    }
    const ids = [...new Set(catalog.filter((video) => video.channelId === input.channelId && isInDailyStatusWindow(video.publishedAt, window)).map((video) => video.videoId))];
    if (!ids.length) return { status: "available", values: { views: 0, watchHours: 0, videoCount: 0, ...(input.revenueReport ? { estimatedRevenue: 0 } : {}) } };
    // Establish reporting availability before interpreting omitted zero-activity batch rows.
    const probe = await input.report();
    if (!probe.some((row) => row.day === input.date)) return { status: "missing", values: null, message: "YouTube analytics is not available for this day yet." };
    let views = 0;
    let minutes = 0;
    for (let offset = 0; offset < ids.length; offset += 100) {
      const rows = await input.report(ids.slice(offset, offset + 100));
      for (const row of rows) {
        if (row.day !== input.date) throw new Error("Unexpected reporting date.");
        views += statusNumber(row.views);
        minutes += statusNumber(row.estimatedMinutesWatched);
      }
    }
    let estimatedRevenue: number | null = null;
    if (input.revenueReport) {
      try {
        const revenueProbe = await input.revenueReport();
        if (revenueProbe.some((row) => row.day === input.date)) {
          estimatedRevenue = 0;
          for (let offset = 0; offset < ids.length; offset += 100) {
            const rows = await input.revenueReport(ids.slice(offset, offset + 100));
            for (const row of rows) {
              if (row.day !== input.date) throw new Error("Unexpected revenue reporting date.");
              estimatedRevenue += statusNumber(row.estimatedRevenue);
            }
          }
        }
      } catch { estimatedRevenue = null; }
    }
    return { status: "available", values: { views, watchHours: minutes / 60, videoCount: ids.length,
      ...(input.revenueReport ? { estimatedRevenue } : {}) } };
  } catch {
    return { status: "error", values: null, message: "Recent-video data could not be fully loaded. Retry to try again." };
  }
}

export async function buildDailyStatusData(input: {
  date: string; channels: DailyStatusChannel[]; canViewRevenue: boolean;
  dailyRows: () => Promise<DailyStatusStoredRow[]>;
  recent: (channel: DailyStatusChannel) => Promise<DailyStatusSection<RecentVideoMetrics>>;
}): Promise<DailyStatusData> {
  const dailyPromise = input.dailyRows().then((rows) => ({ rows, failed: false })).catch(() => ({ rows: [] as DailyStatusStoredRow[], failed: true }));
  // Limit active channel jobs; each job batches its video filters sequentially.
  const recentById = new Map<string, DailyStatusSection<RecentVideoMetrics>>();
  const queue = [...input.channels];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let channel = queue.shift(); channel; channel = queue.shift()) {
      try { recentById.set(channel.channelId, await input.recent(channel)); }
      catch { recentById.set(channel.channelId, { status: "error", values: null, message: "Recent-video data could not be loaded. Retry to try again." }); }
    }
  }));
  const daily = await dailyPromise;
  const rows = input.channels.map((channel): DailyStatusRow => {
    const stored = daily.rows.find((row) => row.channel_id === channel.channelId && row.day === input.date);
    let allVideos: DailyStatusSection<DailyStatusMetrics> = { status: daily.failed ? "error" : "missing", values: null,
      message: daily.failed ? "Daily metrics could not be loaded. Retry to try again." : "No stored analytics for this day." };
    if (stored) {
      try {
        allVideos = { status: "available", values: {
          views: statusNumber(stored.views), watchHours: statusNumber(stored.estimated_minutes_watched) / 60,
          netSubscribers: statusNumber(stored.subscribers_gained) - statusNumber(stored.subscribers_lost),
          ...(input.canViewRevenue ? { estimatedRevenue: statusNumber(stored.estimated_revenue) } : {})
        } };
      } catch { allVideos = { status: "incomplete", values: null, message: "Stored daily metrics are incomplete." }; }
    }
    const recentVideos = recentById.get(channel.channelId)!;
    if (!input.canViewRevenue && recentVideos.values) {
      const { estimatedRevenue: _revenue, ...values } = recentVideos.values;
      const { revenueUpdatedAt: _revenueTime, ...section } = recentVideos;
      return { ...channel, allVideos, recentVideos: { ...section, values } };
    }
    return { ...channel, allVideos, recentVideos };
  });
  const combine = <T extends object>(sections: DailyStatusSection<T>[]): DailyStatusSection<T> => {
    if (!sections.length || sections.some((section) => section.status !== "available" || !section.values)) {
      return { status: "incomplete", values: null, message: "Combined total unavailable: data is missing for one or more selected channels." };
    }
    const values: Record<string, number | null> = {};
    const keys = [...new Set(sections.flatMap((section) => Object.keys(section.values!)))];
    for (const key of keys) {
      const points = sections.map((section) => (section.values as Record<string, unknown>)[key]);
      values[key] = points.some((value) => value === null || value === undefined) ? null : points.reduce<number>((sum, value) => sum + statusNumber(value), 0);
    }
    const timestamps = sections.flatMap((section) => section.updatedAt ? [section.updatedAt] : []).sort();
    const warnings = [...new Set(sections.flatMap((section) => section.cacheWarning ? [section.cacheWarning] : []))];
    const messages = [...new Set(sections.flatMap((section) => section.message ? [section.message] : []))];
    const revenueTimes = sections.flatMap((section) => section.revenueUpdatedAt ? [section.revenueUpdatedAt] : []).sort();
    return { status: "available", values: values as T,
      ...(timestamps.length ? { updatedAt: timestamps[0] } : {}),
      ...(revenueTimes.length ? { revenueUpdatedAt: revenueTimes[0] } : {}),
      ...(sections.some((section) => section.stale) ? { stale: true } : {}),
      ...(warnings.length ? { cacheWarning: warnings.join(" ") } : {}),
      ...(messages.length ? { message: messages.join(" ") } : {}) };
  };
  return { date: input.date, publicationWindow: getDailyStatusWindow(input.date), generatedAt: new Date().toISOString(), rows,
    totals: { allVideos: combine(rows.map((row) => row.allVideos)), recentVideos: combine(rows.map((row) => row.recentVideos)) } };
}
