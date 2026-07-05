import { createDatabaseAdminClient } from "@/lib/database";
import type { DailyMetricsVideoRow } from "@/lib/daily-metrics";
import {
  normalizePublishingTargetPeriod,
  type PublishingTargetSetting
} from "@/lib/publishing-targets";

export {
  derivePublishingTargetForDays,
  formatPublishingTargetSourceLabel,
  normalizePublishingTargetPeriod
} from "@/lib/publishing-targets";
export type { PublishingTargetPeriod, PublishingTargetSetting } from "@/lib/publishing-targets";

export type DailyPublishingTargetValues = {
  longVideos: PublishingTargetSetting;
  shortVideos: PublishingTargetSetting;
};

export type DailyPublishingTargetActuals = {
  longVideos: number;
  shortVideos: number;
};

export type DailyPublishingTargetDashboardRow = {
  actual: DailyPublishingTargetActuals;
  channelId: string;
  channelTitle: string;
  target: DailyPublishingTargetValues;
};

export type DailyPublishingTargetDashboardData = {
  errorMessage?: string;
  rows: DailyPublishingTargetDashboardRow[];
  schemaReady: boolean;
};

export type SaveDailyPublishingTargetInputRow = {
  channelId: string;
  longVideosPeriod?: unknown;
  longVideosTarget: unknown;
  shortVideosPeriod?: unknown;
  shortVideosTarget: unknown;
};

type DailyTargetChannel = {
  channelId: string;
  title: string;
};

type TargetDbRow = {
  channel_id: string;
  long_videos_target: number | string | null;
  long_videos_target_period?: string | null;
  short_videos_target: number | string | null;
  short_videos_target_period?: string | null;
  created_by?: string | null;
};

const TARGET_SELECT_COLUMNS = [
  "channel_id",
  "short_videos_target",
  "short_videos_target_period",
  "long_videos_target",
  "long_videos_target_period",
  "created_by"
].join(",");
const LEGACY_TARGET_SELECT_COLUMNS = [
  "channel_id",
  "short_videos_target",
  "long_videos_target",
  "created_by"
].join(",");

export async function getDailyPublishingTargetDashboardData({
  actualRows = [],
  channels
}: {
  actualRows?: DailyMetricsVideoRow[];
  channels: DailyTargetChannel[];
}): Promise<DailyPublishingTargetDashboardData> {
  const targetRows = await getDailyTargetRows(channels.map((channel) => channel.channelId));
  const targetRowsByChannelId = new Map(targetRows.map((row) => [row.channel_id, row]));
  const actualsByChannelId = getActualsByChannelId(actualRows);

  return {
    rows: channels.map((channel) => ({
      actual: actualsByChannelId.get(channel.channelId) ?? createEmptyActuals(),
      channelId: channel.channelId,
      channelTitle: channel.title,
      target: mapTargetDbRow(targetRowsByChannelId.get(channel.channelId))
    })),
    schemaReady: true
  };
}

export async function getDailyPublishingTargetDashboardDataSafe(input: {
  actualRows?: DailyMetricsVideoRow[];
  channels: DailyTargetChannel[];
}): Promise<DailyPublishingTargetDashboardData> {
  try {
    return await getDailyPublishingTargetDashboardData(input);
  } catch (error) {
    if (isMissingDailyTargetTableError(error)) {
      return {
        errorMessage: "Apply the daily publishing targets schema before saving daily targets.",
        rows: [],
        schemaReady: false
      };
    }

    throw error;
  }
}

export async function saveDailyPublishingTargets({
  rows,
  username
}: {
  rows: SaveDailyPublishingTargetInputRow[];
  username: string;
}) {
  const db = createDatabaseAdminClient();
  const channelIds = rows.map((row) => row.channelId);
  const existingRows = await getDailyTargetRows(channelIds);
  const existingRowsByChannelId = new Map(existingRows.map((row) => [row.channel_id, row]));
  const savedAt = new Date().toISOString();
  const payload = rows.map((row) => {
    const existingRow = existingRowsByChannelId.get(row.channelId);

    return {
      channel_id: row.channelId,
      short_videos_target: normalizeDailyPublishingTargetValue(row.shortVideosTarget),
      short_videos_target_period: normalizePublishingTargetPeriod(row.shortVideosPeriod),
      long_videos_target: normalizeDailyPublishingTargetValue(row.longVideosTarget),
      long_videos_target_period: normalizePublishingTargetPeriod(row.longVideosPeriod),
      created_by: existingRow?.created_by ?? username,
      updated_by: username,
      updated_at: savedAt
    };
  });

  if (payload.length === 0) return;

  const { error } = await db
    .from("youtube_daily_channel_targets")
    .upsert(payload, { onConflict: "channel_id" });

  if (error) throw error;
}

export async function getDailyPublishingTargetsByChannelId(channelIds: string[]) {
  let targetRows: TargetDbRow[] = [];
  try {
    targetRows = await getDailyTargetRows(channelIds);
  } catch (error) {
    if (isMissingDailyTargetTableError(error)) return new Map<string, DailyPublishingTargetValues>();
    throw error;
  }

  return new Map(targetRows.map((row) => [row.channel_id, mapTargetDbRow(row)]));
}

export function normalizeDailyPublishingTargetValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Daily publishing targets must be whole numbers greater than or equal to 0.");
  }

  return parsed;
}

async function getDailyTargetRows(channelIds: string[]) {
  if (channelIds.length === 0) return [];

  const db = createDatabaseAdminClient();
  try {
    const { data, error } = await db
      .from("youtube_daily_channel_targets")
      .select(TARGET_SELECT_COLUMNS)
      .in("channel_id", channelIds);

    if (error) throw error;
    return (data ?? []) as TargetDbRow[];
  } catch (error) {
    if (!isMissingDailyTargetPeriodColumnError(error)) throw error;

    const { data, error: legacyError } = await db
      .from("youtube_daily_channel_targets")
      .select(LEGACY_TARGET_SELECT_COLUMNS)
      .in("channel_id", channelIds);

    if (legacyError) throw legacyError;
    return (data ?? []) as TargetDbRow[];
  }
}

function mapTargetDbRow(row: TargetDbRow | undefined): DailyPublishingTargetValues {
  if (!row) {
    return {
      longVideos: createEmptyTargetSetting(),
      shortVideos: createEmptyTargetSetting()
    };
  }

  return {
    longVideos: {
      period: normalizePublishingTargetPeriod(row.long_videos_target_period),
      value: toNullableNumber(row.long_videos_target)
    },
    shortVideos: {
      period: normalizePublishingTargetPeriod(row.short_videos_target_period),
      value: toNullableNumber(row.short_videos_target)
    }
  };
}

function createEmptyTargetSetting(): PublishingTargetSetting {
  return {
    period: "daily",
    value: null
  };
}

function getActualsByChannelId(rows: DailyMetricsVideoRow[]) {
  const actualsByChannelId = new Map<string, DailyPublishingTargetActuals>();

  for (const row of rows) {
    const actuals = actualsByChannelId.get(row.channelId) ?? createEmptyActuals();
    if (row.contentType === "long") {
      actuals.longVideos += 1;
    } else if (row.contentType === "short") {
      actuals.shortVideos += 1;
    }

    actualsByChannelId.set(row.channelId, actuals);
  }

  return actualsByChannelId;
}

function createEmptyActuals(): DailyPublishingTargetActuals {
  return {
    longVideos: 0,
    shortVideos: 0
  };
}

function isMissingDailyTargetTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("youtube_daily_channel_targets") &&
    (message.includes("does not exist") || message.includes("no such table"))
  );
}

function isMissingDailyTargetPeriodColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (message.includes("short_videos_target_period") || message.includes("long_videos_target_period")) &&
    (message.includes("does not exist") || message.includes("no such column") || message.includes("Could not find"))
  );
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
