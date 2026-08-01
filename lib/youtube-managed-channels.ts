import { createDatabaseAdminClient } from "@/lib/database";
import {
  fetchManagedYouTubeChannels,
  fetchYouTubeChannels,
  getYouTubeCmsConfig,
  isYouTubeCmsConfigured,
  refreshYouTubeAccessToken,
  type YouTubeChannelMetadata
} from "@/lib/youtube-cms-api";
import { filterFocusedYouTubeChannels } from "@/lib/youtube-channel-allowlist";
import {
  getDirectYoutubeChannelIds,
  getYouTubeDirectConfig,
  isYouTubeDirectConfigured
} from "@/lib/youtube-channel-sources";

export type StoredYoutubeManagedChannel = {
  channelId: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  lastSyncedAt: string | null;
};

type DatabaseAdminClient = ReturnType<typeof createDatabaseAdminClient>;

export async function listStoredYoutubeManagedChannels(db = createDatabaseAdminClient()) {
  const { data, error } = await db
    .from("youtube_managed_channels")
    .select("channel_id,title,custom_url,thumbnail_url,subscriber_count,view_count,video_count,last_synced_at")
    .order("title", { ascending: true });

  if (error) throw error;

  const channels = ((data ?? []) as Array<{
    channel_id: string;
    title: string;
    custom_url: string | null;
    thumbnail_url: string | null;
    subscriber_count: number | string | null;
    view_count: number | string | null;
    video_count: number | string | null;
    last_synced_at: string | null;
  }>).map((channel) => ({
    channelId: channel.channel_id,
    title: channel.title,
    customUrl: channel.custom_url,
    thumbnailUrl: channel.thumbnail_url,
    subscriberCount: toNullableNumber(channel.subscriber_count),
    viewCount: toNullableNumber(channel.view_count),
    videoCount: toNullableNumber(channel.video_count),
    lastSyncedAt: channel.last_synced_at
  }));

  return filterFocusedYouTubeChannels(channels);
}

export async function refreshYoutubeManagedChannelCatalog() {
  const db = createDatabaseAdminClient();
  const channelsById = new Map<string, YouTubeChannelMetadata>();

  if (isYouTubeCmsConfigured()) {
    const config = getYouTubeCmsConfig();
    const accessToken = await refreshYouTubeAccessToken(config);
    for (const contentOwnerId of config.contentOwnerIds) {
      const channels = await fetchManagedYouTubeChannels(accessToken, contentOwnerId);
      for (const channel of channels) {
        channelsById.set(channel.channelId, channel);
      }
    }
  }

  if (isYouTubeDirectConfigured()) {
    const directChannelIds = getDirectYoutubeChannelIds();
    const config = getYouTubeDirectConfig(directChannelIds[0]);
    const accessToken = await refreshYouTubeAccessToken(config);
    const channels = await fetchYouTubeChannels(accessToken, directChannelIds);
    for (const channel of channels) {
      channelsById.set(channel.channelId, channel);
    }
  }

  if (!isYouTubeCmsConfigured() && !isYouTubeDirectConfigured()) {
    throw new Error("YouTube CMS or direct-channel authentication must be configured.");
  }

  await upsertYoutubeManagedChannels(db, Array.from(channelsById.values()));

  return listStoredYoutubeManagedChannels(db);
}

export async function upsertYoutubeManagedChannels(
  db: DatabaseAdminClient,
  metadata: YouTubeChannelMetadata[]
) {
  const now = new Date().toISOString();
  const rows = metadata.map((channel) => ({
    channel_id: channel.channelId,
    title: channel.title,
    custom_url: channel.customUrl,
    thumbnail_url: channel.thumbnailUrl,
    subscriber_count: channel.subscriberCount,
    view_count: channel.viewCount,
    video_count: channel.videoCount,
    last_synced_at: now,
    updated_at: now
  }));

  for (const rowsChunk of chunk(rows, 500)) {
    if (rowsChunk.length === 0) continue;

    const { error } = await db.from("youtube_managed_channels").upsert(rowsChunk, {
      onConflict: "channel_id"
    });

    if (error) throw error;
  }
}

function toNullableNumber(value: number | string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
