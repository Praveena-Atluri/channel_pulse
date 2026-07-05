import {
  DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE,
  MONTHLY_TARGET_METRICS,
  aggregateTargetProgressRows,
  buildTargetProgress,
  createEmptyActualValues,
  createEmptyTargetValues,
  getTargetBaselineCutoffMonth,
  getTargetBaselineMonth,
  getTargetBaselineMonthOptionsFromAnchor,
  isMonthlyTargetBaselineMonthSource,
  normalizeMonthlyTargetBaselineSource,
  normalizeTargetValue,
  roundTargetValue,
  type MonthlyActualValues,
  type MonthlyTargetBaselineSource,
  type MonthlyTargetMetric,
  type MonthlyTargetValues
} from "@/lib/monthly-target-metrics";
import {
  derivePublishingTargetForDays,
  formatPublishingTargetSourceLabel,
  getDailyPublishingTargetsByChannelId,
  type DailyPublishingTargetValues
} from "@/lib/daily-targets";
import { createDatabaseAdminClient } from "@/lib/database";
import { getMonthDateRange, type VideoContentType } from "@/lib/youtube-performance-utils";

export type MonthlyTargetSourceLabels = Partial<Record<MonthlyTargetMetric, string>>;

export type MonthlyTargetDashboardRow = {
  actual: MonthlyActualValues;
  baseline: MonthlyActualValues;
  baselineSourceMonths: MonthlyTargetBaselineSourceMonths;
  channelId: string;
  channelTitle: string;
  hasBaselineData: boolean;
  progress: ReturnType<typeof buildTargetProgress>;
  target: MonthlyTargetValues;
  targetSourceLabels: MonthlyTargetSourceLabels;
  weeklyActuals: MonthlyTargetWeekActualRow[];
};

export type MonthlyTargetWeekActualRow = {
  actual: MonthlyActualValues;
  daysInMonth: number;
  endDate: string;
  startDate: string;
};

export type MonthlyTargetDashboardData = {
  baselineMonth: string;
  baselineMonths: string[];
  baselineSource: MonthlyTargetBaselineSource;
  errorMessage?: string;
  month: string;
  rows: MonthlyTargetDashboardRow[];
  schemaReady: boolean;
  totals: ReturnType<typeof aggregateTargetProgressRows>;
};

export type SaveMonthlyTargetInputRow = {
  channelId: string;
  targets: Partial<Record<MonthlyTargetMetric, unknown>>;
};

export type MonthlyTargetBaselineSourceMonths = Record<MonthlyTargetMetric, string | null>;

type TargetDbRow = {
  month: string;
  channel_id: string;
  short_views_target: number | string | null;
  long_views_target: number | string | null;
  short_videos_target: number | string | null;
  long_videos_target: number | string | null;
  watch_hours_target: number | string | null;
  net_subscribers_target: number | string | null;
  estimated_revenue_target?: number | string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ChannelMetricRow = {
  channel_id: string;
  day: string;
  estimated_minutes_watched: number | string | null;
  estimated_revenue?: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
};

type ContentTypeMetricRow = {
  channel_id: string;
  content_type: VideoContentType;
  day: string;
  views: number | string | null;
};

type PublishedVideoRow = {
  channel_id: string;
  content_type: VideoContentType | null;
  published_at: string | null;
};

type LatestMetricDayRow = {
  day: string;
};

type ActualBucket = {
  hasData: boolean;
  sourceMonths: MonthlyTargetBaselineSourceMonths;
  values: MonthlyActualValues;
};

type TargetChannel = {
  channelId: string;
  title: string;
};

const TARGET_SELECT_COLUMNS = [
  "month",
  "channel_id",
  "short_views_target",
  "long_views_target",
  "short_videos_target",
  "long_videos_target",
  "watch_hours_target",
  "net_subscribers_target",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at"
].join(",");

const REVENUE_TARGET_SELECT_COLUMN = "estimated_revenue_target";

export async function getMonthlyTargetDashboardData({
  baselineMonth,
  baselineMonths = getTargetBaselineMonthOptionsFromAnchor(baselineMonth),
  baselineSource = DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE,
  canViewRevenue = false,
  channels,
  month
}: {
  baselineMonth: string;
  baselineMonths?: string[];
  baselineSource?: MonthlyTargetBaselineSource;
  canViewRevenue?: boolean;
  channels: TargetChannel[];
  month: string;
}): Promise<MonthlyTargetDashboardData> {
  const normalizedBaselineSource = normalizeMonthlyTargetBaselineSource(baselineSource, baselineMonths);
  const rows = await getMonthlyTargetRows({
    baselineMonth,
    baselineMonths,
    baselineSource: normalizedBaselineSource,
    canViewRevenue,
    channels,
    month
  });
  const visibleRows = canViewRevenue ? rows : rows.map(sanitizeRevenueTargetRow);

  return {
    baselineMonth: getSelectedBaselineMonth(normalizedBaselineSource, baselineMonth),
    baselineMonths,
    baselineSource: normalizedBaselineSource,
    month,
    rows: visibleRows,
    schemaReady: true,
    totals: aggregateTargetProgressRows(visibleRows)
  };
}

export async function getMonthlyTargetDashboardDataSafe(input: {
  baselineMonth: string;
  baselineMonths?: string[];
  baselineSource?: MonthlyTargetBaselineSource;
  canViewRevenue?: boolean;
  channels: TargetChannel[];
  month: string;
}): Promise<MonthlyTargetDashboardData> {
  try {
    return await getMonthlyTargetDashboardData(input);
  } catch (error) {
    if (isMissingTargetTableError(error)) {
      const baselineMonths = input.baselineMonths ?? getTargetBaselineMonthOptionsFromAnchor(input.baselineMonth);
      const baselineSource = normalizeMonthlyTargetBaselineSource(input.baselineSource, baselineMonths);

      return {
        baselineMonth: getSelectedBaselineMonth(baselineSource, input.baselineMonth),
        baselineMonths,
        baselineSource,
        errorMessage: "Apply the monthly targets schema before using target tracking.",
        month: input.month,
        rows: [],
        schemaReady: false,
        totals: aggregateTargetProgressRows([])
      };
    }

    throw error;
  }
}

export async function resolveMonthlyTargetBaselineMonth({
  channels,
  month
}: {
  channels: TargetChannel[];
  month: string;
}) {
  const fallbackMonth = getTargetBaselineMonth(month);
  const channelIds = channels.map((channel) => channel.channelId);

  if (channelIds.length === 0) return fallbackMonth;

  const db = createDatabaseAdminClient();
  const cutoffDate = `${getTargetBaselineCutoffMonth(month)}-01`;
  const [latestChannelDay, latestContentTypeDay] = await Promise.all([
    getLatestMetricDay(db, "youtube_channel_daily_metrics", cutoffDate, channelIds),
    getLatestMetricDay(db, "youtube_content_type_daily_metrics", cutoffDate, channelIds)
  ]);
  const latestDay = [latestChannelDay, latestContentTypeDay].filter(Boolean).sort().at(-1);

  return latestDay ? latestDay.slice(0, 7) : fallbackMonth;
}

export async function saveMonthlyTargets({
  month,
  rows,
  username
}: {
  month: string;
  rows: SaveMonthlyTargetInputRow[];
  username: string;
}) {
  const db = createDatabaseAdminClient();
  const channelIds = rows.map((row) => row.channelId);
  const existingRows = await getTargetDbRows(db, month, channelIds);
  const existingRowsByChannelId = new Map(existingRows.map((row) => [row.channel_id, row]));
  const savedAt = new Date().toISOString();
  const payload = rows.map((row) => {
    const normalizedTargets = normalizeTargetValues(row.targets);
    const existingRow = existingRowsByChannelId.get(row.channelId);

    return {
      month,
      channel_id: row.channelId,
      short_views_target: normalizedTargets.shortViews,
      long_views_target: normalizedTargets.longViews,
      short_videos_target: normalizedTargets.shortVideosToPublish,
      long_videos_target: normalizedTargets.longVideosToPublish,
      watch_hours_target: normalizedTargets.watchHours,
      net_subscribers_target: normalizedTargets.netSubscribers,
      estimated_revenue_target: normalizedTargets.estimatedRevenue,
      created_by: existingRow?.created_by ?? username,
      updated_by: username,
      updated_at: savedAt
    };
  });

  if (payload.length === 0) return;

  const { error } = await db
    .from("youtube_monthly_channel_targets")
    .upsert(payload, { onConflict: "month,channel_id" });

  if (error) throw error;
}

export function normalizeTargetValues(values: Partial<Record<MonthlyTargetMetric, unknown>>) {
  const normalized = createEmptyTargetValues();

  for (const metric of MONTHLY_TARGET_METRICS) {
    normalized[metric.key] = normalizeTargetValue(metric.key, values[metric.key]);
  }

  return normalized;
}

function mapTargetDbRow(row: TargetDbRow | undefined): MonthlyTargetValues {
  if (!row) return createEmptyTargetValues();

  return {
    shortViews: toNullableNumber(row.short_views_target),
    longViews: toNullableNumber(row.long_views_target),
    shortVideosToPublish: toNullableNumber(row.short_videos_target),
    longVideosToPublish: toNullableNumber(row.long_videos_target),
    watchHours: toNullableNumber(row.watch_hours_target),
    netSubscribers: toNullableNumber(row.net_subscribers_target),
    estimatedRevenue: toNullableNumber(row.estimated_revenue_target)
  };
}

async function getMonthlyTargetRows({
  baselineMonth,
  baselineMonths,
  baselineSource,
  canViewRevenue,
  channels,
  month
}: {
  baselineMonth: string;
  baselineMonths: string[];
  baselineSource: MonthlyTargetBaselineSource;
  canViewRevenue: boolean;
  channels: TargetChannel[];
  month: string;
}) {
  const db = createDatabaseAdminClient();
  const channelIds = channels.map((channel) => channel.channelId);

  if (channelIds.length === 0) return [];

  const weekDefinitions = getMonthWeekDefinitions(month);
  const targetDaysInMonth = weekDefinitions.reduce((total, week) => total + week.daysInMonth, 0);
  const [targetRows, dailyPublishingTargetsByChannelId, actualBuckets, baselineBuckets, weeklyActualBuckets] = await Promise.all([
    getTargetDbRows(db, month, channelIds, { includeRevenue: canViewRevenue }),
    getDailyPublishingTargetsByChannelId(channelIds),
    getActualBuckets(db, month, channelIds),
    getBaselineBuckets(db, { baselineMonth, baselineMonths, baselineSource, channelIds }),
    getWeeklyActualBuckets(db, month, channelIds)
  ]);
  const targetRowsByChannelId = new Map(targetRows.map((row) => [row.channel_id, row]));

  return channels.map((channel) => {
    const publishingTargetResult = applyDailyPublishingTargets(
      mapTargetDbRow(targetRowsByChannelId.get(channel.channelId)),
      dailyPublishingTargetsByChannelId.get(channel.channelId),
      targetDaysInMonth
    );
    const target = publishingTargetResult.target;
    const actualBucket = actualBuckets.get(channel.channelId) ?? createActualBucket();
    const baselineBucket = baselineBuckets.get(channel.channelId) ?? createActualBucket();

    return {
      actual: actualBucket.values,
      baseline: baselineBucket.values,
      baselineSourceMonths: baselineBucket.sourceMonths,
      channelId: channel.channelId,
      channelTitle: channel.title,
      hasBaselineData: baselineBucket.hasData,
      progress: buildTargetProgress({ actual: actualBucket.values, target }),
      target,
      targetSourceLabels: publishingTargetResult.sourceLabels,
      weeklyActuals: weeklyActualBuckets.get(channel.channelId) ?? createWeeklyActualRows(weekDefinitions)
    };
  });
}

function applyDailyPublishingTargets(
  target: MonthlyTargetValues,
  dailyTargets: DailyPublishingTargetValues | undefined,
  daysInMonth: number
): { sourceLabels: MonthlyTargetSourceLabels; target: MonthlyTargetValues } {
  const longVideosTarget = derivePublishingTargetForDays(dailyTargets?.longVideos, daysInMonth);
  const shortVideosTarget = derivePublishingTargetForDays(dailyTargets?.shortVideos, daysInMonth);

  return {
    sourceLabels: {
      longVideosToPublish: formatPublishingTargetSourceLabel(dailyTargets?.longVideos) ?? undefined,
      shortVideosToPublish: formatPublishingTargetSourceLabel(dailyTargets?.shortVideos) ?? undefined
    },
    target: {
      ...target,
      longVideosToPublish: longVideosTarget,
      shortVideosToPublish: shortVideosTarget
    }
  };
}

async function getBaselineBuckets(
  db: ReturnType<typeof createDatabaseAdminClient>,
  {
    baselineMonth,
    baselineMonths,
    baselineSource,
    channelIds
  }: {
    baselineMonth: string;
    baselineMonths: string[];
    baselineSource: MonthlyTargetBaselineSource;
    channelIds: string[];
  }
) {
  if (baselineSource === "last-three-months-average") {
    return getAverageActualBuckets(db, baselineMonths.slice(0, 3), channelIds);
  }

  if (baselineSource === "highest-in-year") {
    return getHighestActualBuckets(db, baselineMonths, channelIds);
  }

  const selectedMonth = isMonthlyTargetBaselineMonthSource(baselineSource) ? baselineSource : baselineMonth;
  return getActualBuckets(db, selectedMonth, channelIds);
}

async function getAverageActualBuckets(
  db: ReturnType<typeof createDatabaseAdminClient>,
  months: string[],
  channelIds: string[]
) {
  const monthlyBuckets = await Promise.all(months.map((month) => getActualBuckets(db, month, channelIds)));
  const buckets = new Map(channelIds.map((channelId) => [channelId, createActualBucket()]));

  for (const channelId of channelIds) {
    const averageBucket = buckets.get(channelId);
    if (!averageBucket) continue;

    const totals = createEmptyActualValues();
    let monthsWithData = 0;

    for (const monthBuckets of monthlyBuckets) {
      const bucket = monthBuckets.get(channelId);
      if (!bucket?.hasData) continue;

      monthsWithData += 1;
      for (const metric of MONTHLY_TARGET_METRICS) {
        totals[metric.key] += bucket.values[metric.key];
      }
    }

    if (monthsWithData === 0) continue;

    averageBucket.hasData = true;
    for (const metric of MONTHLY_TARGET_METRICS) {
      averageBucket.values[metric.key] = roundTargetValue(metric.key, totals[metric.key] / monthsWithData);
    }
  }

  return buckets;
}

async function getHighestActualBuckets(
  db: ReturnType<typeof createDatabaseAdminClient>,
  months: string[],
  channelIds: string[]
) {
  const monthlyBuckets = await Promise.all(
    months.map(async (month) => ({
      buckets: await getActualBuckets(db, month, channelIds),
      month
    }))
  );
  const buckets = new Map(channelIds.map((channelId) => [channelId, createActualBucket()]));

  for (const channelId of channelIds) {
    const highestBucket = buckets.get(channelId);
    if (!highestBucket) continue;

    let highestLongViews = Number.NEGATIVE_INFINITY;
    let selectedBucket: ActualBucket | null = null;
    let selectedMonth: string | null = null;

    for (const monthBuckets of monthlyBuckets) {
      const bucket = monthBuckets.buckets.get(channelId);
      if (!bucket?.hasData) continue;

      if (!selectedBucket || bucket.values.longViews > highestLongViews) {
        highestLongViews = bucket.values.longViews;
        selectedBucket = bucket;
        selectedMonth = monthBuckets.month;
      }
    }

    if (!selectedBucket || !selectedMonth) continue;

    highestBucket.hasData = selectedBucket.hasData;
    for (const metric of MONTHLY_TARGET_METRICS) {
      highestBucket.values[metric.key] = selectedBucket.values[metric.key];
      highestBucket.sourceMonths[metric.key] = selectedMonth;
    }
  }

  return buckets;
}

function getSelectedBaselineMonth(baselineSource: MonthlyTargetBaselineSource, baselineMonth: string) {
  return isMonthlyTargetBaselineMonthSource(baselineSource) ? baselineSource : baselineMonth;
}

function sanitizeRevenueTargetRow(row: MonthlyTargetDashboardRow): MonthlyTargetDashboardRow {
  const actual = { ...row.actual, estimatedRevenue: 0 };
  const baseline = { ...row.baseline, estimatedRevenue: 0 };
  const target = { ...row.target, estimatedRevenue: null };
  const baselineSourceMonths = { ...row.baselineSourceMonths, estimatedRevenue: null };

  return {
    ...row,
    actual,
    baseline,
    baselineSourceMonths,
    progress: buildTargetProgress({ actual, target }),
    target,
    weeklyActuals: row.weeklyActuals.map((week) => ({
      ...week,
      actual: { ...week.actual, estimatedRevenue: 0 }
    }))
  };
}

async function getTargetDbRows(
  db: ReturnType<typeof createDatabaseAdminClient>,
  month: string,
  channelIds: string[],
  options: { includeRevenue?: boolean } = {}
) {
  const { data, error } = await db
    .from("youtube_monthly_channel_targets")
    .select(getTargetSelectColumns(options.includeRevenue ?? false))
    .eq("month", month)
    .in("channel_id", channelIds);

  if (error) throw error;

  return (data ?? []) as TargetDbRow[];
}

function getTargetSelectColumns(includeRevenue: boolean) {
  return includeRevenue ? `${TARGET_SELECT_COLUMNS},${REVENUE_TARGET_SELECT_COLUMN}` : TARGET_SELECT_COLUMNS;
}

async function getActualBuckets(
  db: ReturnType<typeof createDatabaseAdminClient>,
  month: string,
  channelIds: string[]
) {
  const range = getMonthDateRange(month);
  const buckets = new Map(channelIds.map((channelId) => [channelId, createActualBucket()]));
  const [channelMetricRows, contentTypeMetricRows, publishedVideoRows] = await Promise.all([
    getChannelMetricRows(db, range.startDate, range.endDate, channelIds),
    getContentTypeMetricRows(db, range.startDate, range.endDate, channelIds),
    getPublishedVideoRows(db, range.startDate, range.endDate, channelIds)
  ]);

  for (const row of channelMetricRows) {
    const bucket = buckets.get(row.channel_id);
    if (!bucket) continue;

    bucket.hasData = true;
    bucket.values.watchHours += toNumber(row.estimated_minutes_watched) / 60;
    bucket.values.netSubscribers += toNumber(row.subscribers_gained) - toNumber(row.subscribers_lost);
    bucket.values.estimatedRevenue += toNumber(row.estimated_revenue);
    bucket.sourceMonths.watchHours = month;
    bucket.sourceMonths.netSubscribers = month;
    bucket.sourceMonths.estimatedRevenue = month;
  }

  for (const row of contentTypeMetricRows) {
    const bucket = buckets.get(row.channel_id);
    if (!bucket) continue;
    const metricKey = contentTypeMetricKey(row.content_type);
    if (!metricKey) continue;

    bucket.hasData = true;
    bucket.values[metricKey] += toNumber(row.views);
    bucket.sourceMonths[metricKey] = month;
  }

  for (const row of publishedVideoRows) {
    const bucket = buckets.get(row.channel_id);
    if (!bucket) continue;

    if (row.content_type === "short") {
      bucket.hasData = true;
      bucket.values.shortVideosToPublish += 1;
      bucket.sourceMonths.shortVideosToPublish = month;
    } else if (row.content_type === "long") {
      bucket.hasData = true;
      bucket.values.longVideosToPublish += 1;
      bucket.sourceMonths.longVideosToPublish = month;
    }
  }

  for (const bucket of buckets.values()) {
    bucket.values.watchHours = Math.round(bucket.values.watchHours * 10) / 10;
    bucket.values.estimatedRevenue = Math.round(bucket.values.estimatedRevenue * 100) / 100;
  }

  return buckets;
}

async function getWeeklyActualBuckets(
  db: ReturnType<typeof createDatabaseAdminClient>,
  month: string,
  channelIds: string[]
) {
  const range = getMonthDateRange(month);
  const weekDefinitions = getMonthWeekDefinitions(month);
  const buckets = new Map(channelIds.map((channelId) => [channelId, createWeeklyActualRows(weekDefinitions)]));
  const [channelMetricRows, contentTypeMetricRows, publishedVideoRows] = await Promise.all([
    getChannelMetricRows(db, range.startDate, range.endDate, channelIds),
    getContentTypeMetricRows(db, range.startDate, range.endDate, channelIds),
    getPublishedVideoRows(db, range.startDate, range.endDate, channelIds)
  ]);

  for (const row of channelMetricRows) {
    const week = findWeeklyActualRow(buckets.get(row.channel_id), row.day);
    if (!week) continue;

    week.actual.watchHours += toNumber(row.estimated_minutes_watched) / 60;
    week.actual.netSubscribers += toNumber(row.subscribers_gained) - toNumber(row.subscribers_lost);
    week.actual.estimatedRevenue += toNumber(row.estimated_revenue);
  }

  for (const row of contentTypeMetricRows) {
    const metricKey = contentTypeMetricKey(row.content_type);
    if (!metricKey) continue;

    const week = findWeeklyActualRow(buckets.get(row.channel_id), row.day);
    if (!week) continue;

    week.actual[metricKey] += toNumber(row.views);
  }

  for (const row of publishedVideoRows) {
    const publishedDate = row.published_at?.slice(0, 10);
    if (!publishedDate) continue;

    const week = findWeeklyActualRow(buckets.get(row.channel_id), publishedDate);
    if (!week) continue;

    if (row.content_type === "short") {
      week.actual.shortVideosToPublish += 1;
    } else if (row.content_type === "long") {
      week.actual.longVideosToPublish += 1;
    }
  }

  for (const rows of buckets.values()) {
    for (const row of rows) {
      row.actual.watchHours = Math.round(row.actual.watchHours * 10) / 10;
      row.actual.estimatedRevenue = Math.round(row.actual.estimatedRevenue * 100) / 100;
    }
  }

  return buckets;
}

async function getChannelMetricRows(
  db: ReturnType<typeof createDatabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelIds: string[]
) {
  const { data, error } = await db
    .from("youtube_channel_daily_metrics")
    .select("channel_id,day,estimated_minutes_watched,estimated_revenue,subscribers_gained,subscribers_lost")
    .in("channel_id", channelIds)
    .gte("day", startDate)
    .lt("day", endDate);

  if (error) throw error;

  return (data ?? []) as ChannelMetricRow[];
}

async function getContentTypeMetricRows(
  db: ReturnType<typeof createDatabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelIds: string[]
) {
  const { data, error } = await db
    .from("youtube_content_type_daily_metrics")
    .select("channel_id,content_type,day,views")
    .in("channel_id", channelIds)
    .gte("day", startDate)
    .lt("day", endDate);

  if (error) throw error;

  return (data ?? []) as ContentTypeMetricRow[];
}

async function getPublishedVideoRows(
  db: ReturnType<typeof createDatabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelIds: string[]
) {
  const { data, error } = await db
    .from("youtube_video_catalog")
    .select("channel_id,content_type,published_at")
    .in("channel_id", channelIds)
    .gte("published_at", `${startDate}T00:00:00.000Z`)
    .lt("published_at", `${endDate}T00:00:00.000Z`);

  if (error) throw error;

  return (data ?? []) as PublishedVideoRow[];
}

async function getLatestMetricDay(
  db: ReturnType<typeof createDatabaseAdminClient>,
  table: "youtube_channel_daily_metrics" | "youtube_content_type_daily_metrics",
  cutoffDate: string,
  channelIds: string[]
) {
  const { data, error } = await db
    .from(table)
    .select("day")
    .in("channel_id", channelIds)
    .lt("day", cutoffDate)
    .order("day", { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = ((data ?? []) as LatestMetricDayRow[])[0];
  return typeof row?.day === "string" ? row.day : null;
}

function createActualBucket(): ActualBucket {
  return {
    hasData: false,
    sourceMonths: createEmptyBaselineSourceMonths(),
    values: createEmptyActualValues()
  };
}

function createWeeklyActualRows(weekDefinitions: Array<Omit<MonthlyTargetWeekActualRow, "actual">>) {
  return weekDefinitions.map((week) => ({
    ...week,
    actual: createEmptyActualValues()
  }));
}

function findWeeklyActualRow(rows: MonthlyTargetWeekActualRow[] | undefined, date: string) {
  return rows?.find((row) => date >= row.startDate && date <= row.endDate) ?? null;
}

function createEmptyBaselineSourceMonths(): MonthlyTargetBaselineSourceMonths {
  return Object.fromEntries(MONTHLY_TARGET_METRICS.map((metric) => [metric.key, null])) as MonthlyTargetBaselineSourceMonths;
}

function getMonthWeekDefinitions(month: string): Array<Omit<MonthlyTargetWeekActualRow, "actual">> {
  const { endDate, startDate } = getCalendarMonthDateRange(month);
  const monthStart = parseUtcDate(startDate);
  const monthEndExclusive = parseUtcDate(endDate);
  const weeks: Array<Omit<MonthlyTargetWeekActualRow, "actual">> = [];
  let weekStart = getMondayWeekStart(monthStart);

  while (weekStart < monthEndExclusive) {
    const nextWeekStart = addUtcDays(weekStart, 7);
    const overlapStart = maxDate(weekStart, monthStart);
    const overlapEndExclusive = minDate(nextWeekStart, monthEndExclusive);

    if (overlapStart < overlapEndExclusive) {
      weeks.push({
        daysInMonth: Math.round((overlapEndExclusive.getTime() - overlapStart.getTime()) / 86_400_000),
        endDate: formatUtcDate(addUtcDays(overlapEndExclusive, -1)),
        startDate: formatUtcDate(overlapStart)
      });
    }

    weekStart = nextWeekStart;
  }

  return weeks;
}

function getCalendarMonthDateRange(month: string) {
  const [year, monthNumber] = parseMonthValue(month);

  return {
    endDate: formatUtcDate(new Date(Date.UTC(year, monthNumber, 1))),
    startDate: formatUtcDate(new Date(Date.UTC(year, monthNumber - 1, 1)))
  };
}

function parseMonthValue(month: string): [number, number] {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error(`Invalid target month: ${month}`);

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error(`Invalid target month: ${month}`);

  return [year, monthNumber];
}

function getMondayWeekStart(date: Date) {
  const weekStart = new Date(date);
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
  return weekStart;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function maxDate(left: Date, right: Date) {
  return left.getTime() >= right.getTime() ? left : right;
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

function parseUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function contentTypeMetricKey(contentType: VideoContentType): MonthlyTargetMetric | null {
  if (contentType === "short") return "shortViews";
  if (contentType === "long") return "longViews";
  return null;
}

function isMissingTargetTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("youtube_monthly_channel_targets") &&
    (message.includes("does not exist") || message.includes("no such table"))
  ) || (
    message.includes("estimated_revenue_target") &&
    (message.includes("does not exist") || message.includes("no such column") || message.includes("no such field"))
  );
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
