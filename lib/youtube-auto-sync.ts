import { createDatabaseAdminClient } from "@/lib/database";
import { syncYoutubeCmsAnalytics } from "@/lib/youtube-performance-sync";

type AutoSyncChannel = {
  channelId: string;
};

type EnsureYoutubeAnalyticsRangeDataInput = {
  channels: AutoSyncChannel[];
  forceSync?: boolean;
  postSyncCheckAttempts?: number;
  requireRevenue?: boolean;
  startDate: string;
  endDate: string;
  storePeriodBreakdowns?: boolean;
  throwOnIncomplete?: boolean;
};

export type MissingYoutubeAnalyticsRange = {
  channelId: string;
  endDate: string;
  startDate: string;
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
  requireRevenue = false,
  startDate,
  endDate,
  storePeriodBreakdowns,
  throwOnIncomplete = true
}: EnsureYoutubeAnalyticsRangeDataInput) {
  const channelIds = getUniqueChannelIds(channels);
  if (channelIds.length === 0) {
    return { syncedChannels: 0 };
  }

  const missingRanges = forceSync
    ? channelIds.map((channelId) => ({ channelId, endDate, startDate }))
    : await getMissingYoutubeAnalyticsRanges({ channels, requireRevenue, startDate, endDate });
  const syncErrors = new Map<string, string>();
  let quotaExceededError = "";

  await mapWithConcurrency(missingRanges, CHANNEL_SYNC_CONCURRENCY, async (range) => {
    if (quotaExceededError) return;

    try {
      await syncYoutubeAnalyticsRangeOnce({
        channelId: range.channelId,
        endDate: range.endDate,
        startDate: range.startDate,
        storePeriodBreakdowns
      });
    } catch (error) {
      const message = getErrorMessage(error);
      syncErrors.set(getRangeKey(range), message);
      if (isQuotaExceededError(message)) {
        quotaExceededError = message;
      }
    }
  });

  if (quotaExceededError && throwOnIncomplete) {
    throw new Error(quotaExceededError);
  }

  if (missingRanges.length > 0) {
    const incompleteRanges = await waitForRangesWithCompleteMetrics(missingRanges, postSyncCheckAttempts, requireRevenue);

    if (incompleteRanges.length > 0 && throwOnIncomplete) {
      const firstIncompleteRange = incompleteRanges[0];
      const syncError = syncErrors.get(getRangeKey(firstIncompleteRange));
      if (syncError) {
        throw new Error(syncError);
      }
      throw new Error(
        `YouTube sync completed, but complete daily channel metrics were not stored for ${firstIncompleteRange.channelId} from ${firstIncompleteRange.startDate} to ${firstIncompleteRange.endDate}.`
      );
    }
  }

  return {
    syncedChannels: new Set(missingRanges.map((range) => range.channelId)).size,
    syncedRanges: missingRanges.length
  };
}

export async function getIncompleteYoutubeAnalyticsChannelIds({
  channels,
  requireRevenue,
  startDate,
  endDate
}: EnsureYoutubeAnalyticsRangeDataInput) {
  const channelIds = getUniqueChannelIds(channels);
  if (channelIds.length === 0) return [];

  const missingRanges = await getMissingYoutubeAnalyticsRanges({ channels, requireRevenue, startDate, endDate });
  return Array.from(new Set(missingRanges.map((range) => range.channelId)));
}

export async function getMissingYoutubeAnalyticsRanges({
  channels,
  requireRevenue = false,
  startDate,
  endDate
}: EnsureYoutubeAnalyticsRangeDataInput): Promise<MissingYoutubeAnalyticsRange[]> {
  const channelIds = getUniqueChannelIds(channels);
  if (channelIds.length === 0) return [];

  const usableDaysByChannelId = await getUsableDailyMetricDays(channelIds, startDate, endDate, requireRevenue);
  return getMissingRangesForChannelWindow(channelIds, startDate, endDate, usableDaysByChannelId);
}

function getUniqueChannelIds(channels: AutoSyncChannel[]) {
  return Array.from(new Set(channels.map((channel) => channel.channelId).filter(Boolean)));
}

async function waitForRangesWithCompleteMetrics(
  ranges: MissingYoutubeAnalyticsRange[],
  maxAttempts: number,
  requireRevenue: boolean
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const missingRanges = await getMissingRangesForRequestedRanges(ranges, requireRevenue);
    if (missingRanges.length === 0 || attempt === maxAttempts) {
      return missingRanges;
    }

    await sleep(POST_SYNC_CHECK_DELAY_MS);
  }

  return ranges;
}

async function getMissingRangesForRequestedRanges(ranges: MissingYoutubeAnalyticsRange[], requireRevenue: boolean) {
  if (ranges.length === 0) return [];

  const channelIds = Array.from(new Set(ranges.map((range) => range.channelId)));
  const startDate = ranges.reduce((earliest, range) => (range.startDate < earliest ? range.startDate : earliest), ranges[0].startDate);
  const endDate = ranges.reduce((latest, range) => (range.endDate > latest ? range.endDate : latest), ranges[0].endDate);
  const usableDaysByChannelId = await getUsableDailyMetricDays(channelIds, startDate, endDate, requireRevenue);
  const missingRanges: MissingYoutubeAnalyticsRange[] = [];

  for (const range of ranges) {
    missingRanges.push(
      ...getMissingRangesForChannelWindow([range.channelId], range.startDate, range.endDate, usableDaysByChannelId)
    );
  }

  return missingRanges;
}

async function getUsableDailyMetricDays(
  channelIds: string[],
  startDate: string,
  endDate: string,
  requireRevenue: boolean
) {
  const db = createDatabaseAdminClient();
  const daysByChannelId = new Map(channelIds.map((channelId) => [channelId, new Set<string>()]));
  let offset = 0;

  while (true) {
    const { data, error } = await db
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
      if (!hasUsableDailyMetrics(row, requireRevenue)) continue;
      daysByChannelId.get(row.channel_id)?.add(row.day);
    }

    if (!data || data.length < CHECK_PAGE_SIZE) {
      break;
    }

    offset += CHECK_PAGE_SIZE;
  }

  return daysByChannelId;
}

function getMissingRangesForChannelWindow(
  channelIds: string[],
  startDate: string,
  endDate: string,
  usableDaysByChannelId: Map<string, Set<string>>
) {
  const expectedDays = getInclusiveDateKeys(startDate, endDate);
  if (expectedDays.length === 0) return [];

  const missingRanges: MissingYoutubeAnalyticsRange[] = [];
  for (const channelId of channelIds) {
    const usableDays = usableDaysByChannelId.get(channelId) ?? new Set<string>();
    const missingDays = expectedDays.filter((day) => !usableDays.has(day));
    missingRanges.push(...groupMissingDays(channelId, missingDays));
  }

  return missingRanges;
}

function groupMissingDays(channelId: string, missingDays: string[]) {
  const ranges: MissingYoutubeAnalyticsRange[] = [];
  let startDate = "";
  let previousDate = "";

  for (const day of missingDays) {
    if (!startDate) {
      startDate = day;
      previousDate = day;
      continue;
    }

    if (day === addDaysToDate(previousDate, 1)) {
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

function hasUsableDailyMetrics(row: {
  ad_impressions: number | string | null;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  monetized_playbacks: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
  views: number | string | null;
}, requireRevenue: boolean) {
  const hasAnyMetrics =
    toNumber(row.views) > 0 ||
    toNumber(row.estimated_minutes_watched) > 0 ||
    toNumber(row.subscribers_gained) > 0 ||
    toNumber(row.subscribers_lost) > 0 ||
    toNumber(row.estimated_revenue) > 0 ||
    toNumber(row.monetized_playbacks) > 0 ||
    toNumber(row.ad_impressions) > 0;

  if (!hasAnyMetrics) return false;

  if (
    requireRevenue &&
    toNumber(row.views) > 0 &&
    toNumber(row.estimated_revenue) === 0 &&
    toNumber(row.monetized_playbacks) === 0
  ) {
    return false;
  }

  return true;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function syncYoutubeAnalyticsRangeOnce({
  channelId,
  startDate,
  endDate,
  storePeriodBreakdowns
}: {
  channelId: string;
  startDate: string;
  endDate: string;
  storePeriodBreakdowns?: boolean;
}) {
  const key = `${channelId}|${startDate}|${endDate}|${storePeriodBreakdowns ? "breakdowns" : "daily"}`;
  const existingSync = inFlightSyncs.get(key);
  if (existingSync) return existingSync;

  const syncPromise = syncYoutubeCmsAnalytics({
    channelId,
    startDate,
    endDate,
    storePeriodBreakdowns,
    syncType: "manual"
  })
    .then(() => undefined)
    .finally(() => {
      inFlightSyncs.delete(key);
    });

  inFlightSyncs.set(key, syncPromise);
  return syncPromise;
}

function getRangeKey(range: MissingYoutubeAnalyticsRange) {
  return `${range.channelId}|${range.startDate}|${range.endDate}`;
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

function isQuotaExceededError(message: string) {
  return message.includes("quotaExceeded") || message.toLowerCase().includes("exceeded your quota");
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

function addDaysToDate(value: string, days: number) {
  const date = parseDateKey(value);
  if (!date) return value;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
