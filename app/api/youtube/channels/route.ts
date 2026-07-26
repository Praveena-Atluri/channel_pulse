import { NextRequest, NextResponse } from "next/server";

import {
  CHANNEL_PULSE_SESSION_COOKIE,
  canAccountManageDashboard,
  getSessionAccount
} from "@/lib/auth";
import {
  listStoredYoutubeManagedChannels,
  refreshYoutubeManagedChannelCatalog
} from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const channels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
    return NextResponse.json({ channels, channelCount: channels.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load YouTube CMS channels.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const account = await getSessionAccount(request.cookies.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);
  if (!account) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canAccountManageDashboard(account)) {
    return NextResponse.json({ error: "Only admins can refresh the channel catalog." }, { status: 403 });
  }

  try {
    const channels = await refreshYoutubeManagedChannelCatalog();
    return NextResponse.json({ channels, channelCount: channels.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh YouTube CMS channels.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function filterChannelsForAccount<T extends { channelId: string }>(
  channels: T[],
  account: { channelIds: string[] | null }
) {
  if (account.channelIds === null) {
    return channels;
  }

  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}
