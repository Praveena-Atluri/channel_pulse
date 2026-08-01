export type YouTubeChannelSource = "cms" | "direct";

export type YouTubeDirectConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  contentOwnerIds: string[];
  analyticsFilters: string;
  analyticsIds: string;
  sourceType: "direct";
};

export function getDirectYoutubeChannelIds() {
  return uniqueValues(process.env.YOUTUBE_DIRECT_CHANNEL_IDS);
}

export function isDirectYoutubeChannel(channelId: string) {
  return getDirectYoutubeChannelIds().includes(channelId);
}

export function isYouTubeDirectConfigured() {
  const channelIds = getDirectYoutubeChannelIds();
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      channelIds.length > 0 &&
      channelIds.every((channelId) => getDirectRefreshToken(channelId))
  );
}

export function isYouTubeSyncConfigured() {
  const cmsConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.YOUTUBE_OAUTH_REFRESH_TOKEN?.trim() &&
      uniqueValues(process.env.YOUTUBE_CONTENT_OWNER_ID).length > 0
  );

  return cmsConfigured || isYouTubeDirectConfigured();
}

export function getYouTubeDirectConfig(channelId: string): YouTubeDirectConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = getDirectRefreshToken(channelId);
  const channelIds = getDirectYoutubeChannelIds();
  const missing = [
    ["GOOGLE_CLIENT_ID", clientId],
    ["GOOGLE_CLIENT_SECRET", clientSecret],
    [
      `OAuth refresh token for ${channelId}`,
      refreshToken
    ],
    ["YOUTUBE_DIRECT_CHANNEL_IDS", channelIds.length > 0 ? channelIds.join(",") : ""]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing direct YouTube channel environment variables: ${missing.join(", ")}`);
  }

  if (!channelIds.includes(channelId)) {
    throw new Error(`Channel ${channelId} is not in YOUTUBE_DIRECT_CHANNEL_IDS.`);
  }

  return {
    analyticsFilters: "",
    analyticsIds: `channel==${channelId}`,
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    contentOwnerIds: [],
    refreshToken: refreshToken as string,
    sourceType: "direct"
  };
}

function getDirectRefreshToken(channelId: string) {
  const channelRefreshTokens = getDirectChannelRefreshTokens();
  return (
    channelRefreshTokens[channelId]?.trim() ||
    process.env.YOUTUBE_DIRECT_REFRESH_TOKEN?.trim() ||
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN?.trim()
  );
}

function getDirectChannelRefreshTokens(): Record<string, string> {
  const value = process.env.YOUTUBE_DIRECT_CHANNEL_REFRESH_TOKENS?.trim();
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("value must be a JSON object");
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([configuredChannelId, token]) => [configuredChannelId.trim(), token.trim()])
        .filter(([configuredChannelId, token]) => configuredChannelId && token)
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`YOUTUBE_DIRECT_CHANNEL_REFRESH_TOKENS must be valid JSON: ${detail}`);
  }
}

function uniqueValues(value: string | undefined) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}
