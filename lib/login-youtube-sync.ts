import type { ChannelPulseAccount } from "@/lib/auth";
import { isYouTubeCmsConfigured } from "@/lib/youtube-cms-api";
import { ensureYoutubeAnalyticsRangeData } from "@/lib/youtube-auto-sync";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { normalizeReportDate } from "@/lib/youtube-performance-utils";

type LoginSyncChannel = {
  channelId: string;
};

const inFlightLoginSyncs = new Map<string, Promise<void>>();

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

  const syncPromise = ensureYoutubeAnalyticsRangeData({
    channels,
    endDate,
    startDate
  })
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

function filterChannelsForAccount<T extends LoginSyncChannel>(channels: T[], account: ChannelPulseAccount) {
  if (account.channelIds === null) return channels;

  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}
