import type { ChannelPulseAccount } from "@/lib/auth";
import { createDatabaseAdminClient } from "@/lib/database";
import { isYouTubeSyncConfigured } from "@/lib/youtube-channel-sources";
import { ensureYoutubeAnalyticsRangeData } from "@/lib/youtube-auto-sync";
import {
  getLoginSyncScope,
  isLoginSyncFresh
} from "@/lib/login-sync-utils";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { syncYoutubePublishedVideosForDate } from "@/lib/youtube-published-video-sync";
import {
  getMonthDateRange,
  getPreviousMonth,
  normalizeReportDate
} from "@/lib/youtube-performance-utils";

type LoginSyncChannel = {
  channelId: string;
  title?: string | null;
};

type LoginSyncStateRow = {
  last_error_message?: string | null;
  last_started_at: string | null;
  last_status: string;
  last_synced_at: string | null;
};

type LoginSyncAnalyticsRange = {
  endDate: string;
  forceSync: boolean;
  startDate: string;
};

export type LoginYoutubeSyncState = {
  errorMessage: string | null;
  startedAt: string | null;
  status: string;
  syncedAt: string | null;
};

const inFlightLoginSyncs = new Map<string, Promise<void>>();
const LOGIN_SYNC_RUNNING_LEASE_MS = 15 * 60 * 1000;

export async function runLoginYoutubeSync(_account: ChannelPulseAccount) {
  if (!isYouTubeSyncConfigured()) {
    return;
  }

  const channels = await listStoredYoutubeManagedChannels();
  if (channels.length === 0) {
    return;
  }

  const channelIds = getUniqueChannelIds(channels);
  const syncScope = getLoginSyncScope(channelIds);
  const db = createDatabaseAdminClient();
  const state = await getLoginSyncState(db, syncScope);
  if (isLoginSyncFresh(state?.last_synced_at)) {
    return;
  }

  if (isLoginSyncRunning(state?.last_started_at, state?.last_status)) {
    return;
  }

  const syncRanges = getLoginSyncAnalyticsRanges();
  const key = `${syncScope}|${syncRanges.map((range) => `${range.startDate}:${range.endDate}`).join("|")}`;
  const existingSync = inFlightLoginSyncs.get(key);
  if (existingSync) {
    await existingSync;
    return;
  }

  const syncPromise = (async () => {
    await markLoginSyncStarted(db, syncScope, channelIds);
    await syncRecentPublishedVideos(channels);
    for (const range of syncRanges) {
      await ensureYoutubeAnalyticsRangeData({
        channels,
        endDate: range.endDate,
        forceSync: range.forceSync,
        startDate: range.startDate,
        storePeriodBreakdowns: true
      });
    }
    await markLoginSyncSuccess(db, syncScope, channelIds);
  })()
    .then(() => undefined)
    .catch(async (error) => {
      console.error("Login YouTube sync failed.", error);
      try {
        await markLoginSyncFailed(db, syncScope, channelIds, getErrorMessage(error));
      } catch (stateError) {
        console.error("Login YouTube sync state update failed.", stateError);
      }
    })
    .finally(() => {
      inFlightLoginSyncs.delete(key);
    });

  inFlightLoginSyncs.set(key, syncPromise);
  await syncPromise;
}

export async function getLatestLoginYoutubeSyncState(): Promise<LoginYoutubeSyncState | null> {
  const db = createDatabaseAdminClient();
  const { data, error } = await db
    .from("youtube_login_sync_state")
    .select("last_status,last_started_at,last_synced_at,last_error_message")
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && !isMissingLoginSyncStateTableError(error)) throw error;
  const row = data as LoginSyncStateRow | null;
  if (!row) return null;

  return {
    errorMessage: row.last_error_message ?? null,
    startedAt: row.last_started_at,
    status: row.last_status,
    syncedAt: row.last_synced_at
  };
}

export function getLoginSyncDateRange(now = new Date()) {
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), 1));

  return {
    startDate: normalizeReportDate(start),
    endDate: normalizeReportDate(yesterday)
  };
}

export function getLoginSyncAnalyticsRanges(now = new Date()): LoginSyncAnalyticsRange[] {
  const latestReadyRange = getLoginSyncDateRange(now);
  const previousMonth = getPreviousMonth(latestReadyRange.startDate.slice(0, 7));
  const previousMonthRange = getMonthDateRange(previousMonth, now);

  return [
    {
      ...latestReadyRange,
      forceSync: true
    },
    {
      endDate: previousMonthRange.analyticsEndDate,
      forceSync: false,
      startDate: previousMonthRange.startDate
    }
  ];
}

export function getLoginTodayDate(now = new Date()) {
  return normalizeReportDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

async function getLoginSyncState(
  db: ReturnType<typeof createDatabaseAdminClient>,
  syncScope: string
): Promise<LoginSyncStateRow | null> {
  const { data, error } = await db
    .from("youtube_login_sync_state")
    .select("last_status,last_started_at,last_synced_at")
    .eq("sync_scope", syncScope)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as LoginSyncStateRow | null;
}

async function markLoginSyncStarted(
  db: ReturnType<typeof createDatabaseAdminClient>,
  syncScope: string,
  channelIds: string[]
) {
  const now = new Date().toISOString();
  await upsertLoginSyncState(db, {
    channel_count: channelIds.length,
    channel_ids: JSON.stringify(channelIds),
    last_error_message: null,
    last_started_at: now,
    last_status: "running",
    sync_scope: syncScope,
    updated_at: now
  });
}

async function markLoginSyncSuccess(
  db: ReturnType<typeof createDatabaseAdminClient>,
  syncScope: string,
  channelIds: string[]
) {
  const now = new Date().toISOString();
  await upsertLoginSyncState(db, {
    channel_count: channelIds.length,
    channel_ids: JSON.stringify(channelIds),
    last_error_message: null,
    last_status: "success",
    last_synced_at: now,
    sync_scope: syncScope,
    updated_at: now
  });
}

async function markLoginSyncFailed(
  db: ReturnType<typeof createDatabaseAdminClient>,
  syncScope: string,
  channelIds: string[],
  errorMessage: string
) {
  const now = new Date().toISOString();
  await upsertLoginSyncState(db, {
    channel_count: channelIds.length,
    channel_ids: JSON.stringify(channelIds),
    last_error_message: errorMessage,
    last_status: "failed",
    sync_scope: syncScope,
    updated_at: now
  });
}

async function upsertLoginSyncState(
  db: ReturnType<typeof createDatabaseAdminClient>,
  row: Record<string, unknown>
) {
  const { error } = await db.from("youtube_login_sync_state").upsert([row], {
    onConflict: "sync_scope"
  });

  if (error) throw error;
}

function isLoginSyncRunning(
  lastStartedAt: string | null | undefined,
  status: string | null | undefined,
  now = new Date()
) {
  if (status !== "running" || !lastStartedAt) return false;

  const startedAt = new Date(lastStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return false;

  return now.getTime() - startedAt < LOGIN_SYNC_RUNNING_LEASE_MS;
}

async function syncRecentPublishedVideos(channels: LoginSyncChannel[]) {
  const today = getLoginTodayDate();
  const yesterday = addDays(today, -1);

  await mapWithConcurrency([yesterday, today], 1, async (date) => {
    try {
      await syncYoutubePublishedVideosForDate({ channels, date });
    } catch (error) {
      console.error(`Login published video sync failed for ${date}.`, error);
    }
  });
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

function getUniqueChannelIds(channels: LoginSyncChannel[]) {
  return Array.from(new Set(channels.map((channel) => channel.channelId).filter(Boolean))).sort();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Login YouTube sync failed.";
  }
}

function isMissingLoginSyncStateTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("youtube_login_sync_state") &&
    (message.includes("does not exist") || message.includes("no such table"))
  );
}
