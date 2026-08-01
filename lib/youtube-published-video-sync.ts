import { createDatabaseAdminClient } from "@/lib/database";
import { getDailyMetricsUtcRange } from "@/lib/daily-metrics";
import {
  fetchChannelVideosPublishedBetween,
  fetchYouTubeShortsPlaylistMemberships,
  getYouTubeCmsConfig,
  refreshYouTubeAccessToken,
  type YouTubeVideoMetadata
} from "@/lib/youtube-cms-api";
import { syncYoutubeCreatorContentTypesForVideos } from "@/lib/youtube-performance-sync";
import type { VideoContentType } from "@/lib/youtube-performance-utils";
import {
  getYouTubeDirectConfig,
  isDirectYoutubeChannel
} from "@/lib/youtube-channel-sources";

type PublishedVideoSyncChannel = {
  channelId: string;
  title?: string | null;
};

const PUBLISHED_VIDEO_SYNC_CONCURRENCY = 4;
const SHORTS_URL_LOOKUP_CONCURRENCY = 8;
const SHORTS_URL_LOOKUP_TIMEOUT_MS = 10_000;
const inFlightPublishedVideoSyncs = new Map<string, Promise<PublishedVideoSyncResult>>();

export type PublishedVideoSyncResult = {
  channelsSynced: number;
  videosSynced: number;
  warnings: string[];
};

export async function syncYoutubePublishedVideosForDate({
  channels,
  date
}: {
  channels: PublishedVideoSyncChannel[];
  date: string;
}): Promise<PublishedVideoSyncResult> {
  const channelIds = Array.from(new Set(channels.map((channel) => channel.channelId).filter(Boolean))).sort();
  const channelLabelById = new Map(
    channels.map((channel) => [channel.channelId, channel.title?.trim() || channel.channelId])
  );
  if (channelIds.length === 0) {
    return { channelsSynced: 0, videosSynced: 0, warnings: [] };
  }

  const key = `${date}|${channelIds.join(",")}`;
  const existingSync = inFlightPublishedVideoSyncs.get(key);
  if (existingSync) return existingSync;

  const syncPromise = syncYoutubePublishedVideosForDateOnce(channelIds, channelLabelById, date).finally(() => {
    inFlightPublishedVideoSyncs.delete(key);
  });
  inFlightPublishedVideoSyncs.set(key, syncPromise);
  return syncPromise;
}

async function syncYoutubePublishedVideosForDateOnce(
  channelIds: string[],
  channelLabelById: Map<string, string>,
  date: string
): Promise<PublishedVideoSyncResult> {
  const dailyRange = getDailyMetricsUtcRange(date);
  const sourceStartDate = addDays(date, -1);
  const sourceEndDate = addDays(date, 1);
  const warnings: string[] = [];
  const accessTokens = new Map<string, Promise<string>>();
  let videosSynced = 0;

  await mapWithConcurrency(channelIds, PUBLISHED_VIDEO_SYNC_CONCURRENCY, async (channelId) => {
    try {
      const isDirect = isDirectYoutubeChannel(channelId);
      const config = isDirect ? getYouTubeDirectConfig(channelId) : getYouTubeCmsConfig();
      const tokenKey = isDirect ? "direct" : "cms";
      const accessTokenPromise = accessTokens.get(tokenKey) ?? refreshYouTubeAccessToken(config);
      accessTokens.set(tokenKey, accessTokenPromise);
      const accessToken = await accessTokenPromise;
      const videos = await fetchChannelVideosPublishedBetween({
        accessToken,
        channelId,
        endDate: sourceEndDate,
        startDate: sourceStartDate
      });
      const channelVideos = videos.filter(
        (video) => video.channelId === channelId && isPublishedInsideRange(video.publishedAt, dailyRange)
      );
      if (channelVideos.length === 0) return;

      const classifiedVideos = await classifyPublishedVideos({
        accessToken,
        channelId,
        channelLabel: channelLabelById.get(channelId) ?? channelId,
        videos: channelVideos,
        warnings
      });
      await upsertVideoCatalog(classifiedVideos);

      const unresolvedVideos = classifiedVideos.filter((video) => video.contentType === "unknown");
      if (unresolvedVideos.length > 0) {
        await syncYoutubeCreatorContentTypesForVideos({
          channelId,
          endDate: date,
          startDate: sourceStartDate,
          videoIds: unresolvedVideos.map((video) => video.videoId)
        });
      }
      videosSynced += channelVideos.length;
    } catch (error) {
      const channelLabel = channelLabelById.get(channelId) ?? channelId;
      warnings.push(`${channelLabel}: ${getErrorMessage(error).replaceAll(channelId, channelLabel)}`);
    }
  });

  return {
    channelsSynced: channelIds.length,
    videosSynced,
    warnings
  };
}

async function classifyPublishedVideos({
  accessToken,
  channelId,
  channelLabel,
  videos,
  warnings
}: {
  accessToken: string;
  channelId: string;
  channelLabel: string;
  videos: YouTubeVideoMetadata[];
  warnings: string[];
}) {
  const contentTypeByVideoId = await getShortsPlaylistContentTypes({
    accessToken,
    channelId,
    channelLabel,
    videoIds: videos.map((video) => video.videoId),
    warnings
  });
  const unresolvedVideoIds = videos
    .map((video) => video.videoId)
    .filter((videoId) => !contentTypeByVideoId.has(videoId));

  if (unresolvedVideoIds.length > 0) {
    const shortsUrlContentTypes = await getShortsUrlContentTypes(unresolvedVideoIds);
    for (const [videoId, contentType] of shortsUrlContentTypes) {
      contentTypeByVideoId.set(videoId, contentType);
    }
  }

  return videos.map((video) => ({
    ...video,
    contentType: contentTypeByVideoId.get(video.videoId) ?? video.contentType
  }));
}

async function getShortsPlaylistContentTypes({
  accessToken,
  channelId,
  channelLabel,
  videoIds,
  warnings
}: {
  accessToken: string;
  channelId: string;
  channelLabel: string;
  videoIds: string[];
  warnings: string[];
}) {
  const contentTypeByVideoId = new Map<string, VideoContentType>();

  try {
    const memberships = await fetchYouTubeShortsPlaylistMemberships({
      accessToken,
      channelId,
      videoIds
    });

    for (const [videoId, isShort] of memberships) {
      contentTypeByVideoId.set(videoId, isShort ? "short" : "long");
    }
  } catch (error) {
    warnings.push(`${channelLabel}: Shorts playlist classification failed; falling back to URL checks. ${getErrorMessage(error)}`);
  }

  return contentTypeByVideoId;
}

async function getShortsUrlContentTypes(videoIds: string[]) {
  const entries = await mapWithConcurrency(videoIds, SHORTS_URL_LOOKUP_CONCURRENCY, async (videoId) => {
    const contentType = await getShortsUrlContentType(videoId);
    return [videoId, contentType] as const;
  });

  return new Map(entries.filter((entry): entry is readonly [string, VideoContentType] => Boolean(entry[1])));
}

async function getShortsUrlContentType(videoId: string): Promise<VideoContentType | null> {
  try {
    const response = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(SHORTS_URL_LOOKUP_TIMEOUT_MS),
      cache: "no-store"
    });

    if (response.status === 200) return "short";
    if ([301, 302, 303, 307, 308].includes(response.status)) return "long";
    return null;
  } catch {
    return null;
  }
}

function isPublishedInsideRange(
  publishedAt: string | null,
  range: { endDateTime: string; startDateTime: string }
) {
  const publishedTime = publishedAt ? new Date(publishedAt).getTime() : Number.NaN;
  if (Number.isNaN(publishedTime)) return false;

  return publishedTime >= new Date(range.startDateTime).getTime() && publishedTime < new Date(range.endDateTime).getTime();
}

async function upsertVideoCatalog(metadata: YouTubeVideoMetadata[]) {
  const db = createDatabaseAdminClient();
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
      privacy_status: video.privacyStatus,
      view_count: video.viewCount,
      last_synced_at: now,
      updated_at: now
    }));

  for (const rowsChunk of chunk(rows, 500)) {
    if (rowsChunk.length === 0) continue;

    const { error } = await db.from("youtube_video_catalog").upsert(rowsChunk, {
      onConflict: "video_id"
    });

    if (error) throw error;
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, callback: (item: T) => Promise<R>) {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(callback))));
  }

  return results;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Published video sync failed.";
  }
}
