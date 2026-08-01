import {
  classifyVideoContentType,
  parseIsoDurationToSeconds,
  type VideoContentType
} from "@/lib/youtube-performance-utils";
import {
  normalizeVideoPrivacyStatus,
  type VideoPrivacyStatus
} from "@/lib/youtube-video-privacy";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_ANALYTICS_REPORT_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const YOUTUBE_DATA_API_BASE = "https://www.googleapis.com/youtube/v3";
const REPORT_PAGE_SIZE = 200;
const GOOGLE_API_TIMEOUT_MS = 30_000;

export type YouTubeApiConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  contentOwnerId?: string;
  contentOwnerIds: string[];
  analyticsFilters: string;
  analyticsIds: string;
  sourceType: "cms" | "direct";
};

export type YouTubeCmsConfig = YouTubeApiConfig & {
  contentOwnerId: string;
  sourceType: "cms";
};

export type AnalyticsReportParams = {
  ids?: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  filters?: string;
  sort?: string[];
  maxResults?: number;
  paginate?: boolean;
};

export type AnalyticsReportResult = {
  rows: AnalyticsReportRow[];
  metrics: string[];
};

export type AnalyticsReportRow = Record<string, string | number | null>;

export type YouTubeChannelMetadata = {
  channelId: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
};

export type YouTubeVideoMetadata = {
  videoId: string;
  channelId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  contentType: VideoContentType;
  privacyStatus: VideoPrivacyStatus;
  viewCount: number | null;
};

type RawAnalyticsReport = {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number | null>>;
};

export function getYouTubeCmsConfig(): YouTubeCmsConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
  const contentOwnerIds = parseContentOwnerIds(process.env.YOUTUBE_CONTENT_OWNER_ID);

  const missing = [
    ["GOOGLE_CLIENT_ID", clientId],
    ["GOOGLE_CLIENT_SECRET", clientSecret],
    ["YOUTUBE_OAUTH_REFRESH_TOKEN", refreshToken],
    ["YOUTUBE_CONTENT_OWNER_ID", contentOwnerIds.length > 0 ? contentOwnerIds.join(",") : ""]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing YouTube CMS environment variables: ${missing.join(", ")}`);
  }

  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    refreshToken: refreshToken as string,
    contentOwnerId: contentOwnerIds[0],
    contentOwnerIds,
    analyticsFilters: process.env.YOUTUBE_ANALYTICS_FILTERS ?? "claimedStatus==claimed",
    analyticsIds: `contentOwner==${contentOwnerIds[0]}`,
    sourceType: "cms"
  };
}

export function isYouTubeCmsConfigured() {
  return Boolean(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.YOUTUBE_OAUTH_REFRESH_TOKEN &&
      parseContentOwnerIds(process.env.YOUTUBE_CONTENT_OWNER_ID).length > 0
  );
}

export function withYouTubeContentOwner(config: YouTubeCmsConfig, contentOwnerId: string): YouTubeCmsConfig {
  return { ...config, analyticsIds: `contentOwner==${contentOwnerId}`, contentOwnerId };
}

export async function refreshYouTubeAccessToken(config: YouTubeApiConfig = getYouTubeCmsConfig()) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`YouTube OAuth token refresh failed: ${await response.text()}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("YouTube OAuth token refresh did not return an access token.");
  }

  return payload.access_token;
}

export async function fetchAnalyticsReport(
  accessToken: string,
  config: YouTubeApiConfig,
  reportParams: AnalyticsReportParams
): Promise<AnalyticsReportResult> {
  let startIndex = 1;
  const rows: AnalyticsReportRow[] = [];

  while (true) {
    const params = new URLSearchParams({
      ids: reportParams.ids ?? config.analyticsIds,
      startDate: reportParams.startDate,
      endDate: reportParams.endDate,
      dimensions: reportParams.dimensions.join(","),
      metrics: reportParams.metrics.join(","),
      maxResults: String(reportParams.maxResults ?? REPORT_PAGE_SIZE),
      startIndex: String(startIndex),
    });

    if (config.sourceType === "cms") {
      params.set("includeHistoricalChannelData", "true");
    }

    if (reportParams.filters) {
      params.set("filters", reportParams.filters);
    }

    if (reportParams.sort && reportParams.sort.length > 0) {
      params.set("sort", reportParams.sort.join(","));
    }

    const response = await fetch(`${YOUTUBE_ANALYTICS_REPORT_URL}?${params}`, {
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `YouTube Analytics report failed for dimensions=${reportParams.dimensions.join(",")} metrics=${reportParams.metrics.join(",")}: ${await response.text()}`
      );
    }

    const payload = (await response.json()) as RawAnalyticsReport;
    const pageRows = normalizeAnalyticsRows(payload);
    rows.push(...pageRows);

    if (reportParams.paginate === false || pageRows.length < (reportParams.maxResults ?? REPORT_PAGE_SIZE)) {
      break;
    }

    startIndex += reportParams.maxResults ?? REPORT_PAGE_SIZE;
  }

  return { rows, metrics: reportParams.metrics };
}

export async function fetchAnalyticsReportWithFallback(input: {
  accessToken: string;
  config: YouTubeApiConfig;
  ids?: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  metricSets: string[][];
  filters?: string;
  sort?: string[];
  maxResults?: number;
  paginate?: boolean;
}) {
  const errors: string[] = [];

  for (const metrics of input.metricSets) {
    try {
      return await fetchAnalyticsReport(input.accessToken, input.config, {
        ids: input.ids,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        metrics,
        filters: input.filters,
        sort: input.sort,
        maxResults: input.maxResults,
        paginate: input.paginate
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `Unknown YouTube Analytics error for dimensions=${input.dimensions.join(",")} metrics=${metrics.join(",")}`
      );
    }
  }

  throw new Error(errors.join("\n"));
}

export async function fetchManagedYouTubeChannels(
  accessToken: string,
  contentOwnerId: string
): Promise<YouTubeChannelMetadata[]> {
  const channels: YouTubeChannelMetadata[] = [];
  let pageToken: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      part: "snippet,statistics",
      managedByMe: "true",
      onBehalfOfContentOwner: contentOwnerId,
      maxResults: "50"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(`${YOUTUBE_DATA_API_BASE}/channels?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`YouTube managed channels.list failed: ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      nextPageToken?: string;
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
        };
        statistics?: {
          subscriberCount?: string;
          viewCount?: string;
          videoCount?: string;
          hiddenSubscriberCount?: boolean;
        };
      }>;
    };

    for (const item of payload.items ?? []) {
      channels.push({
        channelId: item.id,
        title: item.snippet?.title ?? item.id,
        customUrl: item.snippet?.customUrl ?? null,
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
        subscriberCount: item.statistics?.hiddenSubscriberCount
          ? null
          : parseOptionalNumber(item.statistics?.subscriberCount),
        viewCount: parseOptionalNumber(item.statistics?.viewCount),
        videoCount: parseOptionalNumber(item.statistics?.videoCount)
      });
    }

    if (!payload.nextPageToken) {
      break;
    }

    pageToken = payload.nextPageToken;
  }

  return channels;
}

export async function fetchYouTubeChannels(
  accessToken: string,
  channelIds: string[]
): Promise<YouTubeChannelMetadata[]> {
  const channels: YouTubeChannelMetadata[] = [];

  for (const ids of chunk(channelIds, 50)) {
    if (ids.length === 0) continue;

    const params = new URLSearchParams({
      part: "snippet,statistics",
      id: ids.join(","),
      maxResults: "50"
    });

    const response = await fetch(`${YOUTUBE_DATA_API_BASE}/channels?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`YouTube channels.list failed: ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
        };
        statistics?: {
          subscriberCount?: string;
          viewCount?: string;
          videoCount?: string;
          hiddenSubscriberCount?: boolean;
        };
      }>;
    };

    for (const item of payload.items ?? []) {
      channels.push({
        channelId: item.id,
        title: item.snippet?.title ?? item.id,
        customUrl: item.snippet?.customUrl ?? null,
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
        subscriberCount: item.statistics?.hiddenSubscriberCount
          ? null
          : parseOptionalNumber(item.statistics?.subscriberCount),
        viewCount: parseOptionalNumber(item.statistics?.viewCount),
        videoCount: parseOptionalNumber(item.statistics?.videoCount)
      });
    }
  }

  return channels;
}

export async function fetchYouTubeVideos(
  accessToken: string,
  videoIds: string[]
): Promise<YouTubeVideoMetadata[]> {
  const videos: YouTubeVideoMetadata[] = [];

  for (const ids of chunk(videoIds, 50)) {
    if (ids.length === 0) continue;

    const params = new URLSearchParams({
      part: "snippet,contentDetails,statistics,status",
      id: ids.join(","),
      maxResults: "50"
    });

    const response = await fetch(`${YOUTUBE_DATA_API_BASE}/videos?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`YouTube videos.list failed: ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          description?: string;
          channelId?: string;
          publishedAt?: string;
          thumbnails?: { medium?: { url?: string }; high?: { url?: string }; default?: { url?: string } };
        };
        contentDetails?: { duration?: string };
        statistics?: { viewCount?: string };
        status?: { privacyStatus?: string };
      }>;
    };

    for (const item of payload.items ?? []) {
      const durationSeconds = parseIsoDurationToSeconds(item.contentDetails?.duration);

      videos.push({
        videoId: item.id,
        channelId: item.snippet?.channelId ?? "",
        title: item.snippet?.title ?? item.id,
        description: item.snippet?.description ?? null,
        thumbnailUrl:
          item.snippet?.thumbnails?.high?.url ??
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          null,
        publishedAt: item.snippet?.publishedAt ?? null,
        durationSeconds,
        contentType: classifyVideoContentType({ durationSeconds }),
        privacyStatus: normalizeVideoPrivacyStatus(item.status?.privacyStatus),
        viewCount: parseOptionalNumber(item.statistics?.viewCount)
      });
    }
  }

  return videos;
}

export async function fetchYouTubeShortsPlaylistMemberships(input: {
  accessToken: string;
  channelId: string;
  videoIds: string[];
}): Promise<Map<string, boolean>> {
  const shortsPlaylistId = getShortsPlaylistId(input.channelId);
  const videoIds = unique(input.videoIds);
  const results = await mapWithConcurrency(videoIds, 5, async (videoId) => {
    const params = new URLSearchParams({
      part: "contentDetails",
      playlistId: shortsPlaylistId,
      videoId,
      maxResults: "1"
    });

    const response = await fetch(`${YOUTUBE_DATA_API_BASE}/playlistItems?${params}`, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`YouTube shorts playlist lookup failed: ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      items?: Array<{ contentDetails?: { videoId?: string } }>;
    };

    return [videoId, (payload.items ?? []).some((item) => item.contentDetails?.videoId === videoId)] as const;
  });

  return new Map(results);
}

export async function fetchChannelVideosPublishedBetween(input: {
  accessToken: string;
  channelId: string;
  startDate: string;
  endDate: string;
}): Promise<YouTubeVideoMetadata[]> {
  const uploadsPlaylistId = await fetchUploadsPlaylistId(input.accessToken, input.channelId);
  const videoIds: string[] = [];
  let pageToken: string | undefined;
  const startTime = new Date(`${input.startDate}T00:00:00.000Z`).getTime();
  const endTime = new Date(`${input.endDate}T00:00:00.000Z`).getTime();

  while (true) {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: "50"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(`${YOUTUBE_DATA_API_BASE}/playlistItems?${params}`, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`YouTube playlistItems.list failed: ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      nextPageToken?: string;
      items?: Array<{
        snippet?: {
          publishedAt?: string;
          resourceId?: { videoId?: string };
        };
        contentDetails?: {
          videoId?: string;
          videoPublishedAt?: string;
        };
      }>;
    };
    let reachedOlderVideos = false;

    for (const item of payload.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt;
      const publishedTime = publishedAt ? new Date(publishedAt).getTime() : Number.NaN;

      if (!videoId || Number.isNaN(publishedTime)) continue;
      if (publishedTime < startTime) {
        reachedOlderVideos = true;
        continue;
      }
      if (publishedTime < endTime) {
        videoIds.push(videoId);
      }
    }

    if (!payload.nextPageToken || reachedOlderVideos) {
      break;
    }

    pageToken = payload.nextPageToken;
  }

  return fetchYouTubeVideos(input.accessToken, unique(videoIds));
}

async function fetchUploadsPlaylistId(accessToken: string, channelId: string) {
  const params = new URLSearchParams({
    part: "contentDetails",
    id: channelId,
    maxResults: "1"
  });

  const response = await fetch(`${YOUTUBE_DATA_API_BASE}/channels?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`YouTube channels.list contentDetails failed: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploadsPlaylistId = payload.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error(`Uploads playlist was not found for channel ${channelId}.`);
  }

  return uploadsPlaylistId;
}

function getShortsPlaylistId(channelId: string) {
  if (!channelId.startsWith("UC") || channelId.length <= 2) {
    throw new Error(`Cannot derive Shorts playlist for channel ${channelId}.`);
  }

  return `UUSH${channelId.slice(2)}`;
}

function normalizeAnalyticsRows(report: RawAnalyticsReport): AnalyticsReportRow[] {
  const headers = report.columnHeaders?.map((header) => header.name) ?? [];
  return (report.rows ?? []).map((row) => {
    const normalized: AnalyticsReportRow = {};

    headers.forEach((header, index) => {
      normalized[header] = row[index] ?? null;
    });

    return normalized;
  });
}

function parseOptionalNumber(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseContentOwnerIds(value: string | undefined) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>
) {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(callback))));
  }

  return results;
}
