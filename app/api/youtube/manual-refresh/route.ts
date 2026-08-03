import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountManageDashboard,
  getSessionAccount,
  isChannelAllowedForAccount
} from "@/lib/auth";
import { isManualRefreshRangeValid } from "@/lib/manual-data-refresh";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { syncYoutubeCmsAnalytics } from "@/lib/youtube-performance-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const SYNC_CONCURRENCY = 2;
let manualRefreshInProgress = false;

type ManualRefreshRequest = {
  channelIds?: unknown;
  endDate?: unknown;
  startDate?: unknown;
};

export async function POST(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountManageDashboard(account)) {
    return NextResponse.json({ error: "Only admins can force-refresh analytics data." }, { status: 403 });
  }

  if (manualRefreshInProgress) {
    return NextResponse.json(
      { error: "Another manual data refresh is already running. Wait for it to finish and try again." },
      { status: 409 }
    );
  }

  let body: ManualRefreshRequest;
  try {
    body = (await request.json()) as ManualRefreshRequest;
  } catch {
    return NextResponse.json({ error: "Provide a valid refresh request." }, { status: 400 });
  }

  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const endDate = typeof body.endDate === "string" ? body.endDate : "";
  if (!isManualRefreshRangeValid(startDate, endDate)) {
    return NextResponse.json(
      { error: "Choose a valid date range no longer than two months." },
      { status: 400 }
    );
  }

  const requestedChannelIds = Array.isArray(body.channelIds)
    ? Array.from(new Set(body.channelIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())))
    : [];
  if (requestedChannelIds.length === 0) {
    return NextResponse.json({ error: "Select at least one channel to refresh." }, { status: 400 });
  }

  if (requestedChannelIds.some((channelId) => !isChannelAllowedForAccount(account, channelId))) {
    return NextResponse.json({ error: "One or more selected channels are not available to this account." }, { status: 403 });
  }

  let storedChannels: Awaited<ReturnType<typeof listStoredYoutubeManagedChannels>>;
  try {
    storedChannels = await listStoredYoutubeManagedChannels();
  } catch (error) {
    return NextResponse.json(
      { error: `Could not load the available channels: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
  const channelById = new Map(storedChannels.map((channel) => [channel.channelId, channel]));
  const channels = requestedChannelIds.map((channelId) => channelById.get(channelId)).filter(Boolean) as typeof storedChannels;
  if (channels.length !== requestedChannelIds.length) {
    return NextResponse.json({ error: "One or more selected channels are invalid." }, { status: 400 });
  }

  manualRefreshInProgress = true;
  try {
    const results = await mapWithConcurrency(channels, SYNC_CONCURRENCY, async (channel) => {
      try {
        const result = await syncYoutubeCmsAnalytics({
          channelId: channel.channelId,
          endDate,
          startDate,
          storePeriodBreakdowns: false,
          syncType: "manual"
        });
        return {
          channelId: channel.channelId,
          channelTitle: channel.title,
          metricsRowsSynced: result.metricsRowsSynced,
          status: "success" as const,
          warnings: result.warnings
        };
      } catch (error) {
        return {
          channelId: channel.channelId,
          channelTitle: channel.title,
          error: getErrorMessage(error),
          status: "failed" as const
        };
      }
    });

    const failed = results.filter((result) => result.status === "failed");
    const succeeded = results.filter((result) => result.status === "success");
    return NextResponse.json({
      endDate,
      failed: failed.length,
      results,
      startDate,
      status: failed.length === 0 ? "success" : succeeded.length === 0 ? "failed" : "partial",
      succeeded: succeeded.length
    });
  } finally {
    manualRefreshInProgress = false;
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, callback: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "YouTube refresh failed.";
  }
}
