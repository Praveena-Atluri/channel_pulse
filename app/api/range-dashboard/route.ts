import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountViewRevenue,
  getSessionAccount
} from "@/lib/auth";
import { getRangeDashboardData } from "@/lib/range-dashboard";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const startDate = normalizeDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeDate(request.nextUrl.searchParams.get("endDate"));
  if (!startDate || !endDate || startDate > endDate) {
    return NextResponse.json({ error: "Select a valid start and end date." }, { status: 400 });
  }

  if (daysBetween(startDate, endDate) > 1095) {
    return NextResponse.json({ error: "Select a date range of three years or less." }, { status: 400 });
  }

  const requestedIds = Array.from(new Set(request.nextUrl.searchParams.getAll("channel").filter(Boolean)));
  const availableChannels = (await listStoredYoutubeManagedChannels()).filter(
    (channel) => account.channelIds === null || account.channelIds.includes(channel.channelId)
  );
  const channelById = new Map(availableChannels.map((channel) => [channel.channelId, channel]));
  const channels = requestedIds.map((id) => channelById.get(id)).filter(Boolean) as typeof availableChannels;

  if (channels.length === 0 || channels.length !== requestedIds.length) {
    return NextResponse.json({ error: "Select at least one valid channel." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await getRangeDashboardData({
        canViewRevenue: canAccountViewRevenue(account),
        channels,
        endDate,
        startDate
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load range analytics." },
      { status: 502 }
    );
  }
}

function normalizeDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function daysBetween(startDate: string, endDate: string) {
  return Math.floor(
    (new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) /
      86_400_000
  );
}
