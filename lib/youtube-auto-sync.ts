import { createSupabaseAdminClient } from "@/lib/supabase";
import { syncYoutubeCmsAnalytics } from "@/lib/youtube-performance-sync";

type AutoSyncChannel = {
  channelId: string;
};

type EnsureYoutubeAnalyticsRangeDataInput = {
  channels: AutoSyncChannel[];
  forceSync?: boolean;
  postSyncCheckAttempts?: number;
  startDate: string;
  endDate: string;
  throwOnIncomplete?: boolean;
};

const CHECK_PAGE_SIZE = 1000;
const CHANNEL_SYNC_CONCURRENCY = 3;
const POST_SYNC_CHECK_ATTEMPTS = 15;
const POST_SYNC_CHECK_DELAY_MS = 5_000;
const inFlightSyncs = new Map<string, Promise<void>>();

export async function ensureYoutubeAnalyticsRangeData({
  channels,
  forceSync = false,
  postSyncCheckAttempts = POST_SYNC_CHECK_ATTEMPTS,
  startDate,
  endDate,
  throwOnIncomplete = true
}: EnsureYoutubeAnalyticsRangeDataInput) {
  const channelIds = getUniqueChannelIds(channels);
  if (channelIds.length === 0) {
    return { syncedChannels: 0 };
  }

  const missingChannelIds = forceSync
    ? channelIds
    : await getIncompleteYoutubeAnalyticsChannelIds({ channels, startDate, endDate });
  const syncErrors = new Map<string, string>();

  await mapWithConcurrency(missingChannelIds, CHANNEL_SYNC_CONCURRENCY, async (channelId) => {
    try {
      await syncYoutubeAnalyticsRangeOnce({
        channelId,
        endDate,
        startDate
      });
    } catch (error) {
      syncErrors.set(channelId, getErrorMessage(error));
    }
  });

  if (missingChannelIds.length > 0) {
    const syncedChannelIds = await waitForChannelsWithCompleteMetrics(
      missingChannelIds,
      startDate,
      endDate,
      postSyncCheckAttempts
    );
    const incompleteChannelIds = missingChannelIds.filter((channelId) => !syncedChannelIds.has(channelId));

    if (incompleteChannelIds.length > 0 && throwOnIncomplete) {
      const firstIncompleteChannelId = incompleteChannelIds[0];
      const syncError = syncErrors.get(firstIncompleteChannelId);
      if (syncError) {
        throw new Error(syncError);
      }
      throw new Error(
        `YouTube sync completed, but complete daily channel metrics were not stored for ${firstIncompleteChannelId} from ${startDate} to ${endDate}.`
      );
    }
  }

  return { syncedChannels: missingChannelIds.length };
}

export async function getIncompleteYoutubeAnalyticsChannelIds({
  channels,
  startDate,
  endDate
}: EnsureYoutubeAnalyticsRangeDataInput) {
  const channelIds = getUniqueChannelIds(channels);
  if (channelIds.length === 0) return [];

  const completeChannelIds = await getChannelsWithCompleteMetrics(channelIds, startDate, endDate);
  return channelIds.filter((channelId) => !completeChannelIds.has(channelId));
}

function getUniqueChannelIds(channels: AutoSyncChannel[]) {
  return Array.from(new Set(channels.map((channel) => channel.channelId).filter(Boolean)));
}

async function waitForChannelsWithCompleteMetrics(
  channelIds: string[],
  startDate: string,
  endDate: string,
  maxAttempts: number
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const completeChannelIds = await getChannelsWithCompleteMetrics(channelIds, startDate, endDate);
    if (channelIds.every((channelId) => completeChannelIds.has(channelId)) || attempt === maxAttempts) {
      return completeChannelIds;
    }

    await sleep(POST_SYNC_CHECK_DELAY_MS);
  }

  return new Set<string>();
}

async function getChannelsWithCompleteMetrics(channelIds: string[], startDate: string, endDate: string) {
  const supabase = createSupabaseAdminClient();
  const expectedDays = getInclusiveDateKeys(startDate, endDate);
  if (expectedDays.length === 0) {
    return new Set<string>();
  }

  const daysByChannelId = new Map<string, Set<string>>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("youtube_channel_daily_metrics")
      .select(
        "channel_id,day,views,estimated_minutes_watched,subscribers_gained,subscribers_lost,estimated_revenue,monetized_playbacks,ad_impressions"
      )
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
      estimated_minutes_watched: number | string | null;
      estimated_revenue: number | string | null;
      monetized_playbacks: number | string | null;
      subscribers_gained: number | string | null;
      subscribers_lost: number | string | null;
      views: number | string | null;
    }>) {
      if (!hasUsableDailyMetrics(row)) continue;

      if (!daysByChannelId.has(row.channel_id)) {
        daysByChannelId.set(row.channel_id, new Set());
      }
      daysByChannelId.get(row.channel_id)?.add(row.day);
    }

    if (!data || data.length < CHECK_PAGE_SIZE) {
      break;
    }

    offset += CHECK_PAGE_SIZE;
  }

  const completeChannelIds = new Set<string>();
  for (const channelId of channelIds) {
    const days = daysByChannelId.get(channelId);
    if (days && expectedDays.every((day) => days.has(day))) {
      completeChannelIds.add(channelId);
    }
  }

  return completeChannelIds;
}

function hasUsableDailyMetrics(row: {
  ad_impressions: number | string | null;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  monetized_playbacks: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
  views: number | string | null;
}) {
  return (
    toNumber(row.views) > 0 ||
    toNumber(row.estimated_minutes_watched) > 0 ||
    toNumber(row.subscribers_gained) > 0 ||
    toNumber(row.subscribers_lost) > 0 ||
    toNumber(row.estimated_revenue) > 0 ||
    toNumber(row.monetized_playbacks) > 0 ||
    toNumber(row.ad_impressions) > 0
  );
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function syncYoutubeAnalyticsRangeOnce({
  channelId,
  startDate,
  endDate
}: {
  channelId: string;
  startDate: string;
  endDate: string;
}) {
  const key = `${channelId}|${startDate}|${endDate}`;
  const existingSync = inFlightSyncs.get(key);
  if (existingSync) return existingSync;

  const syncPromise = syncYoutubeCmsAnalytics({
    channelId,
    startDate,
    endDate,
    syncType: "manual"
  })
    .then(() => undefined)
    .finally(() => {
      inFlightSyncs.delete(key);
    });

  inFlightSyncs.set(key, syncPromise);
  return syncPromise;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<void>
) {
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    await Promise.all(batch.map(callback));
  }
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

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
