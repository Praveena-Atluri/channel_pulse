import { ExternalLink, Film, Home } from "lucide-react";
import Link from "next/link";

import { AppLogo } from "@/components/app-logo";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccountViewRevenue } from "@/lib/auth";
import {
  getDailyMetricsDashboardData,
  getDefaultDailyMetricsDate,
  getMaxDailyMetricsDate,
  normalizeDailyMetricsDate,
  type DailyMetricsVideoRow
} from "@/lib/daily-metrics";
import {
  getDailyPublishingTargetDashboardDataSafe,
  type DailyPublishingTargetDashboardRow
} from "@/lib/daily-targets";
import { requireCurrentAccount } from "@/lib/server-auth";
import { isYouTubeCmsConfigured } from "@/lib/youtube-cms-api";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { syncYoutubeDailyVideoMetricsForVideos } from "@/lib/youtube-performance-sync";

export const dynamic = "force-dynamic";

type DailyMetricsPageProps = {
  searchParams: Promise<{
    channel?: string;
    date?: string;
  }>;
};

const RECENT_METRIC_FRESHNESS_DAYS = 4;
const REVENUE_PENDING_DAYS = 7;

export default async function DailyMetricsPage({ searchParams }: DailyMetricsPageProps) {
  const params = await searchParams;
  const account = await requireCurrentAccount("/daily");
  const canViewRevenue = canAccountViewRevenue(account);

  const channels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const maxDate = getMaxDailyMetricsDate();
  const defaultDate = getDefaultDailyMetricsDate();
  const date = normalizeDailyMetricsDate(params.date, maxDate, defaultDate);
  const showFreshnessNote = isWithinRecentDays(date, maxDate, RECENT_METRIC_FRESHNESS_DAYS);
  const shouldMarkRevenuePending = canViewRevenue && isWithinRecentDays(date, maxDate, REVENUE_PENDING_DAYS);
  const requestedChannelId = params.channel || "all";
  const channelId =
    requestedChannelId === "all" || channels.some((channel) => channel.channelId === requestedChannelId)
      ? requestedChannelId
      : "all";
  let dashboard = await getDailyMetricsDashboardData({ channelId, channels, date });
  let syncMessage = "";

  if (isYouTubeCmsConfigured()) {
    try {
      const rowsNeedingDailyMetricSync = dashboard.rows.filter(
        (row) => !row.hasDailyMetrics || shouldRefreshPendingRevenue(row, shouldMarkRevenuePending)
      );
      if (rowsNeedingDailyMetricSync.length > 0) {
        await syncMissingDailyVideoMetrics(rowsNeedingDailyMetricSync, date);
        dashboard = await getDailyMetricsDashboardData({ channelId, channels, date });
      }
    } catch (error) {
      syncMessage = getErrorMessage(error);
    }
  }
  const targetChannels =
    dashboard.channelId === "all" ? channels : channels.filter((channel) => channel.channelId === dashboard.channelId);
  const dailyTargets = await getDailyPublishingTargetDashboardDataSafe({
    actualRows: dashboard.rows,
    channels: targetChannels
  });
  const publishingTargets = getPublishingTargetTotals(dailyTargets.rows);

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Daily Metrics</h1>
                <Badge variant="secondary" className="rounded-md">
                  {canViewRevenue ? "Admin" : "Viewer"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {canViewRevenue
                  ? "Published videos with same-day views and revenue from stored CMS metrics."
                  : "Published videos with same-day views from stored CMS metrics."}
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
              Daily Video Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action="/daily" className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="get">
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
              <button className={buttonVariants({ className: "h-11 self-end rounded-md" })} type="submit">
                Apply
              </button>
            </form>
            {showFreshnessNote ? (
              <div className="mt-3 rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
                Views and revenue for recent dates may change because YouTube can take up to 4 days to finalize metrics.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
          <SummaryCard label="Same-day views" value={formatNullableNumber(dashboard.totals.views)} />
          {canViewRevenue ? (
            <SummaryCard
              helper={shouldMarkRevenuePending && isZeroRevenue(dashboard.totals.estimatedRevenue) ? "Revenue can arrive later" : undefined}
              label="Same-day revenue"
              value={formatDailyRevenue(dashboard.totals.estimatedRevenue, shouldMarkRevenuePending)}
            />
          ) : null}
        </section>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Videos Published On {formatDateLabel(date)}</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.rows.length > 0 ? (
              <div className="grid gap-3">
                {dashboard.totals.videosWithDailyMetrics < dashboard.rows.length ? (
                  <div className="rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
                    Same-day metrics are unavailable for{" "}
                    {formatNumber(dashboard.rows.length - dashboard.totals.videosWithDailyMetrics)} of{" "}
                    {formatNumber(dashboard.rows.length)} published videos on this date.
                    {syncMessage ? <span className="mt-1 block">{syncMessage}</span> : null}
                  </div>
                ) : null}
                <DailyVideoTable
                  canViewRevenue={canViewRevenue}
                  rows={dashboard.rows}
                  shouldMarkRevenuePending={shouldMarkRevenuePending}
                />
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-4 text-sm font-semibold text-muted-foreground">
                No long or short videos are stored as published on this date for the selected channel filter.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

async function syncMissingDailyVideoMetrics(rows: DailyMetricsVideoRow[], date: string) {
  const videoIdsByChannelId = new Map<string, string[]>();
  for (const row of rows) {
    const videoIds = videoIdsByChannelId.get(row.channelId) ?? [];
    videoIds.push(row.videoId);
    videoIdsByChannelId.set(row.channelId, videoIds);
  }

  for (const [channelId, videoIds] of videoIdsByChannelId) {
    await syncYoutubeDailyVideoMetricsForVideos({ channelId, date, videoIds });
  }
}

function DailyVideoTable({
  canViewRevenue,
  rows,
  shouldMarkRevenuePending
}: {
  canViewRevenue: boolean;
  rows: DailyMetricsVideoRow[];
  shouldMarkRevenuePending: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[62rem] border-collapse text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-black">Video</th>
            <th className="px-3 py-2 font-black">Channel</th>
            <th className="px-3 py-2 font-black">Format</th>
            <th className="px-3 py-2 text-right font-black">Views</th>
            {canViewRevenue ? <th className="px-3 py-2 text-right font-black">Revenue</th> : null}
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
                      href={`https://www.youtube.com/watch?v=${row.videoId}`}
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
              <td className="px-3 py-2 text-right align-top font-bold tabular-nums">
                {formatNullableNumber(row.views)}
              </td>
              {canViewRevenue ? (
                <td className="px-3 py-2 text-right align-top font-bold tabular-nums">
                  {formatDailyRevenue(row.estimatedRevenue, shouldMarkRevenuePending)}
                </td>
              ) : null}
              <td className="px-3 py-2 align-top text-muted-foreground">{formatDateTimeLabel(row.publishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function formatNullableNumber(value: number | null) {
  return value === null ? "Unavailable" : formatNumber(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

function formatNullableCurrency(value: number | null) {
  return value === null ? "Unavailable" : formatCurrency(value);
}

function formatDailyRevenue(value: number | null, shouldMarkPending: boolean) {
  if (value === null) return "Unavailable";
  if (shouldMarkPending && isZeroRevenue(value)) return "Pending";
  return formatCurrency(value);
}

function isZeroRevenue(value: number | null) {
  return value !== null && Math.abs(value) < 0.000001;
}

function shouldRefreshPendingRevenue(row: DailyMetricsVideoRow, shouldMarkRevenuePending: boolean) {
  return shouldMarkRevenuePending && row.hasDailyMetrics && isZeroRevenue(row.estimatedRevenue);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
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
    year: "numeric"
  }).format(date);
}

function isWithinRecentDays(date: string, today: string, dayCount: number) {
  const selected = new Date(`${date}T00:00:00.000Z`);
  const current = new Date(`${today}T00:00:00.000Z`);
  if (Number.isNaN(selected.getTime()) || Number.isNaN(current.getTime())) return false;

  const ageInDays = Math.floor((current.getTime() - selected.getTime()) / 86_400_000);
  return ageInDays >= 0 && ageInDays < dayCount;
}

function getPublishingTargetTotals(rows: DailyPublishingTargetDashboardRow[]) {
  const totals = rows.reduce(
    (current, row) => {
      if (row.target.longVideos !== null) {
        current.longVideos += row.target.longVideos;
        current.longTargetCount += 1;
      }

      if (row.target.shortVideos !== null) {
        current.shortVideos += row.target.shortVideos;
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Daily video metric sync failed.";
  }
}
