import { retryBackgroundDatabase } from "@/lib/background-retry";
import { createDatabaseAdminClient } from "@/lib/database";
import { buildDailyStatusData, getDailyStatusWindow, loadRecentVideoStatus, type DailyStatusChannel, type DailyStatusData, type DailyStatusSection, type DailyStatusStoredRow, type RecentVideoMetrics } from "@/lib/daily-status";
import { DAILY_STATUS_CACHE_VERSION, DAILY_STATUS_RESULTS_TABLE, loadCachedRecentVideoStatus, type RecentVideoCacheRow } from "@/lib/daily-status-cache";
import { fetchAnalyticsReport, fetchChannelVideosPublishedBetween, fetchManagedYouTubeChannels, getYouTubeCmsConfig,
  refreshYouTubeAccessToken, withYouTubeContentOwner, type YouTubeApiConfig, type YouTubeVideoMetadata } from "@/lib/youtube-cms-api";
import { getYouTubeDirectConfig, isDirectYoutubeChannel } from "@/lib/youtube-channel-sources";

const inFlight = new Map<string, Promise<DailyStatusData>>();
const recentInFlight = new Map<string, Promise<DailyStatusSection<RecentVideoMetrics>>>();
export type DailyStatusRecentFetcher = (date: string, channel: DailyStatusChannel) => Promise<DailyStatusSection<RecentVideoMetrics>>;
type DailyStatusInput = { date: string; channels: DailyStatusChannel[]; canViewRevenue: boolean; forceRefresh?: boolean; strictStorageReads?: boolean; recentFetcher?: DailyStatusRecentFetcher };

export function getDailyStatusData(input: DailyStatusInput) {
  const key = JSON.stringify([input.date, input.channels.map((channel) => [channel.channelId, channel.title]).sort(), input.canViewRevenue, !!input.forceRefresh, !!input.strictStorageReads]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const request = loadData(input).finally(() => { inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}

async function loadData(input: DailyStatusInput) {
  const savedRows = loadSavedRecentRows(input).catch((error) => { if (input.strictStorageReads) throw error; return [] as RecentVideoCacheRow[]; });
  if (input.strictStorageReads) await savedRows;
  const fetchRecent = input.recentFetcher ?? createDailyStatusYoutubeFetcher();
  return buildDailyStatusData({
    ...input,
    dailyRows: () => loadStoredDailyRows(input),
    recent: async (channel) => {
      const cached = (await savedRows).find((row) => row.channel_id === channel.channelId);
      return loadCachedRecentVideoStatus({
        channelId: channel.channelId, date: input.date, cached, forceRefresh: input.forceRefresh, storedOnly: true,
        fetch: () => {
          const key = JSON.stringify([channel.channelId, input.date, DAILY_STATUS_CACHE_VERSION]);
          const existing = recentInFlight.get(key);
          if (existing) return existing;
          const request = fetchRecent(input.date, channel).finally(() => { recentInFlight.delete(key); });
          recentInFlight.set(key, request);
          return request;
        },
        save: saveRecentRow
      });
    }
  });
}

// A background run shares one upload scan per channel across all ten reporting days.
export function createDailyStatusYoutubeFetcher(catalogWindow?: ReturnType<typeof getDailyStatusWindow>, onError?: (stage: string, error: unknown) => void, signal?: AbortSignal): DailyStatusRecentFetcher {
  const catalogs = new Map<string, Promise<YouTubeVideoMetadata[]>>();
  const tokens = new Map<string, { promise: Promise<string>; startedAt: number }>();
  const token = (config: YouTubeApiConfig) => {
    const previous = tokens.get(config.refreshToken);
    if (previous && Date.now() - previous.startedAt < 45 * 60_000) return previous.promise;
    const promise = refreshYouTubeAccessToken(config).catch((error) => { tokens.delete(config.refreshToken); throw error; });
    tokens.set(config.refreshToken, { promise, startedAt: Date.now() });
    return promise;
  };
  let cmsContext: Promise<{ accessToken: string; configByChannel: Map<string, YouTubeApiConfig> }> | undefined;
  const getCmsContext = () => cmsContext ??= (async () => {
    const config = getYouTubeCmsConfig();
    const accessToken = await token(config);
    const configByChannel = new Map<string, YouTubeApiConfig>();
    for (const ownerId of config.contentOwnerIds) {
      const channels = await fetchManagedYouTubeChannels(accessToken, ownerId);
      for (const channel of channels) configByChannel.set(channel.channelId, withYouTubeContentOwner(config, ownerId));
    }
    return { accessToken, configByChannel };
  })().catch((error) => { cmsContext = undefined; throw error; });
  return async (date, channel) => {
      signal?.throwIfAborted();
      let config: YouTubeApiConfig;
      let accessToken: string;
      if (isDirectYoutubeChannel(channel.channelId)) {
        config = getYouTubeDirectConfig(channel.channelId);
        accessToken = await token(config);
      } else {
        const cms = await getCmsContext();
        const selectedConfig = cms.configByChannel.get(channel.channelId);
        if (!selectedConfig) throw new Error("Channel was not found in the configured CMS accounts.");
        config = selectedConfig;
        accessToken = await token(config);
      }
      const requestReport = async (metrics: string[], videoIds?: string[]) => {
        signal?.throwIfAborted();
        const filters = videoIds ? `video==${videoIds.join(",")}` : config.sourceType === "cms" ? `channel==${channel.channelId}` : "";
        try {
          return (await retryBackgroundDatabase(() => fetchAnalyticsReport(accessToken, config, {
            startDate: date, endDate: date, dimensions: ["day"], metrics, filters, sort: ["day"], maxResults: 200, paginate: true
          }), { attempts: 3 })).rows;
        } catch (error) { onError?.(`${date} ${channel.channelId} ${metrics.includes("estimatedRevenue") ? "revenue" : "activity"}`, error); throw error; }
      };
      return loadRecentVideoStatus({
        date, channelId: channel.channelId,
        catalog: (window) => {
          const range = catalogWindow ?? window;
          const key = JSON.stringify([channel.channelId, range.startDateTime, range.endDateTime]);
          let request = catalogs.get(key);
          if (!request) {
            request = fetchChannelVideosPublishedBetween({
              accessToken, channelId: channel.channelId, startDate: range.startDate, endDate: range.endDate,
              startDateTime: range.startDateTime, endDateTime: range.endDateTime, requireCompleteCatalog: true, signal
            }).catch((error) => { catalogs.delete(key); onError?.(`${channel.channelId} upload catalog`, error); throw error; });
            catalogs.set(key, request);
          }
          return request;
        },
        report: (videoIds) => requestReport(["views", "estimatedMinutesWatched"], videoIds),
        revenueReport: (videoIds) => requestReport(["estimatedRevenue"], videoIds)
      });
  };
}

async function loadSavedRecentRows(input: DailyStatusInput): Promise<RecentVideoCacheRow[]> {
  const db = createDatabaseAdminClient();
  const window = getDailyStatusWindow(input.date);
  const rows: RecentVideoCacheRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(DAILY_STATUS_RESULTS_TABLE)
      .select("channel_id,day,publication_start_date,publication_end_date,algorithm_version,views,watch_hours,video_count,fetched_at,estimated_revenue,revenue_fetched_at")
      .in("channel_id", input.channels.map((channel) => channel.channelId)).eq("day", input.date)
      .eq("publication_start_date", window.startDate).eq("publication_end_date", window.endDate)
      .eq("algorithm_version", DAILY_STATUS_CACHE_VERSION)
      .order("channel_id", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as RecentVideoCacheRow[]));
    if (!data || data.length < 1000) return rows;
  }
}

async function saveRecentRow(row: RecentVideoCacheRow) {
  const { error } = await createDatabaseAdminClient().from(DAILY_STATUS_RESULTS_TABLE)
    .upsert([row], { onConflict: "channel_id,day,publication_start_date,publication_end_date,algorithm_version" });
  if (error) throw error;
}

async function loadStoredDailyRows(input: { date: string; channels: DailyStatusChannel[]; canViewRevenue: boolean }) {
  const db = createDatabaseAdminClient();
  const rows: DailyStatusStoredRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("youtube_channel_daily_metrics")
      .select(`channel_id,day,views,estimated_minutes_watched,subscribers_gained,subscribers_lost${input.canViewRevenue ? ",estimated_revenue" : ""}`)
      .in("channel_id", input.channels.map((channel) => channel.channelId)).eq("day", input.date)
      .order("channel_id", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as DailyStatusStoredRow[]));
    if (!data || data.length < 1000) return rows;
  }
}

// Reuse authentication and one complete publication scan while a range is filled day by day.
const rangeFetchers = new Map<string, { expiresAt: number; fetch: DailyStatusRecentFetcher }>();
export function getRangeRecentFetcher(startDate: string, endDate: string): DailyStatusRecentFetcher {
  const now = Date.now();
  for (const [key, entry] of rangeFetchers) if (entry.expiresAt <= now) rangeFetchers.delete(key);
  const key = `${startDate}:${endDate}`;
  const existing = rangeFetchers.get(key);
  if (existing) return existing.fetch;
  const start = getDailyStatusWindow(startDate);
  const end = getDailyStatusWindow(endDate);
  const fetch = createDailyStatusYoutubeFetcher({ ...start, endDate: end.endDate, endDateTime: end.endDateTime });
  if (rangeFetchers.size >= 8) rangeFetchers.delete(rangeFetchers.keys().next().value!);
  rangeFetchers.set(key, { expiresAt: now + 10 * 60_000, fetch });
  return fetch;
}
