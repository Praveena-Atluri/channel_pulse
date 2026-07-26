import { ExternalLink, Film, Home, LoaderCircle } from "lucide-react";
import Link from "next/link";

import { AppLogo } from "@/components/app-logo";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { YoutubeAutoSubmitForm } from "@/components/youtube-auto-submit-form";
import { YoutubeFilterLoadingBoundary } from "@/components/youtube-filter-loading-boundary";
import { VideoListExcelDownloadButton } from "@/components/video-list-excel-download-button";
import {
  getDailyMetricsDashboardData,
  getDefaultDailyMetricsDate,
  getLatestDailyVideoCatalogSyncAt,
  getMaxDailyMetricsDate,
  normalizeDailyMetricsDate,
  type DailyMetricsVideoRow
} from "@/lib/daily-metrics";
import {
  derivePublishingTargetForDays,
  getDailyPublishingTargetDashboardDataSafe,
  type DailyPublishingTargetDashboardRow
} from "@/lib/daily-targets";
import { canAccountManageDashboard } from "@/lib/auth";
import { getLatestLoginYoutubeSyncState } from "@/lib/login-youtube-sync";
import { requireCurrentAccount } from "@/lib/server-auth";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

type DailyMetricsPageProps = {
  searchParams: Promise<{
    channel?: string;
    date?: string;
  }>;
};

export default async function DailyMetricsPage({ searchParams }: DailyMetricsPageProps) {
  const params = await searchParams;
  const account = await requireCurrentAccount("/daily");

  const channels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const maxDate = getMaxDailyMetricsDate();
  const defaultDate = getDefaultDailyMetricsDate();
  const date = normalizeDailyMetricsDate(params.date, maxDate, defaultDate);
  const requestedChannelId = params.channel || "all";
  const channelId =
    requestedChannelId === "all" || channels.some((channel) => channel.channelId === requestedChannelId)
      ? requestedChannelId
      : "all";
  const targetChannels = channelId === "all" ? channels : channels.filter((channel) => channel.channelId === channelId);
  const targetChannelIds = targetChannels.map((channel) => channel.channelId);
  const [dashboard, latestSync, latestCatalogSyncAt] = await Promise.all([
    getDailyMetricsDashboardData({ channelId, channels, date }),
    getLatestLoginYoutubeSyncState(),
    getLatestDailyVideoCatalogSyncAt(targetChannelIds)
  ]);
  const lastUpdatedAt = latestSync?.syncedAt ?? latestCatalogSyncAt;
  const dailyTargets = await getDailyPublishingTargetDashboardDataSafe({
    actualRows: dashboard.rows,
    channels: targetChannels
  });
  const publishingTargets = getPublishingTargetTotals(dailyTargets.rows);
  const dashboardRenderKey = `${date}:${dashboard.channelId}`;
  const dailyVideoDownloadRows = buildDailyVideoDownloadRows(dashboard.rows);

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Daily Publishing</h1>
                <Badge variant="secondary" className="rounded-md">
                  {canAccountManageDashboard(account) ? "Admin" : "Viewer"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">Published videos categorized as long or short.</p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Last updated: {formatLastUpdatedLabel(lastUpdatedAt)}
                {latestSync?.status === "running" ? " | Syncing now" : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/" className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}>
              <Home className="size-4" />
              Home
            </Link>
            <LogoutButton />
            <ThemeToggle />
          </div>
        </header>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Film className="size-4 text-primary" />
              Daily Published Videos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <YoutubeAutoSubmitForm action="/daily" className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
                Date
                <input
                  className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  max={maxDate}
                  name="date"
                  type="date"
                  defaultValue={date}
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
                Channel
                <select
                  className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  name="channel"
                  defaultValue={dashboard.channelId}
                >
                  <option value="all">All channels</option>
                  {channels.map((channel) => (
                    <option key={channel.channelId} value={channel.channelId}>
                      {channel.title}
                    </option>
                  ))}
                </select>
              </label>
            </YoutubeAutoSubmitForm>
          </CardContent>
        </Card>

        <YoutubeFilterLoadingBoundary fallback={<DailyPublishingLoadingPanel />} renderKey={dashboardRenderKey}>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              label="Long videos published"
              value={formatPublishedTargetValue(dashboard.totals.longVideosPublished, publishingTargets.longVideos)}
              valueClassName={getPublishingTargetClass(dashboard.totals.longVideosPublished, publishingTargets.longVideos)}
              helper={publishingTargets.longVideos === null ? undefined : "Published / target"}
            />
            <SummaryCard
              label="Short videos published"
              value={formatPublishedTargetValue(dashboard.totals.shortVideosPublished, publishingTargets.shortVideos)}
              valueClassName={getPublishingTargetClass(dashboard.totals.shortVideosPublished, publishingTargets.shortVideos)}
              helper={publishingTargets.shortVideos === null ? undefined : "Published / target"}
            />
            {dashboard.totals.unclassifiedVideosPublished > 0 ? (
              <SummaryCard label="Unclassified videos" value={formatCompactNumber(dashboard.totals.unclassifiedVideosPublished)} />
            ) : null}
          </section>

          <Card className="shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">Videos Published On {formatDateLabel(date)}</CardTitle>
                <VideoListExcelDownloadButton
                  disabled={dashboard.rows.length === 0}
                  filename={`channel-pulse-daily-videos-${date}`}
                  rows={dailyVideoDownloadRows}
                  sheetName="Daily Videos"
                />
              </div>
            </CardHeader>
            <CardContent>
              {dashboard.rows.length > 0 ? (
                <div className="grid gap-3">
                  <DailyVideoTable rows={dashboard.rows} />
                </div>
              ) : (
                <div className="rounded-md border bg-muted/30 p-4 text-sm font-semibold text-muted-foreground">
                  No videos are stored as published on this date for the selected channel filter.
                </div>
              )}
            </CardContent>
          </Card>
        </YoutubeFilterLoadingBoundary>
      </div>
    </main>
  );
}

function DailyPublishingLoadingPanel() {
  return (
    <section className="rounded-lg border bg-card/95 p-8 shadow-sm" aria-live="polite">
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
        <LoaderCircle className="size-8 animate-spin text-primary" />
        <div>
          <p className="text-base font-black text-foreground">Loading published videos...</p>
          <p className="text-sm text-muted-foreground">Refreshing the daily publishing view for the selected filter.</p>
        </div>
      </div>
    </section>
  );
}

function DailyVideoTable({ rows }: { rows: DailyMetricsVideoRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-black">Video</th>
            <th className="px-3 py-2 font-black">Channel</th>
            <th className="px-3 py-2 font-black">Format</th>
            <th className="px-3 py-2 font-black">Published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t" key={row.videoId}>
              <td className="px-3 py-2 align-top">
                <div className="flex min-w-0 items-center gap-3">
                  {row.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="h-12 w-20 rounded-md border object-cover"
                      src={row.thumbnailUrl}
                    />
                  ) : (
                    <div className="flex h-12 w-20 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                      <Film className="size-4" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <a
                      className="line-clamp-2 font-bold text-foreground underline-offset-4 hover:text-primary hover:underline"
                      href={getVideoUrl(row.videoId)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {row.title}
                      <ExternalLink className="ml-1 inline size-3 align-[-1px]" />
                    </a>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 align-top font-semibold text-muted-foreground">{row.channelTitle}</td>
              <td className="px-3 py-2 align-top">
                <Badge variant="secondary" className="rounded-md capitalize">
                  {row.contentType}
                </Badge>
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">{formatDateTimeLabel(row.publishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildDailyVideoDownloadRows(rows: DailyMetricsVideoRow[]) {
  return [
    ["Video ID", "Title", "Video URL", "Channel", "Format", "Published"],
    ...rows.map((row) => [
      row.videoId,
      row.title,
      getVideoUrl(row.videoId),
      row.channelTitle,
      row.contentType,
      formatDateTimeLabel(row.publishedAt)
    ])
  ];
}

function getVideoUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function SummaryCard({
  helper,
  label,
  value,
  valueClassName
}: {
  helper?: string;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="text-sm font-bold text-muted-foreground">{label}</div>
        <div className={["mt-2 text-2xl font-black", valueClassName].filter(Boolean).join(" ")}>{value}</div>
        {helper ? <div className="mt-1 text-xs font-bold text-muted-foreground">{helper}</div> : null}
      </CardContent>
    </Card>
  );
}

function filterChannelsForAccount<T extends { channelId: string }>(
  channels: T[],
  account: { channelIds: string[] | null }
) {
  if (account.channelIds === null) return channels;

  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 1,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard"
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatPublishedTargetValue(published: number, target: number | null) {
  if (target === null) return formatNumber(published);
  return `${formatNumber(published)} / ${formatNumber(target)}`;
}

function getPublishingTargetClass(published: number, target: number | null) {
  if (target === null) return undefined;
  return published >= target ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300";
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  }).format(date);
}

function formatDateTimeLabel(value: string | null) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
    year: "numeric"
  }).format(date);
}

function formatLastUpdatedLabel(value: string | null | undefined) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function getPublishingTargetTotals(rows: DailyPublishingTargetDashboardRow[]) {
  const totals = rows.reduce(
    (current, row) => {
      const longVideosTarget = derivePublishingTargetForDays(row.target.longVideos, 1);
      const shortVideosTarget = derivePublishingTargetForDays(row.target.shortVideos, 1);

      if (longVideosTarget !== null) {
        current.longVideos += longVideosTarget;
        current.longTargetCount += 1;
      }

      if (shortVideosTarget !== null) {
        current.shortVideos += shortVideosTarget;
        current.shortTargetCount += 1;
      }

      return current;
    },
    {
      longTargetCount: 0,
      longVideos: 0,
      shortTargetCount: 0,
      shortVideos: 0
    }
  );
  const selectedChannelCount = rows.length;

  return {
    longVideos:
      selectedChannelCount > 0 && totals.longTargetCount === selectedChannelCount ? totals.longVideos : null,
    shortVideos:
      selectedChannelCount > 0 && totals.shortTargetCount === selectedChannelCount ? totals.shortVideos : null
  };
}
