import type { ChannelPulseAccount } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase";
import {
  fetchChannelVideosPublishedBetween,
  getYouTubeCmsConfig,
  isYouTubeCmsConfigured,
  refreshYouTubeAccessToken,
  type YouTubeVideoMetadata
} from "@/lib/youtube-cms-api";
import { ensureYoutubeAnalyticsRangeData } from "@/lib/youtube-auto-sync";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { syncYoutubeCmsAnalytics, syncYoutubeDailyVideoMetricsForVideos } from "@/lib/youtube-performance-sync";
import { normalizeReportDate } from "@/lib/youtube-performance-utils";

type LoginSyncChannel = {
  channelId: string;
};

const inFlightLoginSyncs = new Map<string, Promise<void>>();
const CHECK_PAGE_SIZE = 1000;
const RECENT_REVENUE_REFRESH_COMPLETE_DAYS = 7;
const TODAY_DAILY_METRICS_CONCURRENCY = 2;
const ZERO_REVENUE_SYNC_CONCURRENCY = 2;

export async function runLoginYoutubeSync(account: ChannelPulseAccount) {
  if (!isYouTubeCmsConfigured()) {
    return;
  }

  const channels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  if (channels.length === 0) {
    return;
  }

  const { endDate, startDate } = getLoginSyncDateRange();
  const key = `${startDate}|${endDate}|${channels.map((channel) => channel.channelId).sort().join(",")}`;
  const existingSync = inFlightLoginSyncs.get(key);
  if (existingSync) {
    await existingSync;
    return;
  }

  const syncPromise = (async () => {
    await ensureYoutubeAnalyticsRangeData({
      channels,
      endDate,
      startDate
    });
    await syncRecentZeroRevenueRanges(channels);
    await syncTodayDailyVideoMetrics(channels);
  })()
    .then(() => undefined)
    .catch((error) => {
      console.error("Login YouTube sync failed.", error);
    })
    .finally(() => {
      inFlightLoginSyncs.delete(key);
    });

  inFlightLoginSyncs.set(key, syncPromise);
  await syncPromise;
}

export function getLoginSyncDateRange(now = new Date()) {
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), 1));

  return {
    startDate: normalizeReportDate(start),
    endDate: normalizeReportDate(yesterday)
  };
}

export function getLoginRevenueRefreshDateRange(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - 1);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - RECENT_REVENUE_REFRESH_COMPLETE_DAYS + 1);

  return {
    startDate: normalizeReportDate(start),
    endDate: normalizeReportDate(end)
  };
}

export function getLoginTodayDate(now = new Date()) {
  return normalizeReportDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

async function syncTodayDailyVideoMetrics(channels: LoginSyncChannel[]) {
  const channelIds = Array.from(new Set(channels.map((channel) => channel.channelId).filter(Boolean)));
  if (channelIds.length === 0) return;

  const config = getYouTubeCmsConfig();
  const accessToken = await refreshYouTubeAccessToken(config);
  const today = getLoginTodayDate();
  const tomorrow = addDays(today, 1);

  await mapWithConcurrency(channelIds, TODAY_DAILY_METRICS_CONCURRENCY, async (channelId) => {
    try {
      const videos = await fetchChannelVideosPublishedBetween({
        accessToken,
        channelId,
        endDate: tomorrow,
        startDate: today
      });
      const channelVideos = videos.filter((video) => video.channelId === channelId);
      if (channelVideos.length === 0) return;

      await upsertVideoCatalog(channelVideos);
      await syncYoutubeDailyVideoMetricsForVideos({
        channelId,
        date: today,
        videoIds: channelVideos.map((video) => video.videoId)
      });
    } catch (error) {
      console.error(`Login today daily metrics sync failed for ${channelId}.`, error);
    }
  });
}

async function upsertVideoCatalog(metadata: YouTubeVideoMetadata[]) {
  const supabase = createSupabaseAdminClient();
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

  for (const rowsChunk of chunk(rows, 500)) {
    if (rowsChunk.length === 0) continue;

    const { error } = await supabase.from("youtube_video_catalog").upsert(rowsChunk, {
      onConflict: "video_id"
    });

    if (error) throw error;
  }
}

async function syncRecentZeroRevenueRanges(channels: LoginSyncChannel[]) {
  const channelIds = Array.from(new Set(channels.map((channel) => channel.channelId).filter(Boolean)));
  if (channelIds.length === 0) return;

  const { endDate, startDate } = getLoginRevenueRefreshDateRange();
  const ranges = await getZeroRevenueChannelRanges(channelIds, startDate, endDate);
  if (ranges.length === 0) return;

  await mapWithConcurrency(ranges, ZERO_REVENUE_SYNC_CONCURRENCY, async (range) => {
    try {
      await syncYoutubeCmsAnalytics({
        channelId: range.channelId,
        endDate: range.endDate,
        startDate: range.startDate,
        syncType: "daily"
      });
    } catch (error) {
      console.error(
        `Login revenue refresh failed for ${range.channelId} from ${range.startDate} to ${range.endDate}.`,
        error
      );
    }
  });
}

async function getZeroRevenueChannelRanges(channelIds: string[], startDate: string, endDate: string) {
  const supabase = createSupabaseAdminClient();
  const pendingDaysByChannelId = new Map(channelIds.map((channelId) => [channelId, [] as string[]]));
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("youtube_channel_daily_metrics")
      .select("channel_id,day,views,estimated_revenue,monetized_playbacks,ad_impressions")
      .in("channel_id", channelIds)
      .gte("day", startDate)
      .lte("day", endDate)
      .order("channel_id", { ascending: true })
      .order("day", { ascending: true })
      .range(offset, offset + CHECK_PAGE_SIZE - 1);

    if (error) throw error;

    for (const row of (data ?? []) as Array<{
      ad_impressions: number | string | null;
      channel_id: string;
      day: string;
      estimated_revenue: number | string | null;
      monetized_playbacks: number | string | null;
      views: number | string | null;
    }>) {
      if (!hasActivityWithZeroRevenue(row)) continue;
      pendingDaysByChannelId.get(row.channel_id)?.push(row.day);
    }

    if (!data || data.length < CHECK_PAGE_SIZE) break;
    offset += CHECK_PAGE_SIZE;
  }

  return Array.from(pendingDaysByChannelId.entries()).flatMap(([channelId, days]) =>
    groupConsecutiveDays(channelId, days)
  );
}

function hasActivityWithZeroRevenue(row: {
  ad_impressions: number | string | null;
  estimated_revenue: number | string | null;
  monetized_playbacks: number | string | null;
  views: number | string | null;
}) {
  return (
    isZero(row.estimated_revenue) &&
    (toNumber(row.views) > 0 || toNumber(row.monetized_playbacks) > 0 || toNumber(row.ad_impressions) > 0)
  );
}

function groupConsecutiveDays(channelId: string, days: string[]) {
  const sortedDays = Array.from(new Set(days)).sort();
  const ranges: Array<{ channelId: string; endDate: string; startDate: string }> = [];
  let startDate = "";
  let previousDate = "";

  for (const day of sortedDays) {
    if (!startDate) {
      startDate = day;
      previousDate = day;
      continue;
    }

    if (day === addDays(previousDate, 1)) {
      previousDate = day;
      continue;
    }

    ranges.push({ channelId, endDate: previousDate, startDate });
    startDate = day;
    previousDate = day;
  }

  if (startDate) {
    ranges.push({ channelId, endDate: previousDate, startDate });
  }

  return ranges;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, callback: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    await Promise.all(batch.map(callback));
  }
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isZero(value: number | string | null | undefined) {
  return Math.abs(toNumber(value)) < 0.000001;
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function filterChannelsForAccount<T extends LoginSyncChannel>(channels: T[], account: ChannelPulseAccount) {
  if (account.channelIds === null) return channels;

  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}
