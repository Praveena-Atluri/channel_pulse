import { NextRequest, NextResponse } from "next/server";

import type { ChannelPulseAccount } from "@/lib/auth";
import { listStoredYoutubeManagedChannels, type StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";
import { getDefaultWeeklyRange } from "@/lib/weekly-performance";

export async function resolveWeeklyRequest(request: NextRequest, account: ChannelPulseAccount) {
  const startDate = normalizeDateParam(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeDateParam(request.nextUrl.searchParams.get("endDate"));
  if (!startDate || !endDate) {
    return { error: NextResponse.json({ error: "Select a valid week start and end date." }, { status: 400 }) };
  }

  if (startDate > endDate) {
    return { error: NextResponse.json({ error: "End date must be after start date." }, { status: 400 }) };
  }

  const latestWeeklyEndDate = getDefaultWeeklyRange().endDate;
  if (endDate > latestWeeklyEndDate) {
    return {
      error: NextResponse.json(
        {
          error: `Weekly reports can use YouTube-ready complete days only. Choose an end date on or before ${latestWeeklyEndDate}.`
        },
        { status: 400 }
      )
    };
  }

  const requestedChannelIds = uniqueValues(request.nextUrl.searchParams.getAll("channel"));
  if (requestedChannelIds.length === 0) {
    return { error: NextResponse.json({ error: "Select at least one channel." }, { status: 400 }) };
  }

  const allChannels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const channelsById = new Map(allChannels.map((channel) => [channel.channelId, channel]));
  const channels = requestedChannelIds
    .map((channelId) => channelsById.get(channelId))
    .filter((channel): channel is StoredYoutubeManagedChannel => Boolean(channel));

  if (channels.length !== requestedChannelIds.length || channels.length === 0) {
    return { error: NextResponse.json({ error: "Select valid channels." }, { status: 400 }) };
  }

  return { channels, endDate, startDate };
}

function filterChannelsForAccount<T extends { channelId: string }>(channels: T[], account: ChannelPulseAccount) {
  if (account.channelIds === null) return channels;

  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}

function normalizeDateParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
