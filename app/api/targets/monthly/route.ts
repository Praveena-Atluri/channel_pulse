import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountManageDashboard,
  canAccountViewRevenue,
  getSessionAccount
} from "@/lib/auth";
import {
  TARGET_PERCENT_PRESETS,
  getEditableMonthlyTargetMetrics,
  getDefaultMonthlyTargetBaselineSource,
  getEditableTargetMonths,
  getTargetBaselineMonthOptionsFromAnchor,
  getVisibleMonthlyTargetMetrics,
  isEditableTargetMonth,
  normalizeMonthlyTargetBaselineSource,
  normalizeEditableTargetMonth,
  type MonthlyTargetBaselineSource
} from "@/lib/monthly-target-metrics";
import {
  getMonthlyTargetDashboardDataSafe,
  resolveMonthlyTargetBaselineMonth,
  saveMonthlyTargets,
  type SaveMonthlyTargetInputRow
} from "@/lib/monthly-targets";
import { listStoredYoutubeManagedChannels, type StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

type SaveTargetsRequestBody = {
  baselineSource?: unknown;
  month?: unknown;
  rows?: Array<{
    channelId?: unknown;
    targets?: SaveMonthlyTargetInputRow["targets"];
  }>;
};

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const month = normalizeEditableTargetMonth(request.nextUrl.searchParams.get("month"));
  const selectedChannels = await resolveSelectedChannels(request, account);
  if ("error" in selectedChannels) return selectedChannels.error;
  const canViewRevenue = canAccountViewRevenue(account);

  const baseline = await resolveBaselineSelection({
    channels: selectedChannels.channels,
    month,
    requestedBaselineSource: request.nextUrl.searchParams.get("baseline")
  });
  const dashboard = await getMonthlyTargetDashboardDataSafe({
    baselineMonth: baseline.month,
    baselineMonths: baseline.months,
    baselineSource: baseline.source,
    canViewRevenue,
    channels: selectedChannels.channels,
    month
  });

  return NextResponse.json({
    ...dashboard,
    availableMonths: getEditableTargetMonths(),
    editableMetrics: getEditableMonthlyTargetMetrics(canViewRevenue, month),
    metrics: getVisibleMonthlyTargetMetrics(canViewRevenue, month),
    percentPresets: TARGET_PERCENT_PRESETS
  });
}

export async function PUT(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountManageDashboard(account)) {
    return NextResponse.json({ error: "Only admins can update targets." }, { status: 403 });
  }
  const canViewRevenue = canAccountViewRevenue(account);

  let body: SaveTargetsRequestBody = {};
  try {
    body = (await request.json()) as SaveTargetsRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const month = typeof body.month === "string" ? body.month : "";
  if (!isEditableTargetMonth(month)) {
    return NextResponse.json({ error: "Select the current or upcoming month." }, { status: 400 });
  }

  const rows = normalizeSaveRows(body.rows, canViewRevenue);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Select at least one channel target to save." }, { status: 400 });
  }

  const selectedChannels = await resolveChannelsForIds(rows.map((row) => row.channelId), account);
  if ("error" in selectedChannels) return selectedChannels.error;

  try {
    await saveMonthlyTargets({
      canEditRevenue: canViewRevenue,
      month,
      rows,
      username: account.username
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }

  const baseline = await resolveBaselineSelection({
    channels: selectedChannels.channels,
    month,
    requestedBaselineSource: typeof body.baselineSource === "string" ? body.baselineSource : null
  });
  const dashboard = await getMonthlyTargetDashboardDataSafe({
    baselineMonth: baseline.month,
    baselineMonths: baseline.months,
    baselineSource: baseline.source,
    canViewRevenue,
    channels: selectedChannels.channels,
    month
  });

  return NextResponse.json({
    ...dashboard,
    availableMonths: getEditableTargetMonths(),
    editableMetrics: getEditableMonthlyTargetMetrics(canViewRevenue, month),
    metrics: getVisibleMonthlyTargetMetrics(canViewRevenue, month),
    percentPresets: TARGET_PERCENT_PRESETS
  });
}

async function resolveBaselineSelection({
  channels,
  month,
  requestedBaselineSource
}: {
  channels: StoredYoutubeManagedChannel[];
  month: string;
  requestedBaselineSource: string | null;
}): Promise<{ month: string; months: string[]; source: MonthlyTargetBaselineSource }> {
  const baselineMonth = await resolveMonthlyTargetBaselineMonth({
    channels,
    month
  });
  const baselineMonths = getTargetBaselineMonthOptionsFromAnchor(baselineMonth);

  return {
    month: baselineMonth,
    months: baselineMonths,
    source: normalizeMonthlyTargetBaselineSource(
      requestedBaselineSource,
      baselineMonths,
      getDefaultMonthlyTargetBaselineSource(month)
    )
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

function normalizeSaveRows(
  rows: SaveTargetsRequestBody["rows"],
  canEditRevenue: boolean
): SaveMonthlyTargetInputRow[] {
  if (!Array.isArray(rows)) return [];

  const seenChannelIds = new Set<string>();
  const normalizedRows: SaveMonthlyTargetInputRow[] = [];

  for (const row of rows) {
    const channelId = typeof row.channelId === "string" ? row.channelId.trim() : "";
    if (!channelId || seenChannelIds.has(channelId)) continue;

    seenChannelIds.add(channelId);
    normalizedRows.push({
      channelId,
      targets: sanitizeTargetInput(row.targets, canEditRevenue)
    });
  }

  return normalizedRows;
}

function sanitizeTargetInput(
  targets: SaveMonthlyTargetInputRow["targets"] | undefined,
  canEditRevenue: boolean
): SaveMonthlyTargetInputRow["targets"] {
  if (!targets || canEditRevenue) return targets ?? {};

  const { estimatedRevenue: _estimatedRevenue, ...visibleTargets } = targets;
  return visibleTargets;
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
    return "Unable to save monthly targets.";
  }
}
