import { createSupabaseAdminClient } from "@/lib/supabase";
import { ensureYoutubeAnalyticsRangeData } from "@/lib/youtube-auto-sync";
import type { StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";
import { calculateNetSubscribers, type VideoContentType } from "@/lib/youtube-performance-utils";
import {
  getDefaultWeeklyRange,
  getMonthToMonthRanges,
  getPreviousPeriodRange,
  getTrailingWeeklyRanges,
  type WeeklyDateRange
} from "@/lib/weekly-performance-utils";

export { getDefaultWeeklyRange, getMonthToMonthRanges, getPreviousPeriodRange, getTrailingWeeklyRanges };

export type WeeklyMetricValues = {
  adImpressions: number;
  ctr: number | null;
  estimatedRevenue: number;
  longVideosPublished: number;
  netSubscribers: number;
  playbackCpm: number;
  revenueGeneratingViews: number;
  rpm: number;
  shortVideosPublished: number;
  views: number;
  watchHours: number;
};

export type WeeklyMetricComparison = {
  absolute: number | null;
  current: number | null;
  percent: number | null;
  previous: number | null;
};

export type WeeklyChannelPerformanceRow = {
  channel: {
    channelId: string;
    thumbnailUrl: string | null;
    title: string;
  };
  current: WeeklyMetricValues;
  monthToMonth: Record<WeeklyComparisonMetric, WeeklyMetricComparison>;
  strengths: string[];
  weaknesses: string[];
  weeklyTrend: WeeklyTrendPoint[];
  weekOverWeek: Record<WeeklyComparisonMetric, WeeklyMetricComparison>;
};

export type WeeklyComparisonMetric = "views" | "watchHours" | "netSubscribers" | "estimatedRevenue" | "rpm";

export type WeeklyTrendPoint = {
  label: string;
  range: WeeklyDateRange;
  totals: WeeklyMetricValues;
};

export type WeeklyPerformanceDashboardData = {
  channels: Array<WeeklyChannelPerformanceRow["channel"]>;
  generatedAt: string;
  monthToDateRange: WeeklyDateRange;
  previousMonthRange: WeeklyDateRange;
  previousWeekRange: WeeklyDateRange;
  rows: WeeklyChannelPerformanceRow[];
  selectedRange: WeeklyDateRange;
  totals: {
    current: WeeklyMetricValues;
    monthToMonth: Record<WeeklyComparisonMetric, WeeklyMetricComparison>;
    weekOverWeek: Record<WeeklyComparisonMetric, WeeklyMetricComparison>;
  };
  weeklyTrend: WeeklyTrendPoint[];
};

type ChannelMetricRow = {
  ad_impressions: number | string | null;
  channel_id: string;
  day: string;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  impressions_click_through_rate?: number | string | null;
  monetized_playbacks: number | string | null;
  playback_based_cpm: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
  views: number | string | null;
};

type PublishedVideoRow = {
  channel_id: string;
  content_type: VideoContentType | null;
  published_at: string | null;
  video_id: string | null;
};

type MetricAccumulator = {
  adImpressions: number;
  ctrCount: number;
  ctrTotal: number;
  estimatedMinutesWatched: number;
  estimatedRevenue: number;
  monetizedPlaybacks: number;
  playbackCpmCount: number;
  playbackCpmTotal: number;
  subscribersGained: number;
  subscribersLost: number;
  views: number;
};

const COMPARISON_METRICS: WeeklyComparisonMetric[] = [
  "views",
  "watchHours",
  "netSubscribers",
  "estimatedRevenue",
  "rpm"
];
const SUPABASE_PAGE_SIZE = 1000;
const WEEKLY_SYNC_OPTIONS = {
  postSyncCheckAttempts: 1,
  throwOnIncomplete: false
};
const WEEKLY_SYNC_WAIT_LIMIT_MS = 10_000;

export async function ensureWeeklyPerformanceData({
  channels,
  endDate,
  startDate
}: {
  channels: StoredYoutubeManagedChannel[];
  endDate: string;
  startDate: string;
}) {
  const selectedRange = { endDate, startDate };
  const trailingWeekRanges = getTrailingWeeklyRanges(selectedRange);
  const syncStartDate = trailingWeekRanges[0]?.startDate ?? startDate;

  const syncPromise = ensureYoutubeAnalyticsRangeData({
    channels,
    endDate,
    startDate: syncStartDate,
    ...WEEKLY_SYNC_OPTIONS
  })
    .then((result) => ({
      ...result,
      timedOut: false
    }))
    .catch((error) => ({
      error: getErrorMessage(error),
      syncedChannels: 0,
      timedOut: false
    }));

  return Promise.race([
    syncPromise,
    sleep(WEEKLY_SYNC_WAIT_LIMIT_MS).then(() => ({
      syncedChannels: 0,
      timedOut: true
    }))
  ]);
}

export async function getWeeklyPerformanceDashboard({
  channels,
  endDate,
  startDate
}: {
  channels: StoredYoutubeManagedChannel[];
  endDate: string;
  startDate: string;
}): Promise<WeeklyPerformanceDashboardData> {
  const previousWeekRange = getPreviousPeriodRange({ endDate, startDate });
  const monthRanges = getMonthToMonthRanges(endDate);
  const trailingWeekRanges = getTrailingWeeklyRanges({ endDate, startDate });
  const weeklyTrendMetrics = await getWeeklyMetricValuesForRanges(channels, trailingWeekRanges);
  const monthToDateMetrics = new Map<string, WeeklyMetricValues>();
  const previousMonthMetrics = new Map<string, WeeklyMetricValues>();
  const currentMetrics = weeklyTrendMetrics[weeklyTrendMetrics.length - 1] ?? new Map<string, WeeklyMetricValues>();
  const previousWeekMetrics = weeklyTrendMetrics[weeklyTrendMetrics.length - 2] ?? new Map<string, WeeklyMetricValues>();
  const weeklyTrend = buildWeeklyTrendPoints(trailingWeekRanges, weeklyTrendMetrics);
  const rows = channels.map((channel) => {
    const current = currentMetrics.get(channel.channelId) ?? createEmptyMetricValues();
    const previousWeek = previousWeekMetrics.get(channel.channelId) ?? createEmptyMetricValues();
    const monthToDate = monthToDateMetrics.get(channel.channelId) ?? createEmptyMetricValues();
    const previousMonth = previousMonthMetrics.get(channel.channelId) ?? createEmptyMetricValues();

    return {
      channel: {
        channelId: channel.channelId,
        thumbnailUrl: channel.thumbnailUrl,
        title: channel.title
      },
      current,
      monthToMonth: buildComparisons(monthToDate, previousMonth),
      strengths: [],
      weaknesses: [],
      weeklyTrend: buildWeeklyTrendPoints(trailingWeekRanges, weeklyTrendMetrics, channel.channelId),
      weekOverWeek: buildComparisons(current, previousWeek)
    };
  });

  assignInsights(rows);

  return {
    channels: rows.map((row) => row.channel),
    generatedAt: new Date().toISOString(),
    monthToDateRange: monthRanges.current,
    previousMonthRange: monthRanges.previous,
    previousWeekRange,
    rows,
    selectedRange: { endDate, startDate },
    totals: {
      current: sumMetricValues(rows.map((row) => row.current)),
      monthToMonth: buildComparisons(
        sumMetricValues(Array.from(monthToDateMetrics.values())),
        sumMetricValues(Array.from(previousMonthMetrics.values()))
      ),
      weekOverWeek: buildComparisons(
        sumMetricValues(Array.from(currentMetrics.values())),
        sumMetricValues(Array.from(previousWeekMetrics.values()))
      )
    },
    weeklyTrend
  };
}

export function buildWeeklyReportRows(data: WeeklyPerformanceDashboardData) {
  const rows: Array<Array<string | number>> = [
    ["Weekly Performance", formatDateRange(data.selectedRange.startDate, data.selectedRange.endDate)],
    ["Previous Week", formatDateRange(data.previousWeekRange.startDate, data.previousWeekRange.endDate)],
    [],
    [
      "Channel",
      "Views",
      "Watch Hours",
      "Net Subscribers",
      "Estimated Revenue",
      "RPM",
      "Playback CPM",
      "Ad Impressions",
      "Long Videos Published",
      "Short Videos Published",
      "CTR",
      "Views WoW %",
      "Revenue WoW %",
      "Strengths",
      "Weaknesses"
    ]
  ];

  for (const row of data.rows) {
    rows.push([
      row.channel.title,
      row.current.views,
      round(row.current.watchHours),
      row.current.netSubscribers,
      round(row.current.estimatedRevenue),
      round(row.current.rpm),
      round(row.current.playbackCpm),
      row.current.adImpressions,
      row.current.longVideosPublished,
      row.current.shortVideosPublished,
      row.current.ctr === null ? "Unavailable" : round(normalizeCtrPercent(row.current.ctr)),
      roundNullable(row.weekOverWeek.views.percent),
      roundNullable(row.weekOverWeek.estimatedRevenue.percent),
      row.strengths.join("\n"),
      row.weaknesses.join("\n")
    ]);
  }

  return rows;
}

function assignInsights(rows: WeeklyChannelPerformanceRow[]) {
  const peerAverages = {
    estimatedRevenue: averagePositive(rows.map((row) => row.current.estimatedRevenue)),
    rpm: averagePositive(rows.map((row) => row.current.rpm)),
    views: averagePositive(rows.map((row) => row.current.views)),
    watchHours: averagePositive(rows.map((row) => row.current.watchHours))
  };

  for (const row of rows) {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const viewsWow = row.weekOverWeek.views.percent;
    const revenueWow = row.weekOverWeek.estimatedRevenue.percent;
    const watchWow = row.weekOverWeek.watchHours.percent;
    const subscribersWow = row.weekOverWeek.netSubscribers.absolute;

    if (viewsWow !== null && viewsWow >= 10) {
      strengths.push(`Views grew ${round(viewsWow)}% week over week.`);
    }
    if (revenueWow !== null && revenueWow >= 10) {
      strengths.push(`Estimated revenue grew ${round(revenueWow)}% week over week.`);
    }
    if (watchWow !== null && watchWow >= 10) {
      strengths.push(`Watch hours grew ${round(watchWow)}% week over week.`);
    }
    if (subscribersWow !== null && subscribersWow > 0) {
      strengths.push(`Net subscribers improved by ${subscribersWow} week over week.`);
    }
    if (peerAverages.rpm > 0 && row.current.rpm >= peerAverages.rpm * 1.1) {
      strengths.push("RPM is above the selected-channel peer average.");
    }
    if (peerAverages.views > 0 && row.current.views >= peerAverages.views * 1.1) {
      strengths.push("Views are above the selected-channel peer average.");
    }

    if (viewsWow !== null && viewsWow <= -10) {
      weaknesses.push(`Views declined ${round(Math.abs(viewsWow))}% week over week.`);
    }
    if (revenueWow !== null && revenueWow <= -10) {
      weaknesses.push(`Estimated revenue declined ${round(Math.abs(revenueWow))}% week over week.`);
    }
    if (watchWow !== null && watchWow <= -10) {
      weaknesses.push(`Watch hours declined ${round(Math.abs(watchWow))}% week over week.`);
    }
    if (subscribersWow !== null && subscribersWow < 0) {
      weaknesses.push(`Net subscribers reduced by ${Math.abs(subscribersWow)} week over week.`);
    }
    if (peerAverages.rpm > 0 && row.current.rpm < peerAverages.rpm * 0.85) {
      weaknesses.push("RPM is below the selected-channel peer average.");
    }
    if (peerAverages.views > 0 && row.current.views < peerAverages.views * 0.75) {
      weaknesses.push("Views are below the selected-channel peer average.");
    }

    row.strengths = strengths.length > 0 ? strengths.slice(0, 3) : ["Stable week with no major positive movement."];
    row.weaknesses = weaknesses.length > 0 ? weaknesses.slice(0, 3) : ["No major weakness flagged."];
  }
}

function buildComparisons(
  current: WeeklyMetricValues,
  previous: WeeklyMetricValues
): Record<WeeklyComparisonMetric, WeeklyMetricComparison> {
  return COMPARISON_METRICS.reduce(
    (comparisons, metric) => {
      comparisons[metric] = compareMetric(current[metric], previous[metric]);
      return comparisons;
    },
    {} as Record<WeeklyComparisonMetric, WeeklyMetricComparison>
  );
}

function getWeeklyTrendLabel(index: number, total: number) {
  const weeksBeforeSelected = total - index - 1;
  if (weeksBeforeSelected === 0) return "Selected week";
  if (weeksBeforeSelected === 1) return "Previous week";
  return `${weeksBeforeSelected} weeks ago`;
}

function buildWeeklyTrendPoints(
  ranges: WeeklyDateRange[],
  metricsByRange: Array<Map<string, WeeklyMetricValues>>,
  channelId?: string
): WeeklyTrendPoint[] {
  return ranges.map((range, index) => {
    const metrics = metricsByRange[index] ?? new Map<string, WeeklyMetricValues>();

    return {
      label: getWeeklyTrendLabel(index, ranges.length),
      range,
      totals: channelId ? metrics.get(channelId) ?? createEmptyMetricValues() : sumMetricValues(Array.from(metrics.values()))
    };
  });
}

function compareMetric(current: number | null, previous: number | null): WeeklyMetricComparison {
  if (current === null || previous === null) {
    return { absolute: null, current, percent: null, previous };
  }

  return {
    absolute: current - previous,
    current,
    percent: calculatePercentChange(current, previous),
    previous
  };
}

async function getWeeklyMetricValuesForRanges(
  channels: StoredYoutubeManagedChannel[],
  ranges: WeeklyDateRange[]
) {
  if (ranges.length === 0) return [];

  const channelIds = channels.map((channel) => channel.channelId);
  const startDate = ranges[0].startDate;
  const endDate = ranges[ranges.length - 1].endDate;
  const [metricRows, publishedVideoRows] = await Promise.all([
    getChannelMetricRows(channelIds, startDate, endDate),
    getPublishedVideoRows(channelIds, startDate, endDate)
  ]);
  const accumulatorsByRange = ranges.map(() => new Map(channels.map((channel) => [channel.channelId, createAccumulator()])));
  const publishedCountsByRange = ranges.map(
    () =>
      new Map(
        channels.map((channel) => [
          channel.channelId,
          {
            longVideosPublished: 0,
            shortVideosPublished: 0
          }
        ])
      )
  );
  const countedVideoIdsByRange = ranges.map(() => new Set<string>());

  for (const row of metricRows) {
    const rangeIndex = getRangeIndexForDate(row.day, ranges);
    if (rangeIndex === -1) continue;

    const accumulator = accumulatorsByRange[rangeIndex].get(row.channel_id);
    if (!accumulator) continue;
    addChannelMetricRowToAccumulator(accumulator, row);
  }

  for (const row of publishedVideoRows) {
    const publishedDate = row.published_at?.slice(0, 10);
    if (!publishedDate) continue;

    const rangeIndex = getRangeIndexForDate(publishedDate, ranges);
    if (rangeIndex === -1) continue;

    const count = publishedCountsByRange[rangeIndex].get(row.channel_id);
    if (!count) continue;
    if (row.video_id) {
      const countedVideoIds = countedVideoIdsByRange[rangeIndex];
      if (countedVideoIds.has(row.video_id)) continue;
      countedVideoIds.add(row.video_id);
    }

    if (row.content_type === "long") {
      count.longVideosPublished += 1;
    } else if (row.content_type === "short") {
      count.shortVideosPublished += 1;
    }
  }

  return accumulatorsByRange.map((accumulators, rangeIndex) => {
    const counts = publishedCountsByRange[rangeIndex];

    return new Map(
      Array.from(accumulators, ([channelId, accumulator]) => {
        const metricValues = accumulatorToMetricValues(accumulator);
        const publishedCount = counts.get(channelId);

        return [
          channelId,
          {
            ...metricValues,
            longVideosPublished: publishedCount?.longVideosPublished ?? 0,
            shortVideosPublished: publishedCount?.shortVideosPublished ?? 0
          }
        ];
      })
    );
  });
}

async function getWeeklyMetricValues(
  channels: StoredYoutubeManagedChannel[],
  startDate: string,
  endDate: string
) {
  const [metrics, publishedVideoCounts] = await Promise.all([
    getChannelMetricValues(channels, startDate, endDate),
    getPublishedVideoCounts(channels, startDate, endDate)
  ]);

  return new Map(
    Array.from(metrics, ([channelId, metricValues]) => {
      const counts = publishedVideoCounts.get(channelId);

      return [
        channelId,
        {
          ...metricValues,
          longVideosPublished: counts?.longVideosPublished ?? 0,
          shortVideosPublished: counts?.shortVideosPublished ?? 0
        }
      ];
    })
  );
}

async function getChannelMetricValues(
  channels: StoredYoutubeManagedChannel[],
  startDate: string,
  endDate: string
) {
  const rows = await getChannelMetricRows(channels.map((channel) => channel.channelId), startDate, endDate);
  const accumulators = new Map(channels.map((channel) => [channel.channelId, createAccumulator()]));

  for (const row of rows) {
    const accumulator = accumulators.get(row.channel_id);
    if (!accumulator) continue;
    addChannelMetricRowToAccumulator(accumulator, row);
  }

  return new Map(Array.from(accumulators, ([channelId, accumulator]) => [channelId, accumulatorToMetricValues(accumulator)]));
}

async function getChannelMetricRows(channelIds: string[], startDate: string, endDate: string) {
  try {
    return await getChannelMetricRowsWithColumns(channelIds, startDate, endDate, true);
  } catch (error) {
    if (!isMissingCtrColumnError(error)) throw error;
    return getChannelMetricRowsWithColumns(channelIds, startDate, endDate, false);
  }
}

async function getChannelMetricRowsWithColumns(
  channelIds: string[],
  startDate: string,
  endDate: string,
  includeCtr: boolean
) {
  const supabase = createSupabaseAdminClient();
  const rows: ChannelMetricRow[] = [];
  let offset = 0;
  const ctrColumn = includeCtr ? ",impressions_click_through_rate" : "";

  while (true) {
    const { data, error } = await supabase
      .from("youtube_channel_daily_metrics")
      .select(
        `channel_id,day,views,estimated_minutes_watched,subscribers_gained,subscribers_lost,estimated_revenue,monetized_playbacks,ad_impressions,playback_based_cpm${ctrColumn}`
      )
      .in("channel_id", channelIds)
      .gte("day", startDate)
      .lte("day", endDate)
      .order("channel_id", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as ChannelMetricRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function getPublishedVideoCounts(
  channels: StoredYoutubeManagedChannel[],
  startDate: string,
  endDate: string
) {
  const rows = await getPublishedVideoRows(channels.map((channel) => channel.channelId), startDate, endDate);
  const counts = new Map(
    channels.map((channel) => [
      channel.channelId,
      {
        longVideosPublished: 0,
        shortVideosPublished: 0
      }
    ])
  );
  const countedVideoIds = new Set<string>();

  for (const row of rows) {
    const count = counts.get(row.channel_id);
    if (!count) continue;
    if (row.video_id) {
      if (countedVideoIds.has(row.video_id)) continue;
      countedVideoIds.add(row.video_id);
    }

    if (row.content_type === "long") {
      count.longVideosPublished += 1;
    } else if (row.content_type === "short") {
      count.shortVideosPublished += 1;
    }
  }

  return counts;
}

async function getPublishedVideoRows(channelIds: string[], startDate: string, endDate: string) {
  const supabase = createSupabaseAdminClient();
  const rows: PublishedVideoRow[] = [];
  const exclusiveEndDate = addDaysToDate(endDate, 1);
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("youtube_video_catalog")
      .select("video_id,channel_id,content_type,published_at")
      .in("channel_id", channelIds)
      .gte("published_at", `${startDate}T00:00:00.000Z`)
      .lt("published_at", `${exclusiveEndDate}T00:00:00.000Z`)
      .order("published_at", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as PublishedVideoRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

function addChannelMetricRowToAccumulator(accumulator: MetricAccumulator, row: ChannelMetricRow) {
  accumulator.views += toNumber(row.views);
  accumulator.estimatedMinutesWatched += toNumber(row.estimated_minutes_watched);
  accumulator.subscribersGained += toNumber(row.subscribers_gained);
  accumulator.subscribersLost += toNumber(row.subscribers_lost);
  accumulator.estimatedRevenue += toNumber(row.estimated_revenue);
  accumulator.monetizedPlaybacks += toNumber(row.monetized_playbacks);
  accumulator.adImpressions += toNumber(row.ad_impressions);

  const playbackCpm = toNullableNumber(row.playback_based_cpm);
  if (playbackCpm !== null && playbackCpm > 0) {
    accumulator.playbackCpmCount += 1;
    accumulator.playbackCpmTotal += playbackCpm;
  }

  const ctr = toNullableNumber(row.impressions_click_through_rate ?? null);
  if (ctr !== null) {
    accumulator.ctrCount += 1;
    accumulator.ctrTotal += ctr;
  }
}

function accumulatorToMetricValues(accumulator: MetricAccumulator): WeeklyMetricValues {
  const watchHours = accumulator.estimatedMinutesWatched / 60;
  const netSubscribers = calculateNetSubscribers({
    subscribersGained: accumulator.subscribersGained,
    subscribersLost: accumulator.subscribersLost
  });
  const rpm = accumulator.views > 0 ? (accumulator.estimatedRevenue / accumulator.views) * 1000 : 0;
  const playbackCpm =
    accumulator.monetizedPlaybacks > 0
      ? (accumulator.estimatedRevenue / accumulator.monetizedPlaybacks) * 1000
      : accumulator.playbackCpmCount > 0
        ? accumulator.playbackCpmTotal / accumulator.playbackCpmCount
        : 0;

  return {
    adImpressions: Math.round(accumulator.adImpressions),
    ctr: accumulator.ctrCount > 0 ? accumulator.ctrTotal / accumulator.ctrCount : null,
    estimatedRevenue: accumulator.estimatedRevenue,
    longVideosPublished: 0,
    netSubscribers,
    playbackCpm,
    revenueGeneratingViews: Math.round(accumulator.monetizedPlaybacks),
    rpm,
    shortVideosPublished: 0,
    views: Math.round(accumulator.views),
    watchHours
  };
}

function sumMetricValues(values: WeeklyMetricValues[]) {
  if (values.length === 0) return createEmptyMetricValues();
  const accumulator = createAccumulator();
  let ctrCount = 0;
  let ctrTotal = 0;

  for (const value of values) {
    accumulator.views += value.views;
    accumulator.estimatedMinutesWatched += value.watchHours * 60;
    accumulator.estimatedRevenue += value.estimatedRevenue;
    accumulator.monetizedPlaybacks += value.revenueGeneratingViews;
    accumulator.adImpressions += value.adImpressions;
    accumulator.subscribersGained += Math.max(0, value.netSubscribers);
    accumulator.subscribersLost += Math.max(0, -value.netSubscribers);
    if (value.ctr !== null) {
      ctrCount += 1;
      ctrTotal += value.ctr;
    }
  }

  const totals = accumulatorToMetricValues(accumulator);
  totals.ctr = ctrCount > 0 ? ctrTotal / ctrCount : null;
  totals.longVideosPublished = values.reduce((total, value) => total + value.longVideosPublished, 0);
  totals.shortVideosPublished = values.reduce((total, value) => total + value.shortVideosPublished, 0);
  return totals;
}

function createAccumulator(): MetricAccumulator {
  return {
    adImpressions: 0,
    ctrCount: 0,
    ctrTotal: 0,
    estimatedMinutesWatched: 0,
    estimatedRevenue: 0,
    monetizedPlaybacks: 0,
    playbackCpmCount: 0,
    playbackCpmTotal: 0,
    subscribersGained: 0,
    subscribersLost: 0,
    views: 0
  };
}

function createEmptyMetricValues(): WeeklyMetricValues {
  return accumulatorToMetricValues(createAccumulator());
}

function averagePositive(values: number[]) {
  const positiveValues = values.filter((value) => value > 0);
  if (positiveValues.length === 0) return 0;
  return positiveValues.reduce((total, value) => total + value, 0) / positiveValues.length;
}

function calculatePercentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatDateRange(startDate: string, endDate: string) {
  return `${startDate} to ${endDate}`;
}

function addDaysToDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getRangeIndexForDate(date: string, ranges: WeeklyDateRange[]) {
  return ranges.findIndex((range) => date >= range.startDate && date <= range.endDate);
}

function normalizeCtrPercent(value: number) {
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function roundNullable(value: number | null) {
  return value === null ? "" : round(value);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "YouTube sync failed.";
  }
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMissingCtrColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("impressions_click_through_rate") || message.includes("column");
}
