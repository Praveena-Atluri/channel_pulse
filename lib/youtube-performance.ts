import { createSupabaseAdminClient } from "@/lib/supabase";
import type { ChannelAccess } from "@/lib/auth";
import { filterFocusedYouTubeChannels } from "@/lib/youtube-channel-allowlist";
import {
  addMetricTotals,
  calculateNetSubscribers,
  createEmptyTotals,
  getCurrentReportMonth,
  getDefaultReportMonth,
  getMonthDateRange,
  getPreviousMonth,
  getRecentVideoWindow,
  getVideoCohort,
  safePercentChange,
  type MetricTotals,
  type VideoCohort,
  type VideoContentType
} from "@/lib/youtube-performance-utils";

export type ContentTypeFilter = VideoContentType | "all";

export type YoutubePerformanceFilters = {
  month: string;
  channelId: string;
  contentType: ContentTypeFilter;
  cohort: VideoCohort;
};

export type YoutubeComparisonFilters = {
  channelId: string;
  contentType: ContentTypeFilter;
  primaryStartDate: string;
  primaryEndDate: string;
  comparisonStartDate: string;
  comparisonEndDate: string;
};

export type ManagedChannel = {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
};

export type VideoPerformanceRow = MetricTotals & {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  contentType: VideoContentType;
  cohort: Exclude<VideoCohort, "all">;
};

export type CountryRevenueRow = MetricTotals & {
  countryCode: string;
  countryName: string;
};

export type YoutubePerformanceDashboardData = {
  schemaReady: boolean;
  selectedMonth: string;
  previousMonth: string;
  availableMonths: string[];
  channels: ManagedChannel[];
  filters: YoutubePerformanceFilters;
  currentTotals: MetricTotals;
  previousTotals: MetricTotals;
  channelSubscriberTotals: MetricTotals;
  previousChannelSubscriberTotals: MetricTotals;
  growth: {
    views: number;
    watchTime: number;
    revenue: number;
    netSubscribers: number;
  };
  availableContentTypes: VideoContentType[];
  longShortSplit: Array<{ contentType: VideoContentType; views: number; revenue: number }>;
  countryRevenueBreakdown: CountryRevenueRow[];
  cohortSummary: {
    old: MetricTotals;
    recent: MetricTotals;
  };
  topRevenueVideos: VideoPerformanceRow[];
  topViewedVideos: VideoPerformanceRow[];
  leastViewedRecentVideos: VideoPerformanceRow[];
  oldVideoLeaders: VideoPerformanceRow[];
  recentVideoLeaders: VideoPerformanceRow[];
  videoMetricsAvailable: boolean;
  hasSelectedMonthData: boolean;
  hasPreviousMonthData: boolean;
  latestSync: {
    status: string;
    finishedAt: string | null;
    errorMessage: string | null;
  } | null;
};

export type YoutubeComparisonDashboardData = {
  schemaReady: boolean;
  channels: ManagedChannel[];
  filters: YoutubeComparisonFilters;
  primary: ComparisonPeriodData;
  comparison: ComparisonPeriodData;
  deltas: {
    views: ComparisonDelta;
    watchTime: ComparisonDelta;
    subscribers: ComparisonDelta;
    revenue: ComparisonDelta;
  };
  availableContentTypes: VideoContentType[];
  contentTypeComparison: Array<{
    contentType: VideoContentType;
    primaryViews: number;
    comparisonViews: number;
    viewsDelta: number;
    primaryRevenue: number;
    comparisonRevenue: number;
    revenueDelta: number;
  }>;
  topViewedRangeOneVideos: VideoPerformanceRow[];
  topViewedRangeTwoVideos: VideoPerformanceRow[];
  topRevenueRangeOneVideos: VideoPerformanceRow[];
  topRevenueRangeTwoVideos: VideoPerformanceRow[];
  latestSync: {
    status: string;
    finishedAt: string | null;
    errorMessage: string | null;
  } | null;
};

export type ComparisonPeriodData = {
  label: string;
  startDate: string;
  endDate: string;
  totals: MetricTotals;
  channelTotals: MetricTotals;
  videoRows: VideoPerformanceRow[];
  contentTypeRows: ContentTypeMetricRow[];
  hasData: boolean;
};

export type ComparisonDelta = {
  current: number;
  previous: number;
  absolute: number;
  percent: number;
};

type ChannelMetricRow = {
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
  playback_based_cpm: number | string | null;
};

type VideoMetricRow = {
  day: string;
  channel_id: string;
  video_id: string;
  views: number | string | null;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  estimated_ad_revenue: number | string | null;
  gross_revenue: number | string | null;
  monetized_playbacks: number | string | null;
  ad_impressions: number | string | null;
  playback_based_cpm: number | string | null;
};

type VideoCatalogRow = {
  video_id: string;
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string | null;
  content_type: VideoContentType | null;
};

type ContentTypeMetricRow = {
  day: string;
  channel_id: string;
  content_type: VideoContentType;
  views: number | string | null;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  estimated_ad_revenue: number | string | null;
  gross_revenue: number | string | null;
  monetized_playbacks: number | string | null;
};

type CountryMetricRow = {
  day: string;
  channel_id: string;
  country_code: string;
  views: number | string | null;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  estimated_ad_revenue: number | string | null;
  gross_revenue: number | string | null;
  monetized_playbacks: number | string | null;
  ad_impressions: number | string | null;
  playback_based_cpm: number | string | null;
};

const VALID_CONTENT_TYPES: ContentTypeFilter[] = ["all", "short", "long", "live", "unknown"];
const VALID_COHORTS: VideoCohort[] = ["all", "recent", "old"];
const SUPABASE_PAGE_SIZE = 1000;
const VIDEO_TABLE_RESULT_LIMIT = 100;
const DEFAULT_YOUTUBE_CHANNEL_ID = "UCXjhJbviBl0M4JAC3cxDXqA";

export function normalizeYoutubePerformanceFilters(input: {
  month?: string;
  channel?: string;
  contentType?: string;
  cohort?: string;
}): YoutubePerformanceFilters {
  return {
    month: isValidMonth(input.month) ? input.month : getDefaultReportMonth(),
    channelId: input.channel ?? "all",
    contentType: VALID_CONTENT_TYPES.includes(input.contentType as ContentTypeFilter)
      ? (input.contentType as ContentTypeFilter)
      : "all",
    cohort: VALID_COHORTS.includes(input.cohort as VideoCohort) ? (input.cohort as VideoCohort) : "all"
  };
}

export function normalizeYoutubeComparisonFilters(input: {
  channel?: string;
  contentType?: string;
  primaryStartDate?: string;
  primaryEndDate?: string;
  comparisonStartDate?: string;
  comparisonEndDate?: string;
}): YoutubeComparisonFilters {
  const defaultMonth = getDefaultReportMonth();
  const defaultPreviousMonth = getPreviousMonth(defaultMonth);
  const primaryDefaultRange = getInclusiveMonthDateRange(defaultPreviousMonth);
  const comparisonDefaultRange = getInclusiveMonthDateRange(defaultMonth);

  const primary = normalizeInclusiveDateRange({
    startDate: input.primaryStartDate,
    endDate: input.primaryEndDate,
    fallback: primaryDefaultRange
  });
  const comparison = normalizeInclusiveDateRange({
    startDate: input.comparisonStartDate,
    endDate: input.comparisonEndDate,
    fallback: comparisonDefaultRange
  });

  return {
    channelId: input.channel ?? "all",
    contentType: VALID_CONTENT_TYPES.includes(input.contentType as ContentTypeFilter)
      ? (input.contentType as ContentTypeFilter)
      : "all",
    primaryStartDate: primary.startDate,
    primaryEndDate: primary.endDate,
    comparisonStartDate: comparison.startDate,
    comparisonEndDate: comparison.endDate
  };
}

export async function getYoutubePerformanceDashboard(
  rawFilters: YoutubePerformanceFilters,
  access?: ChannelAccess
): Promise<YoutubePerformanceDashboardData> {
  const supabase = createSupabaseAdminClient();
  const filters = { ...rawFilters };

  try {
    const [allChannels, latestSync] = await Promise.all([
      getManagedChannels(supabase),
      getLatestSyncRun(supabase)
    ]);
    const channels = filterChannelsForAccess(allChannels, access);
    filters.channelId = resolveSelectedChannelId(filters.channelId, channels);
    const latestMonth = await getLatestMetricMonth(supabase, filters.channelId);

    if (!rawFilters.month && latestMonth) {
      filters.month = latestMonth;
    }

    const previousMonth = getPreviousMonth(filters.month);
    const currentRange = getMonthDateRange(filters.month);
    const previousRange = getMonthDateRange(previousMonth);

    const [currentChannelRows, previousChannelRows] = await Promise.all([
      getChannelMetrics(supabase, currentRange.startDate, currentRange.endDate, filters.channelId),
      getChannelMetrics(supabase, previousRange.startDate, previousRange.endDate, filters.channelId)
    ]);

    const channelCurrentTotals = sumChannelMetrics(currentChannelRows);
    const channelPreviousTotals = sumChannelMetrics(previousChannelRows);
    const hasSelectedMonthData = currentChannelRows.length > 0;
    const hasPreviousMonthData = previousChannelRows.length > 0;

    if (!hasSelectedMonthData || !hasPreviousMonthData) {
      return {
        schemaReady: true,
        selectedMonth: filters.month,
        previousMonth,
        availableMonths: buildAvailableMonths(latestMonth ?? filters.month),
        channels,
        filters,
        currentTotals: channelCurrentTotals,
        previousTotals: channelPreviousTotals,
        channelSubscriberTotals: channelCurrentTotals,
        previousChannelSubscriberTotals: channelPreviousTotals,
        growth: {
          views: safePercentChange(channelCurrentTotals.views, channelPreviousTotals.views),
          watchTime: safePercentChange(
            channelCurrentTotals.estimatedMinutesWatched,
            channelPreviousTotals.estimatedMinutesWatched
          ),
          revenue: safePercentChange(channelCurrentTotals.estimatedRevenue, channelPreviousTotals.estimatedRevenue),
          netSubscribers: safePercentChange(
            calculateNetSubscribers(channelCurrentTotals),
            calculateNetSubscribers(channelPreviousTotals)
          )
        },
        availableContentTypes: ["short", "long"],
        longShortSplit: [],
        countryRevenueBreakdown: [],
        cohortSummary: { old: createEmptyTotals(), recent: createEmptyTotals() },
        topRevenueVideos: [],
        topViewedVideos: [],
        leastViewedRecentVideos: [],
        oldVideoLeaders: [],
        recentVideoLeaders: [],
        videoMetricsAvailable: false,
        hasSelectedMonthData,
        hasPreviousMonthData,
        latestSync
      };
    }

    const [currentVideos, previousVideos, currentContentTypeRows, previousContentTypeRows, currentCountryRows] =
      await Promise.all([
      getVideoPerformanceRows(supabase, currentRange.startDate, currentRange.endDate, filters, channels),
      getVideoPerformanceRows(supabase, previousRange.startDate, previousRange.endDate, filters, channels),
      getContentTypeMetrics(supabase, currentRange.startDate, currentRange.endDate, filters.channelId),
      getContentTypeMetrics(supabase, previousRange.startDate, previousRange.endDate, filters.channelId),
      getCountryMetrics(supabase, currentRange.startDate, currentRange.endDate, filters.channelId)
    ]);

    const scopedCurrentTotals = getScopedTotals(filters, {
      channelTotals: channelCurrentTotals,
      contentTypeRows: currentContentTypeRows,
      videoRows: currentVideos.filteredRows
    });
    const scopedPreviousTotals = getScopedTotals(filters, {
      channelTotals: channelPreviousTotals,
      contentTypeRows: previousContentTypeRows,
      videoRows: previousVideos.filteredRows
    });

    const twoMonthVideos = combineVideoRowsById([...previousVideos.allRows, ...currentVideos.allRows]);
    const twoMonthFilteredVideos = filterVideoRows(twoMonthVideos, filters);
    const twoMonthRecentRows = twoMonthFilteredVideos.filter((row) => row.cohort === "recent");
    const twoMonthRecentRowsWithViews = twoMonthRecentRows.filter((row) => row.views > 0);
    const cohortBaseTotals =
      filters.contentType === "all" ? channelCurrentTotals : sumContentTypeMetrics(currentContentTypeRows, filters.contentType);
    const selectedMonthRecentRows = currentVideos.allRows.filter((row) => {
      if (row.cohort !== "recent") return false;
      return filters.contentType === "all" || row.contentType === filters.contentType;
    });
    const recentTotals = sumVideoRows(selectedMonthRecentRows);
    const cohortSummary = {
      old: subtractMetricTotals(cohortBaseTotals, recentTotals),
      recent: recentTotals
    };

    const longShortSplit = buildContentTypeSplit(currentContentTypeRows, filters);
    const availableContentTypes = buildAvailableContentTypes(currentContentTypeRows);
    const oldRows = currentVideos.filteredRows.filter((row) => row.cohort === "old");
    const videoMetricsAvailable =
      currentVideos.allRows.some(hasVideoPerformanceMetrics) ||
      previousVideos.allRows.some(hasVideoPerformanceMetrics);

    return {
      schemaReady: true,
      selectedMonth: filters.month,
      previousMonth,
      availableMonths: buildAvailableMonths(latestMonth ?? filters.month),
      channels,
      filters,
      currentTotals: scopedCurrentTotals,
      previousTotals: scopedPreviousTotals,
      channelSubscriberTotals: channelCurrentTotals,
      previousChannelSubscriberTotals: channelPreviousTotals,
      growth: {
        views: safePercentChange(scopedCurrentTotals.views, scopedPreviousTotals.views),
        watchTime: safePercentChange(
          scopedCurrentTotals.estimatedMinutesWatched,
          scopedPreviousTotals.estimatedMinutesWatched
        ),
        revenue: safePercentChange(scopedCurrentTotals.estimatedRevenue, scopedPreviousTotals.estimatedRevenue),
        netSubscribers: safePercentChange(
          calculateNetSubscribers(channelCurrentTotals),
          calculateNetSubscribers(channelPreviousTotals)
        )
      },
      availableContentTypes,
      longShortSplit,
      countryRevenueBreakdown: buildCountryRevenueBreakdown(currentCountryRows).slice(0, 10),
      cohortSummary,
      topRevenueVideos: sortByMetric(currentVideos.filteredRows, "estimatedRevenue").slice(0, VIDEO_TABLE_RESULT_LIMIT),
      topViewedVideos: sortByMetric(currentVideos.filteredRows, "views").slice(0, VIDEO_TABLE_RESULT_LIMIT),
      leastViewedRecentVideos: [...twoMonthRecentRowsWithViews]
        .sort((left, right) => left.views - right.views)
        .slice(0, VIDEO_TABLE_RESULT_LIMIT),
      oldVideoLeaders: sortByMetric(oldRows, "views").slice(0, VIDEO_TABLE_RESULT_LIMIT),
      recentVideoLeaders: sortByMetric(twoMonthRecentRows, "views").slice(0, VIDEO_TABLE_RESULT_LIMIT),
      videoMetricsAvailable,
      hasSelectedMonthData,
      hasPreviousMonthData,
      latestSync
    };
  } catch (error) {
    console.error(error);
    return emptyDashboard(filters);
  }
}

export async function getYoutubeComparisonDashboard(
  rawFilters: YoutubeComparisonFilters,
  access?: ChannelAccess
): Promise<YoutubeComparisonDashboardData> {
  const supabase = createSupabaseAdminClient();
  const filters = { ...rawFilters };

  try {
    const [allChannels, latestSync] = await Promise.all([getManagedChannels(supabase), getLatestSyncRun(supabase)]);
    const channels = filterChannelsForAccess(allChannels, access);
    filters.channelId = resolveSelectedChannelId(filters.channelId, channels);

    const primaryRange = toExclusiveDateRange(filters.primaryStartDate, filters.primaryEndDate);
    const comparisonRange = toExclusiveDateRange(filters.comparisonStartDate, filters.comparisonEndDate);
    const primaryMonth = filters.primaryStartDate.slice(0, 7);
    const comparisonMonth = filters.comparisonStartDate.slice(0, 7);
    const primaryVideoFilters: YoutubePerformanceFilters = {
      month: primaryMonth,
      channelId: filters.channelId,
      contentType: filters.contentType,
      cohort: "all"
    };
    const comparisonVideoFilters: YoutubePerformanceFilters = {
      month: comparisonMonth,
      channelId: filters.channelId,
      contentType: filters.contentType,
      cohort: "all"
    };

    const [primaryChannelRows, comparisonChannelRows] = await Promise.all([
      getChannelMetrics(supabase, primaryRange.startDate, primaryRange.endDate, filters.channelId),
      getChannelMetrics(supabase, comparisonRange.startDate, comparisonRange.endDate, filters.channelId)
    ]);

    const primaryChannelTotals = sumChannelMetrics(primaryChannelRows);
    const comparisonChannelTotals = sumChannelMetrics(comparisonChannelRows);
    const hasPrimaryData = primaryChannelRows.length > 0;
    const hasComparisonData = comparisonChannelRows.length > 0;

    if (!hasPrimaryData || !hasComparisonData) {
      return {
        schemaReady: true,
        channels,
        filters,
        primary: {
          label: "Range 1",
          startDate: filters.primaryStartDate,
          endDate: filters.primaryEndDate,
          totals: primaryChannelTotals,
          channelTotals: primaryChannelTotals,
          videoRows: [],
          contentTypeRows: [],
          hasData: hasPrimaryData
        },
        comparison: {
          label: "Range 2",
          startDate: filters.comparisonStartDate,
          endDate: filters.comparisonEndDate,
          totals: comparisonChannelTotals,
          channelTotals: comparisonChannelTotals,
          videoRows: [],
          contentTypeRows: [],
          hasData: hasComparisonData
        },
        deltas: {
          views: buildComparisonDelta(primaryChannelTotals.views, comparisonChannelTotals.views),
          watchTime: buildComparisonDelta(
            primaryChannelTotals.estimatedMinutesWatched,
            comparisonChannelTotals.estimatedMinutesWatched
          ),
          subscribers: buildComparisonDelta(
            calculateNetSubscribers(primaryChannelTotals),
            calculateNetSubscribers(comparisonChannelTotals)
          ),
          revenue: buildComparisonDelta(
            primaryChannelTotals.estimatedRevenue,
            comparisonChannelTotals.estimatedRevenue
          )
        },
        availableContentTypes: ["short", "long"],
        contentTypeComparison: [],
        topViewedRangeOneVideos: [],
        topViewedRangeTwoVideos: [],
        topRevenueRangeOneVideos: [],
        topRevenueRangeTwoVideos: [],
        latestSync
      };
    }

    const [primaryContentTypeRows, comparisonContentTypeRows, primaryVideos, comparisonVideos] = await Promise.all([
      getContentTypeMetrics(supabase, primaryRange.startDate, primaryRange.endDate, filters.channelId),
      getContentTypeMetrics(supabase, comparisonRange.startDate, comparisonRange.endDate, filters.channelId),
      getVideoPerformanceRows(supabase, primaryRange.startDate, primaryRange.endDate, primaryVideoFilters, channels),
      getVideoPerformanceRows(supabase, comparisonRange.startDate, comparisonRange.endDate, comparisonVideoFilters, channels)
    ]);

    const primaryTotals = getScopedTotals(primaryVideoFilters, {
      channelTotals: primaryChannelTotals,
      contentTypeRows: primaryContentTypeRows,
      videoRows: primaryVideos.filteredRows
    });
    const comparisonTotals = getScopedTotals(comparisonVideoFilters, {
      channelTotals: comparisonChannelTotals,
      contentTypeRows: comparisonContentTypeRows,
      videoRows: comparisonVideos.filteredRows
    });

    return {
      schemaReady: true,
      channels,
      filters,
      primary: {
        label: "Range 1",
        startDate: filters.primaryStartDate,
        endDate: filters.primaryEndDate,
        totals: primaryTotals,
        channelTotals: primaryChannelTotals,
        videoRows: primaryVideos.filteredRows,
        contentTypeRows: primaryContentTypeRows,
        hasData: hasPrimaryData
      },
      comparison: {
        label: "Range 2",
        startDate: filters.comparisonStartDate,
        endDate: filters.comparisonEndDate,
        totals: comparisonTotals,
        channelTotals: comparisonChannelTotals,
        videoRows: comparisonVideos.filteredRows,
        contentTypeRows: comparisonContentTypeRows,
        hasData: hasComparisonData
      },
      deltas: {
        views: buildComparisonDelta(primaryTotals.views, comparisonTotals.views),
        watchTime: buildComparisonDelta(primaryTotals.estimatedMinutesWatched, comparisonTotals.estimatedMinutesWatched),
        subscribers: buildComparisonDelta(
          calculateNetSubscribers(primaryChannelTotals),
          calculateNetSubscribers(comparisonChannelTotals)
        ),
        revenue: buildComparisonDelta(primaryTotals.estimatedRevenue, comparisonTotals.estimatedRevenue)
      },
      availableContentTypes: buildAvailableContentTypes([...primaryContentTypeRows, ...comparisonContentTypeRows]),
      contentTypeComparison: buildContentTypeComparison(primaryContentTypeRows, comparisonContentTypeRows, filters),
      topViewedRangeOneVideos: sortByMetric(primaryVideos.filteredRows, "views").slice(0, VIDEO_TABLE_RESULT_LIMIT),
      topViewedRangeTwoVideos: sortByMetric(comparisonVideos.filteredRows, "views").slice(0, VIDEO_TABLE_RESULT_LIMIT),
      topRevenueRangeOneVideos: sortByMetric(primaryVideos.filteredRows, "estimatedRevenue").slice(
        0,
        VIDEO_TABLE_RESULT_LIMIT
      ),
      topRevenueRangeTwoVideos: sortByMetric(comparisonVideos.filteredRows, "estimatedRevenue").slice(
        0,
        VIDEO_TABLE_RESULT_LIMIT
      ),
      latestSync
    };
  } catch (error) {
    console.error(error);
    return emptyComparisonDashboard(filters);
  }
}

async function getManagedChannels(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from("youtube_managed_channels")
    .select("channel_id,title,thumbnail_url")
    .order("title", { ascending: true });

  if (error) throw error;

  const channels = ((data ?? []) as Array<{ channel_id: string; title: string; thumbnail_url: string | null }>).map(
    (channel) => ({
      channelId: channel.channel_id,
      title: channel.title,
      thumbnailUrl: channel.thumbnail_url
    })
  );

  return filterFocusedYouTubeChannels(channels);
}

async function getLatestMetricMonth(supabase: ReturnType<typeof createSupabaseAdminClient>, channelId: string) {
  let query = supabase
    .from("youtube_channel_daily_metrics")
    .select("day")
    .order("day", { ascending: false })
    .limit(1);

  if (channelId !== "all") {
    query = query.eq("channel_id", channelId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  const row = data as { day?: string } | null;
  return row?.day ? row.day.slice(0, 7) : null;
}

async function getLatestSyncRun(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from("youtube_analytics_sync_runs")
    .select("status,finished_at,error_message")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const row = data as { status: string; finished_at: string | null; error_message: string | null } | null;
  if (!row) return null;

  return {
    status: row.status,
    finishedAt: row.finished_at,
    errorMessage: row.error_message
  };
}

async function getChannelMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelId: string
) {
  const rows: ChannelMetricRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("youtube_channel_daily_metrics")
      .select(
        "day,channel_id,views,estimated_minutes_watched,subscribers_gained,subscribers_lost,estimated_revenue,estimated_ad_revenue,gross_revenue,monetized_playbacks,ad_impressions,playback_based_cpm"
      )
      .gte("day", startDate)
      .lt("day", endDate)
      .order("day", { ascending: true })
      .order("channel_id", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (channelId !== "all") {
      query = query.eq("channel_id", channelId);
    }

    const { data, error } = await query;
    if (error) throw error;

    rows.push(...((data ?? []) as ChannelMetricRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function getContentTypeMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelId: string
) {
  const rows: ContentTypeMetricRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("youtube_content_type_daily_metrics")
      .select(
        "day,channel_id,content_type,views,estimated_minutes_watched,estimated_revenue,estimated_ad_revenue,gross_revenue,monetized_playbacks"
      )
      .gte("day", startDate)
      .lt("day", endDate)
      .order("day", { ascending: true })
      .order("channel_id", { ascending: true })
      .order("content_type", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (channelId !== "all") {
      query = query.eq("channel_id", channelId);
    }

    const { data, error } = await query;
    if (error) throw error;

    rows.push(...((data ?? []) as ContentTypeMetricRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function getCountryMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelId: string
) {
  const rows: CountryMetricRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("youtube_country_daily_metrics")
      .select(
        "day,channel_id,country_code,views,estimated_minutes_watched,estimated_revenue,estimated_ad_revenue,gross_revenue,monetized_playbacks,ad_impressions,playback_based_cpm"
      )
      .eq("day", startDate)
      .order("day", { ascending: true })
      .order("channel_id", { ascending: true })
      .order("country_code", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (channelId !== "all") {
      query = query.eq("channel_id", channelId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn(`Country revenue metrics unavailable: ${error.message}`);
      return [];
    }

    rows.push(...((data ?? []) as CountryMetricRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function getVideoPerformanceRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  startDate: string,
  endDate: string,
  filters: YoutubePerformanceFilters,
  channels: ManagedChannel[]
) {
  const metrics = await getVideoMetricRows(supabase, startDate, endDate, filters.channelId);
  const metricVideoIds = Array.from(new Set(metrics.map((row) => row.video_id)));
  const recentWindow = getRecentVideoWindow(filters.month);
  const recentVideos = await getRecentCatalogVideos(
    supabase,
    recentWindow.startDate,
    recentWindow.endDate,
    filters.channelId
  );
  const catalogRows = await getCatalogRows(supabase, unique([...metricVideoIds, ...recentVideos.map((row) => row.video_id)]));
  const catalogById = new Map(catalogRows.map((row) => [row.video_id, row]));
  const channelById = new Map(channels.map((channel) => [channel.channelId, channel.title]));
  const rowByVideoId = new Map<string, VideoPerformanceRow>();

  for (const metric of metrics) {
    const catalog = catalogById.get(metric.video_id);
    const row =
      rowByVideoId.get(metric.video_id) ??
      createVideoPerformanceRow(metric.video_id, metric.channel_id, catalog, channelById, filters.month);

    addMetricTotals(row, metricToTotals(metric));
    rowByVideoId.set(metric.video_id, row);
  }

  for (const catalog of recentVideos) {
    if (!rowByVideoId.has(catalog.video_id)) {
      rowByVideoId.set(
        catalog.video_id,
        createVideoPerformanceRow(catalog.video_id, catalog.channel_id, catalog, channelById, filters.month)
      );
    }
  }

  const allRows = Array.from(rowByVideoId.values());
  const filteredRows = allRows.filter((row) => {
    if (filters.contentType !== "all" && row.contentType !== filters.contentType) return false;
    if (filters.cohort !== "all" && row.cohort !== filters.cohort) return false;
    return true;
  });

  return { allRows, filteredRows };
}

async function getCatalogRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  videoIds: string[]
): Promise<VideoCatalogRow[]> {
  const rows: VideoCatalogRow[] = [];

  for (const ids of chunk(videoIds, 500)) {
    if (ids.length === 0) continue;

    const { data, error } = await supabase
      .from("youtube_video_catalog")
      .select("video_id,channel_id,title,thumbnail_url,published_at,content_type")
      .in("video_id", ids);

    if (error) throw error;
    rows.push(...((data ?? []) as VideoCatalogRow[]));
  }

  return rows;
}

async function getVideoMetricRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelId: string
) {
  const rows: VideoMetricRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("youtube_video_daily_metrics")
      .select(
        "day,channel_id,video_id,views,estimated_minutes_watched,estimated_revenue,estimated_ad_revenue,gross_revenue,monetized_playbacks,ad_impressions,playback_based_cpm"
      )
      .gte("day", startDate)
      .lt("day", endDate)
      .order("day", { ascending: true })
      .order("channel_id", { ascending: true })
      .order("video_id", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (channelId !== "all") {
      query = query.eq("channel_id", channelId);
    }

    const { data, error } = await query;
    if (error) throw error;

    rows.push(...((data ?? []) as VideoMetricRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function getRecentCatalogVideos(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  startDate: string,
  endDate: string,
  channelId: string
) {
  const rows: VideoCatalogRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("youtube_video_catalog")
      .select("video_id,channel_id,title,thumbnail_url,published_at,content_type")
      .gte("published_at", `${startDate}T00:00:00.000Z`)
      .lt("published_at", `${endDate}T00:00:00.000Z`)
      .order("published_at", { ascending: true })
      .order("video_id", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (channelId !== "all") {
      query = query.eq("channel_id", channelId);
    }

    const { data, error } = await query;
    if (error) throw error;

    rows.push(...((data ?? []) as VideoCatalogRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

function createVideoPerformanceRow(
  videoId: string,
  channelId: string,
  catalog: VideoCatalogRow | undefined,
  channelById: Map<string, string>,
  selectedMonth: string
): VideoPerformanceRow {
  return {
    ...createEmptyTotals(),
    videoId,
    channelId,
    channelTitle: channelById.get(channelId) ?? channelId,
    title: catalog?.title ?? videoId,
    thumbnailUrl: catalog?.thumbnail_url ?? null,
    publishedAt: catalog?.published_at ?? null,
    contentType: catalog?.content_type ?? "unknown",
    cohort: getVideoCohort(catalog?.published_at ?? null, selectedMonth)
  };
}

function sumChannelMetrics(rows: ChannelMetricRow[]) {
  const totals = createEmptyTotals();
  for (const row of rows) {
    addMetricTotals(totals, {
      views: toNumber(row.views),
      estimatedMinutesWatched: toNumber(row.estimated_minutes_watched),
      subscribersGained: toNumber(row.subscribers_gained),
      subscribersLost: toNumber(row.subscribers_lost),
      estimatedRevenue: toNumber(row.estimated_revenue),
      estimatedAdRevenue: toNumber(row.estimated_ad_revenue),
      grossRevenue: toNumber(row.gross_revenue),
      monetizedPlaybacks: toNumber(row.monetized_playbacks),
      adImpressions: toNumber(row.ad_impressions),
      playbackBasedCpm: toNumber(row.playback_based_cpm)
    });
  }

  return totals;
}

function sumVideoRows(rows: VideoPerformanceRow[]) {
  const totals = createEmptyTotals();
  for (const row of rows) {
    addMetricTotals(totals, row);
  }
  return totals;
}

function combineVideoRowsById(rows: VideoPerformanceRow[]) {
  const rowByVideoId = new Map<string, VideoPerformanceRow>();

  for (const row of rows) {
    const existing = rowByVideoId.get(row.videoId);
    if (!existing) {
      rowByVideoId.set(row.videoId, { ...row });
      continue;
    }

    addMetricTotals(existing, row);
  }

  return Array.from(rowByVideoId.values());
}

function filterVideoRows(rows: VideoPerformanceRow[], filters: YoutubePerformanceFilters) {
  return rows.filter((row) => {
    if (filters.contentType !== "all" && row.contentType !== filters.contentType) return false;
    if (filters.cohort !== "all" && row.cohort !== filters.cohort) return false;
    return true;
  });
}

function sumContentTypeMetrics(rows: ContentTypeMetricRow[], contentType: ContentTypeFilter = "all") {
  const totals = createEmptyTotals();
  for (const row of rows) {
    if (contentType !== "all" && row.content_type !== contentType) continue;

    addMetricTotals(totals, {
      views: toNumber(row.views),
      estimatedMinutesWatched: toNumber(row.estimated_minutes_watched),
      estimatedRevenue: toNumber(row.estimated_revenue),
      estimatedAdRevenue: toNumber(row.estimated_ad_revenue),
      grossRevenue: toNumber(row.gross_revenue),
      monetizedPlaybacks: toNumber(row.monetized_playbacks)
    });
  }
  return totals;
}

function getScopedTotals(
  filters: YoutubePerformanceFilters,
  input: {
    channelTotals: MetricTotals;
    contentTypeRows: ContentTypeMetricRow[];
    videoRows: VideoPerformanceRow[];
  }
) {
  if (filters.cohort !== "all") {
    return sumVideoRows(input.videoRows);
  }

  if (filters.contentType !== "all") {
    return sumContentTypeMetrics(input.contentTypeRows, filters.contentType);
  }

  return fillMissingChannelTotals(input.channelTotals, sumContentTypeMetrics(input.contentTypeRows));
}

function metricToTotals(row: VideoMetricRow): Partial<MetricTotals> {
  return {
    views: toNumber(row.views),
    estimatedMinutesWatched: toNumber(row.estimated_minutes_watched),
    estimatedRevenue: toNumber(row.estimated_revenue),
    estimatedAdRevenue: toNumber(row.estimated_ad_revenue),
    grossRevenue: toNumber(row.gross_revenue),
    monetizedPlaybacks: toNumber(row.monetized_playbacks),
    adImpressions: toNumber(row.ad_impressions),
    playbackBasedCpm: toNumber(row.playback_based_cpm)
  };
}

function buildContentTypeSplit(rows: ContentTypeMetricRow[], filters: YoutubePerformanceFilters) {
  const split = new Map<VideoContentType, { contentType: VideoContentType; views: number; revenue: number }>();

  for (const row of rows) {
    if (filters.contentType !== "all" && row.content_type !== filters.contentType) continue;
    if (filters.cohort !== "all") continue;

    const item = split.get(row.content_type) ?? { contentType: row.content_type, views: 0, revenue: 0 };
    item.views += toNumber(row.views);
    item.revenue += toNumber(row.estimated_revenue);
    split.set(row.content_type, item);
  }

  return Array.from(split.values())
    .filter((item) => shouldShowContentType(item.contentType, item.views))
    .sort((left, right) => right.views - left.views);
}

function buildCountryRevenueBreakdown(rows: CountryMetricRow[]) {
  const countries = new Map<string, CountryRevenueRow>();

  for (const row of rows) {
    const countryCode = normalizeCountryCode(row.country_code);
    const item = countries.get(countryCode) ?? {
      ...createEmptyTotals(),
      countryCode,
      countryName: formatCountryName(countryCode)
    };

    addMetricTotals(item, {
      views: toNumber(row.views),
      estimatedMinutesWatched: toNumber(row.estimated_minutes_watched),
      estimatedRevenue: toNumber(row.estimated_revenue),
      estimatedAdRevenue: toNumber(row.estimated_ad_revenue),
      grossRevenue: toNumber(row.gross_revenue),
      monetizedPlaybacks: toNumber(row.monetized_playbacks),
      adImpressions: toNumber(row.ad_impressions),
      playbackBasedCpm: toNumber(row.playback_based_cpm)
    });
    countries.set(countryCode, item);
  }

  return Array.from(countries.values()).sort((left, right) => right.estimatedRevenue - left.estimatedRevenue);
}

function buildContentTypeComparison(
  primaryRows: ContentTypeMetricRow[],
  comparisonRows: ContentTypeMetricRow[],
  filters: YoutubeComparisonFilters
) {
  const primaryByType = buildContentTypeTotalsByType(primaryRows, filters.contentType);
  const comparisonByType = buildContentTypeTotalsByType(comparisonRows, filters.contentType);
  const contentTypes = Array.from(new Set([...primaryByType.keys(), ...comparisonByType.keys()]));

  return contentTypes
    .map((contentType) => {
      const primary = primaryByType.get(contentType) ?? createEmptyTotals();
      const comparison = comparisonByType.get(contentType) ?? createEmptyTotals();

      return {
        contentType,
        primaryViews: primary.views,
        comparisonViews: comparison.views,
        viewsDelta: comparison.views - primary.views,
        primaryRevenue: primary.estimatedRevenue,
        comparisonRevenue: comparison.estimatedRevenue,
        revenueDelta: comparison.estimatedRevenue - primary.estimatedRevenue
      };
    })
    .filter((row) => shouldShowContentType(row.contentType, row.primaryViews + row.comparisonViews))
    .sort((left, right) => right.primaryViews - left.primaryViews);
}

function buildAvailableContentTypes(rows: ContentTypeMetricRow[]) {
  const visibleTypes = new Set<VideoContentType>(["short", "long"]);
  const totalsByType = buildContentTypeTotalsByType(rows, "all");

  for (const contentType of ["live", "unknown"] satisfies VideoContentType[]) {
    const views = totalsByType.get(contentType)?.views ?? 0;
    if (views > 0) {
      visibleTypes.add(contentType);
    }
  }

  return Array.from(visibleTypes);
}

function shouldShowContentType(contentType: VideoContentType, views: number) {
  if (contentType === "live" || contentType === "unknown") {
    return views > 0;
  }

  return true;
}

function buildContentTypeTotalsByType(rows: ContentTypeMetricRow[], contentTypeFilter: ContentTypeFilter) {
  const map = new Map<VideoContentType, MetricTotals>();

  for (const row of rows) {
    if (contentTypeFilter !== "all" && row.content_type !== contentTypeFilter) continue;

    const totals = map.get(row.content_type) ?? createEmptyTotals();
    addMetricTotals(totals, {
      views: toNumber(row.views),
      estimatedMinutesWatched: toNumber(row.estimated_minutes_watched),
      estimatedRevenue: toNumber(row.estimated_revenue),
      estimatedAdRevenue: toNumber(row.estimated_ad_revenue),
      grossRevenue: toNumber(row.gross_revenue),
      monetizedPlaybacks: toNumber(row.monetized_playbacks)
    });
    map.set(row.content_type, totals);
  }

  return map;
}

function buildComparisonDelta(current: number, previous: number): ComparisonDelta {
  return {
    current,
    previous,
    absolute: previous - current,
    percent: safePercentChange(previous, current)
  };
}

function fillMissingChannelTotals(channelTotals: MetricTotals, fallbackTotals: MetricTotals) {
  return {
    ...channelTotals,
    views: channelTotals.views || fallbackTotals.views,
    estimatedMinutesWatched: channelTotals.estimatedMinutesWatched || fallbackTotals.estimatedMinutesWatched,
    estimatedRevenue: channelTotals.estimatedRevenue || fallbackTotals.estimatedRevenue,
    estimatedAdRevenue: channelTotals.estimatedAdRevenue || fallbackTotals.estimatedAdRevenue,
    grossRevenue: channelTotals.grossRevenue || fallbackTotals.grossRevenue,
    monetizedPlaybacks: channelTotals.monetizedPlaybacks || fallbackTotals.monetizedPlaybacks
  };
}

function subtractMetricTotals(left: MetricTotals, right: MetricTotals) {
  return {
    views: Math.max(0, left.views - right.views),
    estimatedMinutesWatched: Math.max(0, left.estimatedMinutesWatched - right.estimatedMinutesWatched),
    subscribersGained: Math.max(0, left.subscribersGained - right.subscribersGained),
    subscribersLost: Math.max(0, left.subscribersLost - right.subscribersLost),
    estimatedRevenue: Math.max(0, left.estimatedRevenue - right.estimatedRevenue),
    estimatedAdRevenue: Math.max(0, left.estimatedAdRevenue - right.estimatedAdRevenue),
    grossRevenue: Math.max(0, left.grossRevenue - right.grossRevenue),
    monetizedPlaybacks: Math.max(0, left.monetizedPlaybacks - right.monetizedPlaybacks),
    adImpressions: Math.max(0, left.adImpressions - right.adImpressions),
    playbackBasedCpm: 0
  };
}

function sortByMetric(rows: VideoPerformanceRow[], metric: keyof Pick<MetricTotals, "views" | "estimatedRevenue">) {
  return [...rows].sort((left, right) => right[metric] - left[metric]);
}

function normalizeCountryCode(value: string | null | undefined) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "ZZ";
}

function formatCountryName(countryCode: string) {
  if (countryCode === "ZZ") return "Unknown";

  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function hasVideoPerformanceMetrics(row: VideoPerformanceRow) {
  return row.views > 0 || row.estimatedMinutesWatched > 0 || row.estimatedRevenue > 0;
}

function buildAvailableMonths(latestMonth: string) {
  const currentMonth = getCurrentReportMonth();
  const anchorMonth = latestMonth > currentMonth ? latestMonth : currentMonth;
  const [year, month] = anchorMonth.split("-").map(Number);
  const months: string[] = [];

  for (let index = 0; index < 24; index += 1) {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return months;
}

function getInclusiveMonthDateRange(month: string) {
  const range = getMonthDateRange(month);
  return {
    startDate: range.startDate,
    endDate: addDays(range.endDate, -1)
  };
}

function normalizeInclusiveDateRange(input: {
  startDate?: string;
  endDate?: string;
  fallback: { startDate: string; endDate: string };
}) {
  const startDate = isValidReportDate(input.startDate) ? input.startDate : input.fallback.startDate;
  const endDate = isValidReportDate(input.endDate) ? input.endDate : input.fallback.endDate;

  if (new Date(`${startDate}T00:00:00.000Z`).getTime() > new Date(`${endDate}T00:00:00.000Z`).getTime()) {
    return { startDate, endDate: startDate };
  }

  return { startDate, endDate };
}

function toExclusiveDateRange(startDate: string, inclusiveEndDate: string) {
  return {
    startDate,
    endDate: addDays(inclusiveEndDate, 1)
  };
}

function emptyDashboard(filters: YoutubePerformanceFilters): YoutubePerformanceDashboardData {
  const previousMonth = getPreviousMonth(filters.month);
  return {
    schemaReady: false,
    selectedMonth: filters.month,
    previousMonth,
    availableMonths: buildAvailableMonths(filters.month),
    channels: [],
    filters,
    currentTotals: createEmptyTotals(),
    previousTotals: createEmptyTotals(),
    channelSubscriberTotals: createEmptyTotals(),
    previousChannelSubscriberTotals: createEmptyTotals(),
    growth: { views: 0, watchTime: 0, revenue: 0, netSubscribers: 0 },
    availableContentTypes: ["short", "long"],
    longShortSplit: [],
    countryRevenueBreakdown: [],
    cohortSummary: { old: createEmptyTotals(), recent: createEmptyTotals() },
    topRevenueVideos: [],
    topViewedVideos: [],
    leastViewedRecentVideos: [],
    oldVideoLeaders: [],
    recentVideoLeaders: [],
    videoMetricsAvailable: false,
    hasSelectedMonthData: false,
    hasPreviousMonthData: false,
    latestSync: null
  };
}

function emptyComparisonDashboard(filters: YoutubeComparisonFilters): YoutubeComparisonDashboardData {
  const emptyPeriod = (label: string, startDate: string, endDate: string): ComparisonPeriodData => ({
    label,
    startDate,
    endDate,
    totals: createEmptyTotals(),
    channelTotals: createEmptyTotals(),
    videoRows: [],
    contentTypeRows: [],
    hasData: false
  });

  return {
    schemaReady: false,
    channels: [],
    filters,
    primary: emptyPeriod("Range 1", filters.primaryStartDate, filters.primaryEndDate),
    comparison: emptyPeriod("Range 2", filters.comparisonStartDate, filters.comparisonEndDate),
    deltas: {
      views: buildComparisonDelta(0, 0),
      watchTime: buildComparisonDelta(0, 0),
      subscribers: buildComparisonDelta(0, 0),
      revenue: buildComparisonDelta(0, 0)
    },
    availableContentTypes: ["short", "long"],
    contentTypeComparison: [],
    topViewedRangeOneVideos: [],
    topViewedRangeTwoVideos: [],
    topRevenueRangeOneVideos: [],
    topRevenueRangeTwoVideos: [],
    latestSync: null
  };
}

function resolveSelectedChannelId(channelId: string, channels: ManagedChannel[]) {
  if (channels.some((channel) => channel.channelId === channelId)) return channelId;
  if (channels.some((channel) => channel.channelId === DEFAULT_YOUTUBE_CHANNEL_ID)) {
    return DEFAULT_YOUTUBE_CHANNEL_ID;
  }
  return channels[0]?.channelId ?? "";
}

function filterChannelsForAccess(channels: ManagedChannel[], access: ChannelAccess | undefined) {
  if (!access || access.channelIds === null) {
    return channels;
  }

  const allowedChannelIds = new Set(access.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}

function shouldUseVideoScope(filters: YoutubePerformanceFilters) {
  return filters.contentType !== "all" || filters.cohort !== "all";
}

function isValidMonth(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function isValidReportDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
