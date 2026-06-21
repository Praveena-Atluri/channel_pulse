import { createSupabaseAdminClient } from "@/lib/supabase";
import { upsertYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import {
  fetchAnalyticsReportWithFallback,
  fetchChannelVideosPublishedBetween,
  fetchManagedYouTubeChannels,
  fetchYouTubeVideos,
  getYouTubeCmsConfig,
  refreshYouTubeAccessToken,
  withYouTubeContentOwner,
  type AnalyticsReportResult,
  type AnalyticsReportRow,
  type YouTubeChannelMetadata,
  type YouTubeVideoMetadata,
} from "@/lib/youtube-cms-api";
import {
  normalizeAnalyticsContentType,
  getRecentVideoWindow,
  normalizeReportDate,
  type MetricTotals,
  type VideoContentType
} from "@/lib/youtube-performance-utils";

const CHANNEL_CORE_METRIC_SETS = [
  ["views", "estimatedMinutesWatched", "subscribersGained", "subscribersLost"],
  ["views", "estimatedMinutesWatched"]
];

const REVENUE_METRIC_SETS = [
  [
    "estimatedRevenue",
    "estimatedAdRevenue",
    "grossRevenue",
    "monetizedPlaybacks",
    "adImpressions",
    "playbackBasedCpm"
  ],
  ["estimatedRevenue", "estimatedAdRevenue", "grossRevenue", "monetizedPlaybacks", "playbackBasedCpm"],
  ["estimatedRevenue", "estimatedAdRevenue", "grossRevenue", "monetizedPlaybacks"],
  ["estimatedRevenue", "estimatedAdRevenue"],
  ["estimatedRevenue"]
];

const CTR_METRIC_SETS = [["impressionsClickThroughRate"], ["impressionClickThroughRate"]];

const CONTENT_TYPE_METRIC_SETS = [
  ["views", "estimatedMinutesWatched", "estimatedRevenue", "estimatedAdRevenue", "grossRevenue", "monetizedPlaybacks"],
  ["views", "estimatedMinutesWatched", "estimatedRevenue"],
  ["views", "estimatedMinutesWatched"],
  ["views"]
];

const COUNTRY_METRIC_SETS = [
  [
    "views",
    "estimatedMinutesWatched",
    "estimatedRevenue",
    "estimatedAdRevenue",
    "grossRevenue",
    "monetizedPlaybacks",
    "adImpressions",
    "playbackBasedCpm"
  ],
  ["views", "estimatedMinutesWatched", "estimatedRevenue", "estimatedAdRevenue", "grossRevenue", "monetizedPlaybacks"],
  ["views", "estimatedMinutesWatched", "estimatedRevenue"],
  ["views", "estimatedRevenue"],
  ["estimatedRevenue"],
  ["views", "estimatedMinutesWatched"],
  ["views"]
];

const VIDEO_METRIC_SETS = [
  [
    "views",
    "estimatedMinutesWatched",
    "estimatedRevenue",
    "estimatedAdRevenue",
    "grossRevenue",
    "monetizedPlaybacks",
    "adImpressions",
    "playbackBasedCpm"
  ],
  ["views", "estimatedMinutesWatched", "estimatedRevenue", "estimatedAdRevenue", "grossRevenue", "monetizedPlaybacks"],
  ["views", "estimatedMinutesWatched", "estimatedRevenue"],
  ["views", "estimatedMinutesWatched"],
  ["views"]
];

type SyncInput = {
  channelId?: string;
  startDate: string;
  endDate: string;
  syncType?: "daily" | "manual" | "backfill";
};

type DailyMetricAccumulator = Partial<MetricTotals> & {
  day: string;
  channelId: string;
  videoId?: string;
  contentType?: VideoContentType;
  countryCode?: string;
  impressionsClickThroughRate?: number;
};

type SyncRunRecord = {
  id: string;
};

export async function syncYoutubeCmsAnalytics(input: SyncInput) {
  if (!input.channelId || input.channelId === "all") {
    throw new Error("Select one channel before running YouTube sync.");
  }

  const supabase = createSupabaseAdminClient();
  const startedAt = new Date().toISOString();
  let syncRun: SyncRunRecord | null = null;

  const syncInsert = await supabase
    .from("youtube_analytics_sync_runs")
    .insert({
      sync_type: input.syncType ?? "daily",
      status: "running",
      start_date: input.startDate,
      end_date: input.endDate,
      started_at: startedAt
    })
    .select("id")
    .single();

  if (syncInsert.error) {
    throw syncInsert.error;
  }

  syncRun = syncInsert.data as SyncRunRecord;

  try {
    const config = getYouTubeCmsConfig();
    const accessToken = await refreshYouTubeAccessToken(config);
    const warnings: string[] = [];
    const channelCatalogs = await fetchManagedChannelsByContentOwner(accessToken, config.contentOwnerIds);
    const allChannelMetadata = uniqueChannels(channelCatalogs.flatMap((catalog) => catalog.channels));
    const selectedCatalog = channelCatalogs.find((catalog) =>
      catalog.channels.some((channel) => channel.channelId === input.channelId)
    );
    const channelMetadata = selectedCatalog?.channels.filter((channel) => channel.channelId === input.channelId) ?? [];
    const channelIds = channelMetadata.map((channel) => channel.channelId);
    const selectedConfig = selectedCatalog ? withYouTubeContentOwner(config, selectedCatalog.contentOwnerId) : config;
    let channelMetrics: DailyMetricAccumulator[] = [];
    const contentTypeMetrics: DailyMetricAccumulator[] = [];
    const countryMetrics: DailyMetricAccumulator[] = [];
    const videoMetrics: DailyMetricAccumulator[] = [];
    const videoMetadataById = new Map<string, YouTubeVideoMetadata>();

    await upsertYoutubeManagedChannels(supabase, allChannelMetadata);

    if (input.channelId && input.channelId !== "all" && channelIds.length === 0) {
      throw new Error("Selected channel was not found in this CMS account.");
    }

    const channelReportGroups = await mapWithConcurrency(channelIds, 8, async (channelId) =>
      fetchChannelReports({
        accessToken,
        channelId,
        config: selectedConfig,
        endDate: input.endDate,
        startDate: input.startDate,
        warnings
      })
    );

    for (const group of channelReportGroups) {
      channelMetrics.push(...group.channelMetrics);
      contentTypeMetrics.push(...group.contentTypeMetrics);
      countryMetrics.push(...group.countryMetrics);
      videoMetrics.push(...group.videoMetrics);
      for (const video of group.videoMetadata) {
        videoMetadataById.set(video.videoId, video);
      }
    }

    if (channelMetrics.length === 0) {
      const detail = warnings.length > 0 ? ` ${warnings.join("\n")}` : "";
      throw new Error(
        `YouTube did not return channel metrics for ${input.channelId} from ${input.startDate} to ${input.endDate}.${detail}`
      );
    }
    const videoIds = unique(videoMetrics.map((row) => row.videoId).filter(Boolean) as string[]);
    const missingMetadataIds = videoIds.filter((videoId) => !videoMetadataById.has(videoId));
    const fetchedVideoMetadata = await fetchMetadataSafely(() => fetchYouTubeVideos(accessToken, missingMetadataIds), warnings);
    for (const video of fetchedVideoMetadata) {
      videoMetadataById.set(video.videoId, video);
    }

    const analyticsContentTypeByVideoId = getAnalyticsContentTypeByVideoId(videoMetrics);
    const videoMetadata = Array.from(videoMetadataById.values()).map((video) => ({
      ...video,
      contentType: analyticsContentTypeByVideoId.get(video.videoId) ?? video.contentType
    }));
    const metadataVideoIds = new Set(videoMetadataById.keys());
    const videoMetricsWithCatalog = videoMetrics.filter((row) => row.videoId && metadataVideoIds.has(row.videoId));

    if (videoMetrics.length > videoMetricsWithCatalog.length) {
      warnings.push(
        `${videoMetrics.length - videoMetricsWithCatalog.length} video metric row(s) were skipped because video metadata was unavailable.`
      );
    }

    await upsertChannelMetrics(supabase, channelMetrics);
    await upsertVideoCatalog(supabase, videoMetadata);
    await upsertVideoMetrics(supabase, videoMetricsWithCatalog);
    await upsertContentTypeMetrics(supabase, contentTypeMetrics);
    let countryMetricRowsSynced = countryMetrics.length;
    try {
      await upsertCountryMetrics(supabase, countryMetrics);
    } catch (error) {
      countryMetricRowsSynced = 0;
      warnings.push(
        error instanceof Error
          ? `Country revenue metrics were not stored: ${error.message}`
          : "Country revenue metrics were not stored."
      );
    }

    const finishedAt = new Date().toISOString();
    const metricsRowsSynced =
      channelMetrics.length + videoMetricsWithCatalog.length + contentTypeMetrics.length + countryMetricRowsSynced;
    const update = await supabase
      .from("youtube_analytics_sync_runs")
      .update({
        status: "success",
        finished_at: finishedAt,
        channels_synced: channelIds.length,
        videos_synced: metadataVideoIds.size,
        metrics_rows_synced: metricsRowsSynced,
        metadata: {
          warnings,
          channelCount: channelIds.length,
          channelIds
        }
      })
      .eq("id", syncRun.id);

    if (update.error) throw update.error;

    return {
      status: "success",
      channelsSynced: channelIds.length,
      videosSynced: metadataVideoIds.size,
      metricsRowsSynced,
      warnings
    };
  } catch (error) {
    const message = getErrorMessage(error);

    if (syncRun) {
      await supabase
        .from("youtube_analytics_sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message,
          metadata: {
            channelId: input.channelId
          }
        })
        .eq("id", syncRun.id);
    }

    throw error;
  }
}

async function fetchManagedChannelsByContentOwner(accessToken: string, contentOwnerIds: string[]) {
  return Promise.all(
    contentOwnerIds.map(async (contentOwnerId) => ({
      contentOwnerId,
      channels: await fetchManagedYouTubeChannels(accessToken, contentOwnerId)
    }))
  );
}

function uniqueChannels(channels: YouTubeChannelMetadata[]) {
  const channelsById = new Map<string, YouTubeChannelMetadata>();
  for (const channel of channels) {
    channelsById.set(channel.channelId, channel);
  }

  return Array.from(channelsById.values());
}

function mergeReports(dimensions: string[], ...reports: AnalyticsReportResult[]) {
  return mergeReportRows(dimensions, reports);
}

function mergeReportRows(
  dimensions: string[],
  reports: AnalyticsReportResult[],
  options: { defaultDay?: string; channelId?: string } = {}
) {
  const map = new Map<string, DailyMetricAccumulator>();

  for (const report of reports) {
    for (const row of rowsFromReport(dimensions, report, options)) {
      const key = dimensions
        .map((dimension) => {
          if (dimension === "channel") return row.channelId;
          if (dimension === "video") return row.videoId ?? "";
          if (dimension === "creatorContentType") return row.contentType ?? "unknown";
          if (dimension === "country") return row.countryCode ?? "ZZ";
          return row.day;
        })
        .join("|");
      const existing = map.get(key) ?? {
        day: row.day,
        channelId: row.channelId,
        videoId: row.videoId,
        contentType: row.contentType
      };

      Object.assign(existing, row);
      map.set(key, existing);
    }
  }

  return Array.from(map.values());
}

function rowsFromReport(
  dimensions: string[],
  report: AnalyticsReportResult,
  options: { defaultDay?: string; channelId?: string } = {}
): DailyMetricAccumulator[] {
  const metrics = new Set(report.metrics);

  return report.rows.map((row) => {
    const accumulator: DailyMetricAccumulator = {
      day: dimensions.includes("day") ? String(row.day) : options.defaultDay ?? "",
      channelId: row.channel ? String(row.channel) : options.channelId ?? ""
    };

    if (dimensions.includes("video")) {
      accumulator.videoId = String(row.video);
    }

    if (dimensions.includes("creatorContentType")) {
      accumulator.contentType = normalizeAnalyticsContentType(String(row.creatorContentType ?? ""));
    }

    if (dimensions.includes("country")) {
      accumulator.countryCode = normalizeCountryCode(row.country);
    }

    if (metrics.has("views")) accumulator.views = readNumber(row, "views");
    if (metrics.has("estimatedMinutesWatched")) {
      accumulator.estimatedMinutesWatched = readNumber(row, "estimatedMinutesWatched");
    }
    if (metrics.has("subscribersGained")) accumulator.subscribersGained = readNumber(row, "subscribersGained");
    if (metrics.has("subscribersLost")) accumulator.subscribersLost = readNumber(row, "subscribersLost");
    if (metrics.has("estimatedRevenue")) accumulator.estimatedRevenue = readNumber(row, "estimatedRevenue");
    if (metrics.has("estimatedAdRevenue")) accumulator.estimatedAdRevenue = readNumber(row, "estimatedAdRevenue");
    if (metrics.has("grossRevenue")) accumulator.grossRevenue = readNumber(row, "grossRevenue");
    if (metrics.has("monetizedPlaybacks")) accumulator.monetizedPlaybacks = readNumber(row, "monetizedPlaybacks");
    if (metrics.has("adImpressions")) accumulator.adImpressions = readNumber(row, "adImpressions");
    if (metrics.has("playbackBasedCpm")) accumulator.playbackBasedCpm = readNumber(row, "playbackBasedCpm");
    if (metrics.has("impressionsClickThroughRate")) {
      accumulator.impressionsClickThroughRate = readNumber(row, "impressionsClickThroughRate");
    }
    if (metrics.has("impressionClickThroughRate")) {
      accumulator.impressionsClickThroughRate = readNumber(row, "impressionClickThroughRate");
    }

    return accumulator;
  });
}

async function fetchMetadataSafely<T>(callback: () => Promise<T[]>, warnings: string[]) {
  try {
    return await callback();
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Metadata fetch failed.");
    return [];
  }
}

async function fetchOptionalReport(
  callback: () => Promise<AnalyticsReportResult>,
  label: string,
  warnings: string[]
): Promise<AnalyticsReportResult> {
  try {
    return await callback();
  } catch (error) {
    warnings.push(error instanceof Error ? `${label} report skipped: ${error.message}` : `${label} report skipped.`);
    return { rows: [], metrics: [] };
  }
}

function withChannelId(rows: DailyMetricAccumulator[], channelId: string) {
  return rows.map((row) => ({ ...row, channelId }));
}

async function fetchChannelReports(input: {
  accessToken: string;
  channelId: string;
  config: ReturnType<typeof getYouTubeCmsConfig>;
  endDate: string;
  startDate: string;
  warnings: string[];
}) {
  const channelFilter = `channel==${input.channelId}`;

  try {
    const [channelCore, channelRevenue, channelCtr, contentTypeReport, countryReportGroup, videoReportGroup] = await Promise.all([
      fetchAnalyticsReportWithFallback({
        accessToken: input.accessToken,
        config: input.config,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: ["day"],
        metricSets: CHANNEL_CORE_METRIC_SETS,
        filters: channelFilter,
        sort: ["day"]
      }),
      fetchOptionalReport(
        () =>
          fetchAnalyticsReportWithFallback({
            accessToken: input.accessToken,
            config: input.config,
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: ["day"],
            metricSets: REVENUE_METRIC_SETS,
            filters: channelFilter,
            sort: ["day"]
          }),
        `${input.channelId} revenue`,
        input.warnings
      ),
      fetchOptionalReport(
        () =>
          fetchAnalyticsReportWithFallback({
            accessToken: input.accessToken,
            config: input.config,
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: ["day"],
            metricSets: CTR_METRIC_SETS,
            filters: channelFilter,
            sort: ["day"]
          }),
        `${input.channelId} CTR`,
        input.warnings
      ),
      fetchOptionalReport(
        () =>
          fetchAnalyticsReportWithFallback({
            accessToken: input.accessToken,
            config: input.config,
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: ["day", "creatorContentType"],
            metricSets: CONTENT_TYPE_METRIC_SETS,
            filters: channelFilter,
            sort: ["day"]
          }),
        `${input.channelId} creatorContentType`,
        input.warnings
      ),
      fetchCountryPeriodReports({
        accessToken: input.accessToken,
        channelId: input.channelId,
        config: input.config,
        periods: getVideoMetricPeriods(input.startDate, input.endDate),
        warnings: input.warnings
      }),
      fetchVideoPeriodReports({
        accessToken: input.accessToken,
        channelId: input.channelId,
        config: input.config,
        periods: getVideoMetricPeriods(input.startDate, input.endDate),
        warnings: input.warnings
      })
    ]);

    return {
      channelMetrics: withChannelId(mergeReports(["day"], channelCore, channelRevenue, channelCtr), input.channelId),
      contentTypeMetrics: withChannelId(
        rowsFromReport(["day", "creatorContentType"], contentTypeReport),
        input.channelId
      ),
      countryMetrics: countryReportGroup.metrics,
      videoMetrics: videoReportGroup.metrics,
      videoMetadata: videoReportGroup.metadata
    };
  } catch (error) {
    input.warnings.push(
      error instanceof Error
        ? `${input.channelId} core metrics skipped: ${error.message}`
        : `${input.channelId} core metrics skipped.`
    );
    return { channelMetrics: [], contentTypeMetrics: [], countryMetrics: [], videoMetrics: [], videoMetadata: [] };
  }
}

async function fetchCountryPeriodReports(input: {
  accessToken: string;
  channelId: string;
  config: ReturnType<typeof getYouTubeCmsConfig>;
  periods: Array<{ startDate: string; endDate: string }>;
  warnings: string[];
}) {
  const periodRows = await mapWithConcurrency(input.periods, 2, async (period) => {
    const countryReport = await fetchOptionalReport(
      () =>
        fetchAnalyticsReportWithFallback({
          accessToken: input.accessToken,
          config: input.config,
          startDate: period.startDate,
          endDate: period.endDate,
          dimensions: ["country"],
          metricSets: COUNTRY_METRIC_SETS,
          filters: `channel==${input.channelId}`,
          sort: ["-estimatedRevenue"]
        }),
      `${input.channelId} country ${period.startDate} to ${period.endDate}`,
      input.warnings
    );

    return rowsFromReport(["country"], countryReport, {
      defaultDay: period.startDate,
      channelId: input.channelId
    });
  });

  return { metrics: periodRows.flat() };
}

async function fetchVideoPeriodReports(input: {
  accessToken: string;
  channelId: string;
  config: ReturnType<typeof getYouTubeCmsConfig>;
  periods: Array<{ startDate: string; endDate: string }>;
  warnings: string[];
}) {
  const periodRows = await mapWithConcurrency(input.periods, 2, async (period) => {
    const recentWindow = getRecentVideoWindow(period.startDate.slice(0, 7));
    const recentVideoMetadata = await fetchMetadataSafely(
      () =>
        fetchChannelVideosPublishedBetween({
          accessToken: input.accessToken,
          channelId: input.channelId,
          startDate: recentWindow.startDate,
          endDate: recentWindow.endDate
        }),
      input.warnings
    );
    const recentVideoIds = recentVideoMetadata.map((video) => video.videoId);
    const baseInput = {
      accessToken: input.accessToken,
      config: input.config,
      startDate: period.startDate,
      endDate: period.endDate,
      metricSets: VIDEO_METRIC_SETS,
      filters: `channel==${input.channelId}`,
      maxResults: 200,
      paginate: false as const
    };
    const [topViewedReport, topRevenueReport, recentVideoReports] = await Promise.all([
      fetchOptionalReport(
        () =>
          fetchVideoAnalyticsReportWithContentTypeFallback({
            ...baseInput,
            label: `${input.channelId} top viewed videos ${period.startDate} to ${period.endDate}`,
            sort: ["-views"],
            warnings: input.warnings
          }),
        `${input.channelId} top viewed videos ${period.startDate} to ${period.endDate}`,
        input.warnings
      ),
      fetchOptionalReport(
        () =>
          fetchVideoAnalyticsReportWithContentTypeFallback({
            ...baseInput,
            label: `${input.channelId} top revenue videos ${period.startDate} to ${period.endDate}`,
            sort: ["-estimatedRevenue"],
            warnings: input.warnings
          }),
        `${input.channelId} top revenue videos ${period.startDate} to ${period.endDate}`,
        input.warnings
      ),
      fetchVideoIdReports({
        ...baseInput,
        videoIds: recentVideoIds,
        warnings: input.warnings,
        label: `${input.channelId} recent videos ${period.startDate} to ${period.endDate}`
      })
    ]);

    return {
      metrics: mergeReportRows(["video", "creatorContentType"], [topViewedReport, topRevenueReport, ...recentVideoReports], {
        defaultDay: period.startDate,
        channelId: input.channelId
      }),
      metadata: recentVideoMetadata
    };
  });

  return {
    metrics: periodRows.flatMap((period) => period.metrics),
    metadata: periodRows.flatMap((period) => period.metadata)
  };
}

async function fetchVideoIdReports(input: {
  accessToken: string;
  config: ReturnType<typeof getYouTubeCmsConfig>;
  startDate: string;
  endDate: string;
  metricSets: string[][];
  filters: string;
  maxResults: number;
  paginate: false;
  videoIds: string[];
  warnings: string[];
  label: string;
}) {
  const idChunks = chunk(unique(input.videoIds), 100).map((ids, index) => ({ ids, index }));

  return (
    await mapWithConcurrency(idChunks, 3, async ({ ids, index }) =>
      fetchOptionalReport(
        () =>
          fetchVideoAnalyticsReportWithContentTypeFallback({
            accessToken: input.accessToken,
            config: input.config,
            startDate: input.startDate,
            endDate: input.endDate,
            metricSets: input.metricSets,
            filters: `${input.filters};video==${ids.join(",")}`,
            label: `${input.label} chunk ${index + 1}`,
            maxResults: input.maxResults,
            paginate: input.paginate,
            warnings: input.warnings
          }),
        `${input.label} chunk ${index + 1}`,
        input.warnings
      )
    )
  ).filter((report) => report.rows.length > 0);
}

async function fetchVideoAnalyticsReportWithContentTypeFallback(input: {
  accessToken: string;
  config: ReturnType<typeof getYouTubeCmsConfig>;
  startDate: string;
  endDate: string;
  metricSets: string[][];
  filters: string;
  label: string;
  maxResults: number;
  paginate: false;
  sort?: string[];
  warnings: string[];
}) {
  try {
    return await fetchAnalyticsReportWithFallback({
      accessToken: input.accessToken,
      config: input.config,
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: ["video", "creatorContentType"],
      metricSets: input.metricSets,
      filters: input.filters,
      maxResults: input.maxResults,
      paginate: input.paginate,
      sort: input.sort
    });
  } catch (error) {
    input.warnings.push(
      `${input.label} creatorContentType unavailable; falling back to video-only analytics: ${getErrorMessage(error)}`
    );

    return fetchAnalyticsReportWithFallback({
      accessToken: input.accessToken,
      config: input.config,
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: ["video"],
      metricSets: input.metricSets,
      filters: input.filters,
      maxResults: input.maxResults,
      paginate: input.paginate,
      sort: input.sort
    });
  }
}

async function upsertChannelMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  metrics: DailyMetricAccumulator[]
) {
  const updatedAt = new Date().toISOString();
  const coreRows = metrics.map((row) => ({
    day: row.day,
    channel_id: row.channelId,
    views: row.views ?? 0,
    estimated_minutes_watched: row.estimatedMinutesWatched ?? 0,
    subscribers_gained: row.subscribersGained ?? 0,
    subscribers_lost: row.subscribersLost ?? 0,
    updated_at: updatedAt
  }));
  const revenueRows = metrics
    .filter(hasRevenueMetric)
    .map((row) => ({
      day: row.day,
      channel_id: row.channelId,
      estimated_revenue: row.estimatedRevenue ?? 0,
      estimated_ad_revenue: row.estimatedAdRevenue ?? 0,
      gross_revenue: row.grossRevenue ?? 0,
      monetized_playbacks: row.monetizedPlaybacks ?? 0,
      ad_impressions: row.adImpressions ?? 0,
      playback_based_cpm: row.playbackBasedCpm ?? 0,
      updated_at: updatedAt
    }));
  const ctrRows = metrics
    .filter((row) => row.impressionsClickThroughRate !== undefined)
    .map((row) => ({
      day: row.day,
      channel_id: row.channelId,
      impressions_click_through_rate: row.impressionsClickThroughRate ?? null,
      updated_at: updatedAt
    }));

  await upsertInChunks(supabase, "youtube_channel_daily_metrics", coreRows, "day,channel_id");
  await upsertInChunks(supabase, "youtube_channel_daily_metrics", revenueRows, "day,channel_id");
  await upsertInChunks(supabase, "youtube_channel_daily_metrics", ctrRows, "day,channel_id");
}

async function upsertVideoMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  metrics: DailyMetricAccumulator[]
) {
  const rows = metrics
    .filter((row) => row.videoId && row.channelId)
    .map((row) => ({
      day: row.day,
      channel_id: row.channelId,
      video_id: row.videoId,
      views: row.views ?? 0,
      estimated_minutes_watched: row.estimatedMinutesWatched ?? 0,
      estimated_revenue: row.estimatedRevenue ?? 0,
      estimated_ad_revenue: row.estimatedAdRevenue ?? 0,
      gross_revenue: row.grossRevenue ?? 0,
      monetized_playbacks: row.monetizedPlaybacks ?? 0,
      ad_impressions: row.adImpressions ?? 0,
      playback_based_cpm: row.playbackBasedCpm ?? 0,
      updated_at: new Date().toISOString()
    }));

  await upsertInChunks(supabase, "youtube_video_daily_metrics", rows, "day,video_id");
}

function hasRevenueMetric(row: DailyMetricAccumulator) {
  return (
    row.estimatedRevenue !== undefined ||
    row.estimatedAdRevenue !== undefined ||
    row.grossRevenue !== undefined ||
    row.monetizedPlaybacks !== undefined ||
    row.adImpressions !== undefined ||
    row.playbackBasedCpm !== undefined
  );
}

function getAnalyticsContentTypeByVideoId(metrics: DailyMetricAccumulator[]) {
  const contentTypeByVideoId = new Map<string, VideoContentType>();

  for (const row of metrics) {
    if (!row.videoId || !row.contentType || row.contentType === "unknown") continue;
    contentTypeByVideoId.set(row.videoId, row.contentType);
  }

  return contentTypeByVideoId;
}

async function upsertVideoCatalog(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  metadata: YouTubeVideoMetadata[]
) {
  const now = new Date().toISOString();
  const rows = metadata
    .filter((video) => video.videoId && video.channelId)
    .map((video) => ({
      video_id: video.videoId,
      channel_id: video.channelId,
      title: video.title,
      description: video.description,
      thumbnail_url: video.thumbnailUrl,
      published_at: video.publishedAt,
      duration_seconds: video.durationSeconds,
      content_type: video.contentType,
      view_count: video.viewCount,
      last_synced_at: now,
      updated_at: now
    }));

  await upsertInChunks(supabase, "youtube_video_catalog", rows, "video_id");
}

async function upsertContentTypeMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  metrics: DailyMetricAccumulator[]
) {
  const rows = metrics.map((row) => ({
    day: row.day,
    channel_id: row.channelId,
    content_type: row.contentType ?? "unknown",
    views: row.views ?? 0,
    estimated_minutes_watched: row.estimatedMinutesWatched ?? 0,
    estimated_revenue: row.estimatedRevenue ?? 0,
    estimated_ad_revenue: row.estimatedAdRevenue ?? 0,
    gross_revenue: row.grossRevenue ?? 0,
    monetized_playbacks: row.monetizedPlaybacks ?? 0,
    updated_at: new Date().toISOString()
  }));

  await upsertInChunks(supabase, "youtube_content_type_daily_metrics", rows, "day,channel_id,content_type");
}

async function upsertCountryMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  metrics: DailyMetricAccumulator[]
) {
  const rows = metrics
    .filter((row) => row.countryCode && row.channelId)
    .map((row) => ({
      day: row.day,
      channel_id: row.channelId,
      country_code: row.countryCode ?? "ZZ",
      views: row.views ?? 0,
      estimated_minutes_watched: row.estimatedMinutesWatched ?? 0,
      estimated_revenue: row.estimatedRevenue ?? 0,
      estimated_ad_revenue: row.estimatedAdRevenue ?? 0,
      gross_revenue: row.grossRevenue ?? 0,
      monetized_playbacks: row.monetizedPlaybacks ?? 0,
      ad_impressions: row.adImpressions ?? 0,
      playback_based_cpm: row.playbackBasedCpm ?? 0,
      updated_at: new Date().toISOString()
    }));

  await upsertInChunks(supabase, "youtube_country_daily_metrics", rows, "day,channel_id,country_code");
}

async function upsertInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string
) {
  for (const rowsChunk of chunk(dedupeRowsByConflictKey(rows, onConflict), 500)) {
    if (rowsChunk.length === 0) continue;

    const { error } = await supabase.from(table).upsert(rowsChunk, { onConflict });
    if (error) throw error;
  }
}

function dedupeRowsByConflictKey(rows: Array<Record<string, unknown>>, onConflict: string) {
  const keys = onConflict.split(",").map((key) => key.trim());
  const deduped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    deduped.set(keys.map((key) => String(row[key] ?? "")).join("|"), row);
  }

  return Array.from(deduped.values());
}

function readNumber(row: AnalyticsReportRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCountryCode(value: unknown) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "ZZ";
}

function getInclusiveDateKeys(startDate: string, endDate: string) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function parseDateKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown YouTube sync error";
  }
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

function getVideoMetricPeriods(startDate: string, endDate: string) {
  const periods: Array<{ startDate: string; endDate: string }> = [];
  let cursor = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);

  while (cursor.getTime() <= end.getTime()) {
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const periodEnd = new Date(Math.min(end.getTime(), nextMonth.getTime() - 86_400_000));

    periods.push({
      startDate: normalizeReportDate(cursor),
      endDate: normalizeReportDate(periodEnd)
    });

    cursor = new Date(periodEnd.getTime() + 86_400_000);
  }

  return periods;
}

function parseUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>
) {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(callback))));
  }

  return results;
}

export function getDefaultSyncDateRange(now = new Date()) {
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const date = normalizeReportDate(yesterday);
  return { startDate: date, endDate: date };
}
