import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  type ChannelPulseAccount,
  canAccountManageDashboard,
  canAccountViewRevenue,
  getAccountChannelAccess,
  getSessionAccount
} from "@/lib/auth";
import { ensureYoutubeAnalyticsRangeData } from "@/lib/youtube-auto-sync";
import {
  CHANNEL_COMPARE_COLUMNS,
  isChannelCompareColumnId,
  isChannelCompareRevenueColumnId,
  type ChannelCompareColumnId
} from "@/lib/channel-compare-report";
import {
  CHANNEL_SUMMARY_COLUMNS,
  isChannelSummaryColumnId,
  isChannelSummaryRevenueColumnId,
  type ChannelSummaryColumnId
} from "@/lib/channel-summary-report";
import { createDatabaseAdminClient } from "@/lib/database";
import { listStoredYoutubeManagedChannels, type StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";
import {
  getYoutubePerformanceDashboard,
  normalizeYoutubePerformanceFilters,
  type ContentTypeFilter,
  type CountryRevenueRow,
  type VideoPerformanceRow
} from "@/lib/youtube-performance";
import {
  addMetricTotals,
  calculateNetSubscribers,
  createEmptyTotals,
  getMonthDateRange,
  type MetricTotals,
  type VideoContentType
} from "@/lib/youtube-performance-utils";
import { buildXlsxWorkbook, type XlsxCellValue } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

type ReportType = "summary" | "formats" | "countries" | "videos" | "channel-summary" | "channel-compare";

const REPORT_TYPES = new Set<ReportType>([
  "summary",
  "formats",
  "countries",
  "videos",
  "channel-summary",
  "channel-compare"
]);
const DB_PAGE_SIZE = 1000;
const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REPORT_COLUMN_WIDTH = 16.86;

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountManageDashboard(account)) {
    return NextResponse.json({ error: "Only admins can download reports." }, { status: 403 });
  }

  const report = normalizeReportType(request.nextUrl.searchParams.get("report"));
  if (!report) {
    return NextResponse.json({ error: "Select a valid report type." }, { status: 400 });
  }
  if (
    !canAccountViewRevenue(account) &&
    report !== "channel-summary" &&
    report !== "channel-compare"
  ) {
    return NextResponse.json(
      { error: "This report includes revenue and is unavailable for this account." },
      { status: 403 }
    );
  }

  if (report === "channel-summary") {
    return buildChannelSummaryResponse(request, account);
  }

  if (report === "channel-compare") {
    return buildChannelCompareResponse(request, account);
  }

  const filters = normalizeYoutubePerformanceFilters({
    month: request.nextUrl.searchParams.get("month") ?? undefined,
    channel: request.nextUrl.searchParams.get("channel") ?? undefined,
    contentType: request.nextUrl.searchParams.get("contentType") ?? undefined
  });
  let dashboard = await getYoutubePerformanceDashboard(filters, getAccountChannelAccess(account));
  const autoSyncError = await ensureMonthlyReportRangeData(dashboard);
  if (autoSyncError) {
    return NextResponse.json({ error: autoSyncError }, { status: 502 });
  }

  dashboard = await getYoutubePerformanceDashboard(filters, getAccountChannelAccess(account));
  if (!dashboard.hasSelectedMonthData || !dashboard.hasPreviousMonthData) {
    return NextResponse.json(
      { error: "Channel Pulse could not load complete data for the selected report range." },
      { status: 404 }
    );
  }

  const channelTitle =
    dashboard.channels.find((channel) => channel.channelId === dashboard.filters.channelId)?.title ??
    (dashboard.filters.channelId === "all" ? "All channels" : dashboard.filters.channelId);
  const rows = buildReportRows(report, dashboard, channelTitle);
  const filename = [
    "channel-pulse",
    report,
    dashboard.selectedMonth,
    slugify(channelTitle),
    dashboard.filters.contentType
  ].join("-");

  return buildWorkbookResponse(rows, filename, reportSheetName(report));
}

async function buildChannelSummaryResponse(request: NextRequest, account: ChannelPulseAccount) {
  const startDate = normalizeDateParam(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeDateParam(request.nextUrl.searchParams.get("endDate"));
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "Select a valid start and end date." }, { status: 400 });
  }

  if (startDate > endDate) {
    return NextResponse.json({ error: "End date must be after start date." }, { status: 400 });
  }

  const requestedChannelIds = uniqueValues(request.nextUrl.searchParams.getAll("channel"));
  if (requestedChannelIds.length === 0) {
    return NextResponse.json({ error: "Select at least one channel." }, { status: 400 });
  }

  const requestedColumnIds = uniqueValues(request.nextUrl.searchParams.getAll("column"));
  if (requestedColumnIds.length === 0) {
    return NextResponse.json({ error: "Select at least one report column." }, { status: 400 });
  }

  const selectedColumnIds = requestedColumnIds.filter(isChannelSummaryColumnId);
  if (selectedColumnIds.length !== requestedColumnIds.length || selectedColumnIds.length === 0) {
    return NextResponse.json({ error: "Select valid report columns." }, { status: 400 });
  }
  if (!canAccountViewRevenue(account) && selectedColumnIds.some(isChannelSummaryRevenueColumnId)) {
    return NextResponse.json(
      { error: "Revenue report columns are unavailable for this account." },
      { status: 403 }
    );
  }

  const allChannels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const channelsById = new Map(allChannels.map((channel) => [channel.channelId, channel]));
  const selectedChannels = requestedChannelIds
    .map((channelId) => channelsById.get(channelId))
    .filter((channel): channel is StoredYoutubeManagedChannel => Boolean(channel));
  if (selectedChannels.length !== requestedChannelIds.length || selectedChannels.length === 0) {
    return NextResponse.json({ error: "Select valid channels." }, { status: 400 });
  }

  let rows: XlsxCellValue[][];
  try {
    rows = await buildChannelSummaryRows({
      channels: selectedChannels,
      columnIds: selectedColumnIds,
      endDate,
      startDate
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 502 });
  }
  const filename = [
    "channel-pulse",
    "channel-summary",
    startDate,
    "to",
    endDate,
    `${selectedChannels.length}-channels`
  ].join("-");

  return buildWorkbookResponse(rows, filename, "Channel Summary");
}

async function buildChannelCompareResponse(request: NextRequest, account: ChannelPulseAccount) {
  const primaryStartDate = normalizeDateParam(request.nextUrl.searchParams.get("primaryStartDate"));
  const primaryEndDate = normalizeDateParam(request.nextUrl.searchParams.get("primaryEndDate"));
  const comparisonStartDate = normalizeDateParam(request.nextUrl.searchParams.get("comparisonStartDate"));
  const comparisonEndDate = normalizeDateParam(request.nextUrl.searchParams.get("comparisonEndDate"));
  if (!primaryStartDate || !primaryEndDate || !comparisonStartDate || !comparisonEndDate) {
    return NextResponse.json({ error: "Select valid dates for both comparison ranges." }, { status: 400 });
  }

  if (primaryStartDate > primaryEndDate || comparisonStartDate > comparisonEndDate) {
    return NextResponse.json({ error: "Each end date must be after its start date." }, { status: 400 });
  }

  const requestedChannelIds = uniqueValues(request.nextUrl.searchParams.getAll("channel"));
  if (requestedChannelIds.length === 0) {
    return NextResponse.json({ error: "Select at least one channel." }, { status: 400 });
  }

  const requestedColumnIds = uniqueValues(request.nextUrl.searchParams.getAll("column"));
  if (requestedColumnIds.length === 0) {
    return NextResponse.json({ error: "Select at least one report column." }, { status: 400 });
  }

  const selectedColumnIds = requestedColumnIds.filter(isChannelCompareColumnId);
  if (selectedColumnIds.length !== requestedColumnIds.length || selectedColumnIds.length === 0) {
    return NextResponse.json({ error: "Select valid report columns." }, { status: 400 });
  }
  if (!canAccountViewRevenue(account) && selectedColumnIds.some(isChannelCompareRevenueColumnId)) {
    return NextResponse.json(
      { error: "Revenue report columns are unavailable for this account." },
      { status: 403 }
    );
  }

  const allChannels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const channelsById = new Map(allChannels.map((channel) => [channel.channelId, channel]));
  const selectedChannels = requestedChannelIds
    .map((channelId) => channelsById.get(channelId))
    .filter((channel): channel is StoredYoutubeManagedChannel => Boolean(channel));
  if (selectedChannels.length !== requestedChannelIds.length || selectedChannels.length === 0) {
    return NextResponse.json({ error: "Select valid channels." }, { status: 400 });
  }

  let rows: XlsxCellValue[][];
  try {
    rows = await buildChannelCompareRows({
      channels: selectedChannels,
      columnIds: selectedColumnIds,
      comparisonEndDate,
      comparisonStartDate,
      primaryEndDate,
      primaryStartDate
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 502 });
  }
  const filename = [
    "channel-pulse",
    "compare-summary",
    primaryStartDate,
    "to",
    primaryEndDate,
    "vs",
    comparisonStartDate,
    "to",
    comparisonEndDate,
    `${selectedChannels.length}-channels`
  ].join("-");

  return buildWorkbookResponse(rows, filename, "Compare Summary");
}

async function buildChannelSummaryRows({
  channels,
  columnIds,
  startDate,
  endDate
}: {
  channels: StoredYoutubeManagedChannel[];
  columnIds: ChannelSummaryColumnId[];
  startDate: string;
  endDate: string;
}) {
  await ensureYoutubeAnalyticsRangeData({ channels, endDate, startDate, storePeriodBreakdowns: false });
  if (hasChannelSummaryRevenueColumns(columnIds)) {
    await ensureRevenueMetricsForRange({ channels, startDate, endDate });
  }

  const db = createDatabaseAdminClient();
  const channelIds = channels.map((channel) => channel.channelId);
  const exclusiveEndDate = addDays(endDate, 1);
  const [channelMetricRows, contentTypeMetricRows] = await Promise.all([
    getChannelMetricRows(db, startDate, exclusiveEndDate, channelIds),
    getContentTypeMetricRows(db, startDate, exclusiveEndDate, channelIds)
  ]);
  const summaries = channels.map((channel) => ({
    channel,
    totals: createEmptyTotals(),
    formatViews: {
      short: 0,
      long: 0,
      live: 0,
      unknown: 0
    } satisfies Record<VideoContentType, number>,
    ranks: {
      views: 0,
      revenue: 0,
      netSubscribers: 0,
      rpm: 0
    }
  }));
  const summariesById = new Map(summaries.map((summary) => [summary.channel.channelId, summary]));

  for (const row of channelMetricRows) {
    const summary = summariesById.get(row.channel_id);
    if (!summary) continue;

    addMetricTotals(summary.totals, {
      views: toNumber(row.views),
      estimatedMinutesWatched: toNumber(row.estimated_minutes_watched),
      subscribersGained: toNumber(row.subscribers_gained),
      subscribersLost: toNumber(row.subscribers_lost),
      estimatedRevenue: toNumber(row.estimated_revenue),
      estimatedAdRevenue: toNumber(row.estimated_ad_revenue),
      grossRevenue: toNumber(row.gross_revenue),
      monetizedPlaybacks: toNumber(row.monetized_playbacks),
      adImpressions: toNumber(row.ad_impressions)
    });
  }

  for (const row of contentTypeMetricRows) {
    const summary = summariesById.get(row.channel_id);
    if (!summary) continue;
    summary.formatViews[row.content_type] += toNumber(row.views);
  }

  assignRanks(summaries, "views", (summary) => summary.totals.views);
  assignRanks(summaries, "revenue", (summary) => summary.totals.estimatedRevenue);
  assignRanks(summaries, "netSubscribers", (summary) => calculateNetSubscribers(summary.totals));
  assignRanks(summaries, "rpm", (summary) => calculateRevenuePerThousandViews(summary.totals));

  const columns = columnIds.map((columnId) => {
    const column = CHANNEL_SUMMARY_COLUMNS.find((candidate) => candidate.id === columnId);
    if (!column) throw new Error(`Unsupported column: ${columnId}`);
    return column;
  });

  return [
    columns.map((column) => column.label),
    ...summaries.map((summary) =>
      columns.map((column) => getChannelSummaryCell(column.id, summary, startDate, endDate))
    )
  ];
}

async function buildChannelCompareRows({
  channels,
  columnIds,
  primaryStartDate,
  primaryEndDate,
  comparisonStartDate,
  comparisonEndDate
}: {
  channels: StoredYoutubeManagedChannel[];
  columnIds: ChannelCompareColumnId[];
  primaryStartDate: string;
  primaryEndDate: string;
  comparisonStartDate: string;
  comparisonEndDate: string;
}) {
  await ensureYoutubeAnalyticsRangeData({
    channels,
    endDate: primaryEndDate,
    startDate: primaryStartDate,
    storePeriodBreakdowns: false
  });
  await ensureYoutubeAnalyticsRangeData({
    channels,
    endDate: comparisonEndDate,
    startDate: comparisonStartDate,
    storePeriodBreakdowns: false
  });
  if (hasChannelCompareRevenueColumns(columnIds)) {
    await Promise.all([
      ensureRevenueMetricsForRange({ channels, endDate: primaryEndDate, startDate: primaryStartDate }),
      ensureRevenueMetricsForRange({ channels, endDate: comparisonEndDate, startDate: comparisonStartDate })
    ]);
  }

  const [primarySummaries, comparisonSummaries] = await Promise.all([
    buildChannelSummaries(channels, primaryStartDate, primaryEndDate),
    buildChannelSummaries(channels, comparisonStartDate, comparisonEndDate)
  ]);
  const comparisonByChannelId = new Map(
    comparisonSummaries.map((summary) => [summary.channel.channelId, summary])
  );
  const selectedColumns = columnIds.map((columnId) => {
    const column = CHANNEL_COMPARE_COLUMNS.find((candidate) => candidate.id === columnId);
    if (!column) throw new Error(`Unsupported column: ${columnId}`);
    return column;
  });
  const dates = {
    comparisonEndDate,
    comparisonStartDate,
    primaryEndDate,
    primaryStartDate
  };
  const headers = selectedColumns.flatMap((column) => getChannelCompareHeaders(column.id));

  return [
    headers,
    ...primarySummaries.map((primary) => {
      const comparison = comparisonByChannelId.get(primary.channel.channelId) ?? createChannelSummary(primary.channel);
      return selectedColumns.flatMap((column) =>
        getChannelCompareCells(column.id, primary, comparison, dates).map((cell) => cell.value)
      );
    })
  ];
}

async function buildChannelSummaries(
  channels: StoredYoutubeManagedChannel[],
  startDate: string,
  endDate: string
) {
  const db = createDatabaseAdminClient();
  const channelIds = channels.map((channel) => channel.channelId);
  const exclusiveEndDate = addDays(endDate, 1);
  const [channelMetricRows, contentTypeMetricRows] = await Promise.all([
    getChannelMetricRows(db, startDate, exclusiveEndDate, channelIds),
    getContentTypeMetricRows(db, startDate, exclusiveEndDate, channelIds)
  ]);
  const summaries = channels.map(createChannelSummary);
  const summariesById = new Map(summaries.map((summary) => [summary.channel.channelId, summary]));

  for (const row of channelMetricRows) {
    const summary = summariesById.get(row.channel_id);
    if (!summary) continue;

    addMetricTotals(summary.totals, {
      views: toNumber(row.views),
      estimatedMinutesWatched: toNumber(row.estimated_minutes_watched),
      subscribersGained: toNumber(row.subscribers_gained),
      subscribersLost: toNumber(row.subscribers_lost),
      estimatedRevenue: toNumber(row.estimated_revenue),
      estimatedAdRevenue: toNumber(row.estimated_ad_revenue),
      grossRevenue: toNumber(row.gross_revenue),
      monetizedPlaybacks: toNumber(row.monetized_playbacks),
      adImpressions: toNumber(row.ad_impressions)
    });
  }

  for (const row of contentTypeMetricRows) {
    const summary = summariesById.get(row.channel_id);
    if (!summary) continue;
    summary.formatViews[row.content_type] += toNumber(row.views);
  }

  assignRanks(summaries, "views", (summary) => summary.totals.views);
  assignRanks(summaries, "revenue", (summary) => summary.totals.estimatedRevenue);
  assignRanks(summaries, "netSubscribers", (summary) => calculateNetSubscribers(summary.totals));
  assignRanks(summaries, "rpm", (summary) => calculateRevenuePerThousandViews(summary.totals));

  return summaries;
}

type ChannelSummaryMetricRow = {
  day: string;
  channel_id: string;
  views: number | string | null;
  estimated_minutes_watched: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
  estimated_revenue: number | string | null;
  estimated_ad_revenue: number | string | null;
  gross_revenue: number | string | null;
  monetized_playbacks: number | string | null;
  ad_impressions: number | string | null;
};

type ChannelSummaryContentTypeRow = {
  day: string;
  channel_id: string;
  content_type: VideoContentType;
  views: number | string | null;
};

type ChannelSummaryRow = {
  channel: StoredYoutubeManagedChannel;
  totals: MetricTotals;
  formatViews: Record<VideoContentType, number>;
  ranks: {
    views: number;
    revenue: number;
    netSubscribers: number;
    rpm: number;
  };
};

type ChannelCompareDates = {
  primaryStartDate: string;
  primaryEndDate: string;
  comparisonStartDate: string;
  comparisonEndDate: string;
};

async function ensureMonthlyReportRangeData(dashboard: Awaited<ReturnType<typeof getYoutubePerformanceDashboard>>) {
  if (!dashboard.schemaReady) {
    return "Analytics schema is not ready.";
  }

  const channelsToSync = getDashboardSyncChannels(dashboard.filters.channelId, dashboard.channels);
  if (channelsToSync.length === 0) {
    return "Select a valid channel before downloading the report.";
  }

  const selectedMonthRange = getMonthDateRange(dashboard.selectedMonth);
  const previousMonthRange = getMonthDateRange(dashboard.previousMonth);

  try {
    await ensureYoutubeAnalyticsRangeData({
      channels: channelsToSync,
      endDate: selectedMonthRange.analyticsEndDate,
      startDate: selectedMonthRange.startDate,
      storePeriodBreakdowns: true
    });
    await ensureYoutubeAnalyticsRangeData({
      channels: channelsToSync,
      endDate: previousMonthRange.analyticsEndDate,
      startDate: previousMonthRange.startDate,
      storePeriodBreakdowns: true
    });
    return "";
  } catch (error) {
    return getErrorMessage(error);
  }
}

function getDashboardSyncChannels(channelId: string, channels: Array<{ channelId: string }>) {
  if (channelId === "all") return channels;
  return channels.filter((channel) => channel.channelId === channelId);
}

function createChannelSummary(channel: StoredYoutubeManagedChannel): ChannelSummaryRow {
  return {
    channel,
    totals: createEmptyTotals(),
    formatViews: {
      short: 0,
      long: 0,
      live: 0,
      unknown: 0
    },
    ranks: {
      views: 0,
      revenue: 0,
      netSubscribers: 0,
      rpm: 0
    }
  };
}

async function ensureRevenueMetricsForRange({
  channels,
  startDate,
  endDate
}: {
  channels: StoredYoutubeManagedChannel[];
  startDate: string;
  endDate: string;
}) {
  const hasRevenueSignal = await hasStoredRevenueSignal(channels, startDate, endDate);
  if (hasRevenueSignal) return;

  await ensureYoutubeAnalyticsRangeData({
    channels,
    endDate,
    forceSync: true,
    startDate,
    storePeriodBreakdowns: false
  });
}

async function hasStoredRevenueSignal(channels: StoredYoutubeManagedChannel[], startDate: string, endDate: string) {
  const db = createDatabaseAdminClient();
  const channelIds = channels.map((channel) => channel.channelId);
  const exclusiveEndDate = addDays(endDate, 1);
  const rows = await getChannelMetricRows(db, startDate, exclusiveEndDate, channelIds);
  const hasViews = rows.some((row) => toNumber(row.views) > 0);
  if (!hasViews) return true;

  return rows.some(
    (row) =>
      toNumber(row.estimated_revenue) > 0 ||
      toNumber(row.estimated_ad_revenue) > 0 ||
      toNumber(row.gross_revenue) > 0 ||
      toNumber(row.monetized_playbacks) > 0 ||
      toNumber(row.ad_impressions) > 0
  );
}

function hasChannelSummaryRevenueColumns(columnIds: ChannelSummaryColumnId[]) {
  return columnIds.some(isChannelSummaryRevenueColumnId);
}

function hasChannelCompareRevenueColumns(columnIds: ChannelCompareColumnId[]) {
  return columnIds.some(isChannelCompareRevenueColumnId);
}

async function getChannelMetricRows(
  db: ReturnType<typeof createDatabaseAdminClient>,
  startDate: string,
  exclusiveEndDate: string,
  channelIds: string[]
) {
  const rows: ChannelSummaryMetricRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await db
      .from("youtube_channel_daily_metrics")
      .select(
        "day,channel_id,views,estimated_minutes_watched,subscribers_gained,subscribers_lost,estimated_revenue,estimated_ad_revenue,gross_revenue,monetized_playbacks,ad_impressions"
      )
      .in("channel_id", channelIds)
      .gte("day", startDate)
      .lt("day", exclusiveEndDate)
      .order("day", { ascending: true })
      .order("channel_id", { ascending: true })
      .range(offset, offset + DB_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as ChannelSummaryMetricRow[]));
    if (!data || data.length < DB_PAGE_SIZE) break;
    offset += DB_PAGE_SIZE;
  }

  return rows;
}

async function getContentTypeMetricRows(
  db: ReturnType<typeof createDatabaseAdminClient>,
  startDate: string,
  exclusiveEndDate: string,
  channelIds: string[]
) {
  const rows: ChannelSummaryContentTypeRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await db
      .from("youtube_content_type_daily_metrics")
      .select("day,channel_id,content_type,views")
      .in("channel_id", channelIds)
      .gte("day", startDate)
      .lt("day", exclusiveEndDate)
      .order("day", { ascending: true })
      .order("channel_id", { ascending: true })
      .order("content_type", { ascending: true })
      .range(offset, offset + DB_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as ChannelSummaryContentTypeRow[]));
    if (!data || data.length < DB_PAGE_SIZE) break;
    offset += DB_PAGE_SIZE;
  }

  return rows;
}

function getChannelSummaryCell(
  columnId: ChannelSummaryColumnId,
  summary: ChannelSummaryRow,
  startDate: string,
  endDate: string
) {
  const { totals, formatViews } = summary;

  switch (columnId) {
    case "channel":
      return summary.channel.title;
    case "channel_id":
      return summary.channel.channelId;
    case "period":
      return formatReportDateRange(startDate, endDate);
    case "views":
      return totals.views;
    case "watch_hours":
      return round(totals.estimatedMinutesWatched / 60);
    case "subscribers_gained":
      return totals.subscribersGained;
    case "subscribers_lost":
      return totals.subscribersLost;
    case "net_subscribers":
      return calculateNetSubscribers(totals);
    case "revenue":
      return round(totals.estimatedRevenue);
    case "estimated_ad_revenue":
      return round(totals.estimatedAdRevenue);
    case "gross_revenue":
      return round(totals.grossRevenue);
    case "rpm":
      return round(calculateRevenuePerThousandViews(totals));
    case "playback_cpm":
      return round(calculatePlaybackCpm(totals));
    case "monetized_playbacks":
      return totals.monetizedPlaybacks;
    case "ad_impressions":
      return totals.adImpressions;
    case "short_views":
      return formatViews.short;
    case "long_views":
      return formatViews.long;
    case "live_views":
      return formatViews.live;
    case "unknown_views":
      return formatViews.unknown;
    case "short_percent":
      return round(calculateViewsShare(formatViews.short, totals.views));
    case "long_percent":
      return round(calculateViewsShare(formatViews.long, totals.views));
    case "views_rank":
      return summary.ranks.views;
    case "revenue_rank":
      return summary.ranks.revenue;
    case "net_subscriber_rank":
      return summary.ranks.netSubscribers;
    case "rpm_rank":
      return summary.ranks.rpm;
  }
}

function getChannelCompareCells(
  columnId: ChannelCompareColumnId,
  primary: ChannelSummaryRow,
  comparison: ChannelSummaryRow,
  dates: ChannelCompareDates
) {
  const primaryWatchHours = primary.totals.estimatedMinutesWatched / 60;
  const comparisonWatchHours = comparison.totals.estimatedMinutesWatched / 60;
  const primaryNetSubscribers = calculateNetSubscribers(primary.totals);
  const comparisonNetSubscribers = calculateNetSubscribers(comparison.totals);
  const primaryRpm = calculateRevenuePerThousandViews(primary.totals);
  const comparisonRpm = calculateRevenuePerThousandViews(comparison.totals);
  const primaryPlaybackCpm = calculatePlaybackCpm(primary.totals);
  const comparisonPlaybackCpm = calculatePlaybackCpm(comparison.totals);

  switch (columnId) {
    case "channel":
      return [{ label: "Channel", value: primary.channel.title }];
    case "channel_id":
      return [{ label: "Channel ID", value: primary.channel.channelId }];
    case "date_ranges":
      return [
        { label: "Range 1", value: formatReportDateRange(dates.primaryStartDate, dates.primaryEndDate) },
        { label: "Range 2", value: formatReportDateRange(dates.comparisonStartDate, dates.comparisonEndDate) }
      ];
    case "views":
      return compareCells("Views", primary.totals.views, comparison.totals.views, { includePercent: true });
    case "watch_hours":
      return compareCells("Watch Hours", primaryWatchHours, comparisonWatchHours, { includePercent: true, rounded: true });
    case "net_subscribers":
      return compareCells("Net Subscribers", primaryNetSubscribers, comparisonNetSubscribers, { includePercent: true });
    case "estimated_revenue":
      return compareCells("Estimated Revenue", primary.totals.estimatedRevenue, comparison.totals.estimatedRevenue, {
        includePercent: true,
        rounded: true
      });
    case "rpm":
      return compareCells("RPM", primaryRpm, comparisonRpm, { rounded: true });
    case "playback_cpm":
      return compareCells("Playback CPM", primaryPlaybackCpm, comparisonPlaybackCpm, { rounded: true });
    case "monetized_playbacks":
      return compareCells("Monetized Playbacks", primary.totals.monetizedPlaybacks, comparison.totals.monetizedPlaybacks);
    case "ad_impressions":
      return compareCells("Ad Impressions", primary.totals.adImpressions, comparison.totals.adImpressions);
    case "short_views":
      return compareCells("Short Views", primary.formatViews.short, comparison.formatViews.short);
    case "long_views":
      return compareCells("Long Views", primary.formatViews.long, comparison.formatViews.long);
    case "live_views":
      return compareCells("Live Views", primary.formatViews.live, comparison.formatViews.live);
    case "unknown_views":
      return compareCells("Unknown Views", primary.formatViews.unknown, comparison.formatViews.unknown);
  }
}

function getChannelCompareHeaders(columnId: ChannelCompareColumnId) {
  switch (columnId) {
    case "channel":
      return ["Channel"];
    case "channel_id":
      return ["Channel ID"];
    case "date_ranges":
      return ["Range 1", "Range 2"];
    case "views":
      return compareHeaders("Views", true);
    case "watch_hours":
      return compareHeaders("Watch Hours", true);
    case "net_subscribers":
      return compareHeaders("Net Subscribers", true);
    case "estimated_revenue":
      return compareHeaders("Estimated Revenue", true);
    case "rpm":
      return compareHeaders("RPM");
    case "playback_cpm":
      return compareHeaders("Playback CPM");
    case "monetized_playbacks":
      return compareHeaders("Monetized Playbacks");
    case "ad_impressions":
      return compareHeaders("Ad Impressions");
    case "short_views":
      return compareHeaders("Short Views");
    case "long_views":
      return compareHeaders("Long Views");
    case "live_views":
      return compareHeaders("Live Views");
    case "unknown_views":
      return compareHeaders("Unknown Views");
  }
}

function compareHeaders(label: string, includePercent = false) {
  const headers = [`Range 1 ${label}`, `Range 2 ${label}`, `${label} R2-R1`];
  if (includePercent) {
    headers.push(`${label} % Change`);
  }

  return headers;
}

function formatReportDateRange(startDate: string, endDate: string) {
  return `${formatReportDate(startDate)}-${formatReportDate(endDate)}`;
}

function formatReportDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function compareCells(
  label: string,
  primaryValue: number,
  comparisonValue: number,
  options: { includePercent?: boolean; rounded?: boolean } = {}
) {
  const current = options.rounded ? round(primaryValue) : primaryValue;
  const previous = options.rounded ? round(comparisonValue) : comparisonValue;
  const difference = options.rounded ? round(comparisonValue - primaryValue) : comparisonValue - primaryValue;
  const cells: Array<{ label: string; value: string | number }> = [
    { label: `Range 1 ${label}`, value: current },
    { label: `Range 2 ${label}`, value: previous },
    { label: `${label} R2-R1`, value: difference }
  ];

  if (options.includePercent) {
    cells.push({ label: `${label} % Change`, value: round(calculatePercentChange(comparisonValue, primaryValue)) });
  }

  return cells;
}

function assignRanks(
  summaries: ChannelSummaryRow[],
  rankKey: keyof ChannelSummaryRow["ranks"],
  getValue: (summary: ChannelSummaryRow) => number
) {
  [...summaries]
    .sort((left, right) => getValue(right) - getValue(left) || left.channel.title.localeCompare(right.channel.title))
    .forEach((summary, index) => {
      summary.ranks[rankKey] = index + 1;
    });
}

function filterChannelsForAccount(channels: StoredYoutubeManagedChannel[], account: ChannelPulseAccount) {
  if (account.channelIds === null) return channels;
  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}

function normalizeDateParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeReportType(value: string | null): ReportType | null {
  return value && REPORT_TYPES.has(value as ReportType) ? (value as ReportType) : null;
}

function buildReportRows(
  report: ReportType,
  dashboard: Awaited<ReturnType<typeof getYoutubePerformanceDashboard>>,
  channelTitle: string
) {
  if (report === "summary") {
    return [
      ["Category", "Metric", "Value"],
      ["Filter", "Month", dashboard.selectedMonth],
      ["Filter", "Channel", channelTitle],
      ["Filter", "Format", contentTypeLabel(dashboard.filters.contentType)],
      ...metricTotalRows("Current", dashboard.currentTotals),
      ...metricTotalRows("Previous", dashboard.previousTotals),
      ["Current", "Net subscribers", calculateNetSubscribers(dashboard.channelSubscriberTotals)],
      ["Previous", "Net subscribers", calculateNetSubscribers(dashboard.previousChannelSubscriberTotals)],
      ["Growth", "Views percent", round(dashboard.growth.views)],
      ["Growth", "Revenue percent", round(dashboard.growth.revenue)],
      ["Growth", "Net subscribers percent", round(dashboard.growth.netSubscribers)]
    ];
  }

  if (report === "formats") {
    return [
      ["Content type", "Views", "Estimated revenue"],
      ...dashboard.longShortSplit.map((row) => [
        contentTypeLabel(row.contentType),
        row.views,
        round(row.revenue)
      ])
    ];
  }

  if (report === "countries") {
    return [
      ["Country code", "Country name", "Views", "Estimated revenue", "RPM", "Revenue share percent"],
      ...dashboard.countryRevenueBreakdown.map((row) => countryRevenueReportRow(row, dashboard.currentTotals.estimatedRevenue))
    ];
  }

  return [
    [
      "Section",
      "Rank",
      "Video ID",
      "Title",
      "Channel ID",
      "Channel title",
      "Content type",
      "Cohort",
      "Published at",
      "Views",
      "Watch hours",
      "Estimated revenue",
      "Estimated ad revenue",
      "Gross revenue",
      "Monetized playbacks",
      "Ad impressions",
      "Playback CPM"
    ],
    ...videoSectionRows("Top viewed videos", dashboard.topViewedVideos),
    ...videoSectionRows("Top revenue videos", dashboard.topRevenueVideos),
    ...videoSectionRows("Old video leaders", dashboard.oldVideoLeaders),
    ...videoSectionRows("Last two months leaders", dashboard.recentVideoLeaders),
    ...videoSectionRows("Least viewed recent videos", dashboard.leastViewedRecentVideos)
  ];
}

function buildWorkbookResponse(rows: XlsxCellValue[][], filename: string, sheetName: string) {
  const workbook = buildXlsxWorkbook({
    columnWidth: REPORT_COLUMN_WIDTH,
    rows,
    sheetName
  });

  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      "Content-Type": EXCEL_MIME_TYPE
    }
  });
}

function reportSheetName(report: ReportType) {
  switch (report) {
    case "summary":
      return "Summary";
    case "formats":
      return "Formats";
    case "countries":
      return "Countries";
    case "videos":
      return "Videos";
    case "channel-summary":
      return "Channel Summary";
    case "channel-compare":
      return "Compare Summary";
  }
}

function metricTotalRows(category: string, totals: MetricTotals) {
  return [
    [category, "Views", totals.views],
    [category, "Watch hours", round(totals.estimatedMinutesWatched / 60)],
    [category, "Subscribers gained", totals.subscribersGained],
    [category, "Subscribers lost", totals.subscribersLost],
    [category, "Estimated revenue", round(totals.estimatedRevenue)],
    [category, "Estimated ad revenue", round(totals.estimatedAdRevenue)],
    [category, "Gross revenue", round(totals.grossRevenue)],
    [category, "Monetized playbacks", totals.monetizedPlaybacks],
    [category, "Ad impressions", totals.adImpressions],
    [category, "Playback CPM", round(calculatePlaybackCpm(totals))]
  ];
}

function countryRevenueReportRow(row: CountryRevenueRow, totalRevenue: number) {
  return [
    row.countryCode,
    row.countryName,
    row.views,
    round(row.estimatedRevenue),
    round(calculateRevenuePerThousandViews(row)),
    round(calculateRevenueShare(row.estimatedRevenue, totalRevenue))
  ];
}

function videoSectionRows(section: string, rows: VideoPerformanceRow[]) {
  return rows.map((row, index) => [
    section,
    index + 1,
    row.videoId,
    row.title,
    row.channelId,
    row.channelTitle,
    contentTypeLabel(row.contentType),
    row.cohort,
    row.publishedAt ?? "",
    row.views,
    round(row.estimatedMinutesWatched / 60),
    round(row.estimatedRevenue),
    round(row.estimatedAdRevenue),
    round(row.grossRevenue),
    row.monetizedPlaybacks,
    row.adImpressions,
    round(calculatePlaybackCpm(row))
  ]);
}

function contentTypeLabel(value: ContentTypeFilter) {
  if (value === "short") return "Short form";
  if (value === "long") return "Long form";
  if (value === "live") return "Live";
  if (value === "unknown") return "Unclassified / other";
  return "All formats";
}

function calculatePlaybackCpm(totals: MetricTotals) {
  if (totals.monetizedPlaybacks > 0) {
    return (totals.estimatedRevenue / totals.monetizedPlaybacks) * 1000;
  }

  return totals.playbackBasedCpm;
}

function calculateRevenuePerThousandViews(totals: Pick<MetricTotals, "estimatedRevenue" | "views">) {
  if (totals.views <= 0) return 0;
  return (totals.estimatedRevenue / totals.views) * 1000;
}

function calculateRevenueShare(revenue: number, totalRevenue: number) {
  if (totalRevenue <= 0) return 0;
  return (revenue / totalRevenue) * 100;
}

function calculateViewsShare(views: number, totalViews: number) {
  if (totalViews <= 0) return 0;
  return (views / totalViews) * 100;
}

function calculatePercentChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Automatic data sync failed.";
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
