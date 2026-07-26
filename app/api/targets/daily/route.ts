import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountManageDashboard,
  getSessionAccount
} from "@/lib/auth";
import {
  getDailyPublishingTargetDashboardDataSafe,
  normalizeDailyPublishingTargetValue,
  normalizePublishingTargetPeriod,
  saveDailyPublishingTargets,
  type SaveDailyPublishingTargetInputRow
} from "@/lib/daily-targets";
import { listStoredYoutubeManagedChannels, type StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

type SaveTargetsRequestBody = {
  rows?: Array<{
    channelId?: unknown;
    longVideosPeriod?: unknown;
    longVideosTarget?: unknown;
    shortVideosPeriod?: unknown;
    shortVideosTarget?: unknown;
  }>;
};

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountManageDashboard(account)) {
    return NextResponse.json({ error: "Only admins can view daily publishing targets." }, { status: 403 });
  }

  const selectedChannels = await resolveSelectedChannels(request, account);
  if ("error" in selectedChannels) return selectedChannels.error;

  const dashboard = await getDailyPublishingTargetDashboardDataSafe({
    channels: selectedChannels.channels
  });

  return NextResponse.json(serializeDailyTargetDashboard(dashboard));
}

export async function PUT(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountManageDashboard(account)) {
    return NextResponse.json({ error: "Only admins can update daily publishing targets." }, { status: 403 });
  }

  let body: SaveTargetsRequestBody = {};
  try {
    body = (await request.json()) as SaveTargetsRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  let rows: SaveDailyPublishingTargetInputRow[] = [];
  try {
    rows = normalizeSaveRows(body.rows);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Select at least one channel target to save." }, { status: 400 });
  }

  const selectedChannels = await resolveChannelsForIds(rows.map((row) => row.channelId), account);
  if ("error" in selectedChannels) return selectedChannels.error;

  try {
    await saveDailyPublishingTargets({
      rows,
      username: account.username
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }

  const dashboard = await getDailyPublishingTargetDashboardDataSafe({
    channels: selectedChannels.channels
  });

  return NextResponse.json(serializeDailyTargetDashboard(dashboard));
}

function serializeDailyTargetDashboard(
  dashboard: Awaited<ReturnType<typeof getDailyPublishingTargetDashboardDataSafe>>
) {
  return {
    ...dashboard,
    rows: dashboard.rows.map((row) => ({
      ...row,
      longVideosPeriod: row.target.longVideos.period,
      longVideosTarget: row.target.longVideos.value,
      shortVideosPeriod: row.target.shortVideos.period,
      shortVideosTarget: row.target.shortVideos.value
    }))
  };
}

async function resolveSelectedChannels(request: NextRequest, account: { channelIds: string[] | null }) {
  const requestedChannelIds = uniqueValues(request.nextUrl.searchParams.getAll("channel"));
  return resolveChannelsForIds(requestedChannelIds, account);
}

async function resolveChannelsForIds(channelIds: string[], account: { channelIds: string[] | null }) {
  const allChannels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  if (channelIds.length === 0) {
    return { channels: allChannels };
  }

  const channelsById = new Map(allChannels.map((channel) => [channel.channelId, channel]));
  const channels = channelIds
    .map((channelId) => channelsById.get(channelId))
    .filter((channel): channel is StoredYoutubeManagedChannel => Boolean(channel));

  if (channels.length !== channelIds.length) {
    return { error: NextResponse.json({ error: "Select valid channels." }, { status: 400 }) };
  }

  return { channels };
}

function normalizeSaveRows(rows: SaveTargetsRequestBody["rows"]): SaveDailyPublishingTargetInputRow[] {
  if (!Array.isArray(rows)) return [];

  const seenChannelIds = new Set<string>();
  const normalizedRows: SaveDailyPublishingTargetInputRow[] = [];

  for (const row of rows) {
    const channelId = typeof row.channelId === "string" ? row.channelId.trim() : "";
    if (!channelId || seenChannelIds.has(channelId)) continue;

    seenChannelIds.add(channelId);
    normalizedRows.push({
      channelId,
      longVideosPeriod: normalizePublishingTargetPeriod(row.longVideosPeriod),
      longVideosTarget: normalizeDailyPublishingTargetValue(row.longVideosTarget),
      shortVideosPeriod: normalizePublishingTargetPeriod(row.shortVideosPeriod),
      shortVideosTarget: normalizeDailyPublishingTargetValue(row.shortVideosTarget)
    });
  }

  return normalizedRows;
}

function filterChannelsForAccount<T extends { channelId: string }>(
  channels: T[],
  account: { channelIds: string[] | null }
) {
  if (account.channelIds === null) return channels;

  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unable to save daily publishing targets.";
  }
}
