import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock3,
  DollarSign,
  Eye,
  Film,
  Globe2,
  Target,
  TrendingUp,
  Users
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppLogo } from "@/components/app-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/logout-button";
import { YoutubeAutoSubmitForm } from "@/components/youtube-auto-submit-form";
import { YoutubeChannelSelect } from "@/components/youtube-channel-select";
import { YoutubeFilterLoadingBoundary } from "@/components/youtube-filter-loading-boundary";
import { YoutubePdfDownloadButton } from "@/components/youtube-pdf-download-button";
import { YoutubeVideoTable } from "@/components/youtube-video-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccountViewRevenue, getAccountChannelAccess, isAuthConfigured } from "@/lib/auth";
import {
  MONTHLY_TARGET_METRICS,
  getTargetBaselineMonth,
  type MonthlyTargetMetric
} from "@/lib/monthly-target-metrics";
import { getMonthlyTargetDashboardDataSafe, type MonthlyTargetDashboardData } from "@/lib/monthly-targets";
import { requireCurrentAccount } from "@/lib/server-auth";
import { ensureYoutubeAnalyticsRangeData, getIncompleteYoutubeAnalyticsChannelIds } from "@/lib/youtube-auto-sync";
import { isYouTubeCmsConfigured } from "@/lib/youtube-cms-api";
import {
  getYoutubePerformanceDashboard,
  normalizeYoutubePerformanceFilters,
  type CountryRevenueRow,
  type ContentTypeFilter,
  type VideoPerformanceRow
} from "@/lib/youtube-performance";
import {
  calculateNetSubscribers,
  getMonthDateRange,
  type MetricTotals
} from "@/lib/youtube-performance-utils";

export const dynamic = "force-dynamic";

type YoutubePerformancePageProps = {
  searchParams: Promise<{
    month?: string;
    channel?: string;
    contentType?: string;
  }>;
};

export default async function YoutubePerformancePage({ searchParams }: YoutubePerformancePageProps) {
  const params = await searchParams;
  const account = await requireCurrentAccount("/monthly");
  const canViewRevenue = canAccountViewRevenue(account);
  const filters = normalizeYoutubePerformanceFilters({
    month: params.month,
    channel: params.channel,
    contentType: params.contentType
  });
  let dashboard = await getYoutubePerformanceDashboard(filters, getAccountChannelAccess(account));
  const cmsConfigured = isYouTubeCmsConfigured();
  const selectedMonthRange = getMonthDateRange(dashboard.selectedMonth);
  const previousMonthRange = getMonthDateRange(dashboard.previousMonth);
  let autoSyncError = "";

  if (dashboard.schemaReady && cmsConfigured) {
    const channelsToSync = getDashboardSyncChannels(dashboard.filters.channelId, dashboard.channels);
    try {
      await Promise.all([
        ensureYoutubeAnalyticsRangeData({
          channels: channelsToSync,
          endDate: selectedMonthRange.analyticsEndDate,
          startDate: selectedMonthRange.startDate
        }),
        ensureYoutubeAnalyticsRangeData({
          channels: channelsToSync,
          endDate: previousMonthRange.analyticsEndDate,
          startDate: previousMonthRange.startDate
        })
      ]);
      dashboard = await getYoutubePerformanceDashboard(filters, getAccountChannelAccess(account));
    } catch (error) {
      const isCompleteAfterSync = await hasCompleteMonthlyDataAfterSync({
        channels: channelsToSync,
        previousEndDate: previousMonthRange.analyticsEndDate,
        previousStartDate: previousMonthRange.startDate,
        selectedEndDate: selectedMonthRange.analyticsEndDate,
        selectedStartDate: selectedMonthRange.startDate
      });

      if (isCompleteAfterSync) {
        dashboard = await getYoutubePerformanceDashboard(filters, getAccountChannelAccess(account));
      } else {
        autoSyncError = getErrorMessage(error);
      }
    }
  }

  const netSubscribers = calculateNetSubscribers(dashboard.channelSubscriberTotals);
  const selectedChannel = dashboard.channels.find((channel) => channel.channelId === dashboard.filters.channelId);
  const canEvaluateDataCoverage = dashboard.schemaReady && cmsConfigured;
  const hasComparisonData = canEvaluateDataCoverage && dashboard.hasSelectedMonthData && dashboard.hasPreviousMonthData;
  const canShowComparisonData = hasComparisonData && !autoSyncError;
  const videoMetricsMessage =
    "Video-level performance is unavailable for this CMS API connection, so channel-level and format-level metrics are shown above.";
  const dashboardRenderKey = [
    dashboard.selectedMonth,
    dashboard.previousMonth,
    dashboard.filters.channelId,
    dashboard.filters.contentType,
    canShowComparisonData ? "loaded" : "empty",
    autoSyncError,
    Date.now()
  ].join("|");
  const monthlyTargetData =
    dashboard.schemaReady && canEvaluateDataCoverage
      ? await getMonthlyTargetDashboardDataSafe({
          baselineMonth: getTargetBaselineMonth(dashboard.selectedMonth),
          channels: getDashboardSyncChannels(dashboard.filters.channelId, dashboard.channels),
          month: dashboard.selectedMonth
        })
      : null;
  const hasMonthlyTargets = Boolean(
    monthlyTargetData?.schemaReady &&
      MONTHLY_TARGET_METRICS.some((metric) => monthlyTargetData.totals.target[metric.key] !== null)
  );

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Channel Pulse</h1>
                <Badge variant="secondary" className="rounded-md">
                  CMS Analytics
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {canViewRevenue
                  ? "Monthly management view for views, subscribers, revenue, and video performance."
                  : "Monthly management view for views, watch time, subscribers, and video performance."}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {selectedChannel?.title ?? "Selected channel"} | {formatMonthLabel(dashboard.selectedMonth)} |{" "}
                {contentTypeLabel(dashboard.filters.contentType)}
              </p>
            </div>
          </div>

          <div className="youtube-print-hidden flex items-center gap-2">
            {canShowComparisonData ? (
              <YoutubePdfDownloadButton
                filename={`youtube-monthly-${dashboard.selectedMonth}-${slugify(selectedChannel?.title ?? "channel")}`}
              />
            ) : null}
            <Link href="/" className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}>
              Home
            </Link>
            <LogoutButton />
            <ThemeToggle />
          </div>
        </header>

        {!dashboard.schemaReady ? (
          <StatusPanel
            title="Analytics schema is not ready"
            message="Apply the Supabase migration in supabase/migrations/youtube_performance_schema.sql, then run an on-demand sync to populate this dashboard."
          />
        ) : null}

        {!cmsConfigured ? (
          <StatusPanel
            title="YouTube CMS OAuth is not configured"
            message="Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOUTUBE_OAUTH_REFRESH_TOKEN, and one or more comma-separated YOUTUBE_CONTENT_OWNER_ID values before running the sync."
          />
        ) : null}

        {!isAuthConfigured() ? (
          <StatusPanel
            title="Dashboard login is not enabled"
            message="Configure at least one Channel Pulse account before using this management dashboard."
          />
        ) : null}

        <section className="youtube-print-hidden rounded-lg border bg-card/95 p-4 shadow-sm">
          <YoutubeAutoSubmitForm action="/monthly" className="grid gap-3 md:grid-cols-3">
            <FilterSelect label="Month" name="month" value={dashboard.selectedMonth}>
              {dashboard.availableMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </FilterSelect>

            <YoutubeChannelSelect
              canRefreshChannels={account.role === "admin"}
              channels={dashboard.channels}
              disabled={!dashboard.schemaReady || !cmsConfigured}
              name="channel"
              value={dashboard.filters.channelId}
            />

            <FilterSelect label="Format" name="contentType" value={dashboard.filters.contentType}>
              {getContentTypeOptions(dashboard.availableContentTypes, dashboard.filters.contentType).map((option) => (
                <option key={option} value={option}>
                  {contentTypeLabel(option)}
                </option>
              ))}
            </FilterSelect>
          </YoutubeAutoSubmitForm>
        </section>

        <YoutubeFilterLoadingBoundary
          renderKey={dashboardRenderKey}
        >
          {canEvaluateDataCoverage && (!canShowComparisonData || autoSyncError) ? (
            <StatusPanel
              title="Data is unavailable"
              message={
                autoSyncError ||
                "Channel Pulse could not load data for the selected range. The YouTube CMS did not return data for this channel and date range."
              }
            />
          ) : null}

          {canShowComparisonData ? (
            <>
              <section className="youtube-report-kpi-grid grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  title="Views"
                  value={formatCompactNumber(dashboard.currentTotals.views)}
                  detail={`${formatSignedPercent(dashboard.growth.views)} vs ${formatMonthLabel(dashboard.previousMonth)}`}
                  icon={Eye}
                  trend={dashboard.growth.views}
                />
                <MetricCard
                  title="Watch Time"
                  value={`${formatCompactNumber(dashboard.currentTotals.estimatedMinutesWatched / 60)} hrs`}
                  detail={`${formatSignedPercent(dashboard.growth.watchTime)} vs ${formatMonthLabel(dashboard.previousMonth)}`}
                  icon={Clock3}
                  trend={dashboard.growth.watchTime}
                />
                <MetricCard
                  title="Subscribers"
                  value={formatSignedNumber(netSubscribers)}
                  detail={`${formatSignedPercent(dashboard.growth.netSubscribers)} net growth`}
                  icon={Users}
                  trend={dashboard.growth.netSubscribers}
                />
                {canViewRevenue ? (
                  <MetricCard
                    title="Estimated Revenue"
                    value={formatCurrency(dashboard.currentTotals.estimatedRevenue)}
                    detail={`${formatSignedPercent(dashboard.growth.revenue)} vs ${formatMonthLabel(dashboard.previousMonth)}`}
                    icon={DollarSign}
                    trend={dashboard.growth.revenue}
                  />
                ) : (
                  <LongShortViewsCard rows={dashboard.longShortSplit} compact />
                )}
              </section>

              {hasMonthlyTargets && monthlyTargetData ? (
                <TargetProgressCard
                  channelLabel={dashboard.filters.channelId === "all" ? "All channels" : selectedChannel?.title ?? "Selected channel"}
                  data={monthlyTargetData}
                />
              ) : null}

              {canViewRevenue ? (
                <section className="youtube-report-two-col grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <BarChart3 className="size-4 text-primary" />
                        Revenue Split
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <MiniMetric label="Estimated revenue" value={formatCurrency(dashboard.currentTotals.estimatedRevenue)} />
                      <MiniMetric label="Estimated ad revenue" value={formatCurrency(dashboard.currentTotals.estimatedAdRevenue)} />
                      <MiniMetric label="Gross revenue" value={formatCurrency(dashboard.currentTotals.grossRevenue)} />
                      <MiniMetric label="Monetized playbacks" value={formatCompactNumber(dashboard.currentTotals.monetizedPlaybacks)} />
                      <MiniMetric label="Ad impressions" value={formatCompactNumber(dashboard.currentTotals.adImpressions)} />
                      <MiniMetric label="Playback CPM" value={formatCurrency(calculatePlaybackCpm(dashboard.currentTotals))} />
                    </CardContent>
                  </Card>

                  <LongShortViewsCard rows={dashboard.longShortSplit} />
                </section>
              ) : null}

              {canViewRevenue ? (
                <section>
                  <CountryRevenueCard
                    rows={dashboard.countryRevenueBreakdown}
                    totalRevenue={dashboard.currentTotals.estimatedRevenue}
                  />
                </section>
              ) : null}

              <section className="youtube-report-two-col grid gap-4 md:grid-cols-2">
                <CohortCard
                  title="Old Videos Performance"
                  totals={dashboard.cohortSummary.old}
                  icon={TrendingUp}
                  canViewRevenue={canViewRevenue}
                  unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                />
                <CohortCard
                  title="Last Two Months Videos"
                  totals={dashboard.cohortSummary.recent}
                  icon={CalendarDays}
                  canViewRevenue={canViewRevenue}
                  unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                />
              </section>

              {canViewRevenue ? (
                <>
                  <section className="youtube-report-three-col grid gap-4 xl:grid-cols-3">
                    <VideoTable
                      title="Old Video Leaders"
                      rows={toVideoTableRows(dashboard.oldVideoLeaders, "views", { showCohort: true })}
                      metric="views"
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                    <VideoTable
                      title="Least Viewed Recent Videos"
                      rows={toVideoTableRows(dashboard.leastViewedRecentVideos, "views", { showCohort: true })}
                      metric="views"
                      ascending
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                    <VideoTable
                      title="Last Two Months Leaders"
                      rows={toVideoTableRows(dashboard.recentVideoLeaders, "views", { showCohort: true })}
                      metric="views"
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                  </section>

                  <section className="youtube-report-two-col grid gap-4 xl:grid-cols-2">
                    <VideoTable
                      title="Most Viewed Videos This Month"
                      rows={toVideoTableRows(dashboard.topViewedVideos, "views", { showCohort: true })}
                      metric="views"
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                    <VideoTable
                      title="Most Revenue Generating Videos"
                      rows={toVideoTableRows(dashboard.topRevenueVideos, "revenue", { showCohort: true })}
                      metric="revenue"
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                  </section>
                </>
              ) : (
                <>
                  <section className="youtube-report-two-col grid gap-4 xl:grid-cols-2">
                    <VideoTable
                      title="Old Video Leaders"
                      rows={toVideoTableRows(dashboard.oldVideoLeaders, "views", { showCohort: true })}
                      metric="views"
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                    <VideoTable
                      title="Last Two Months Leaders"
                      rows={toVideoTableRows(dashboard.recentVideoLeaders, "views", { showCohort: true })}
                      metric="views"
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                  </section>

                  <section className="youtube-report-two-col grid gap-4 xl:grid-cols-2">
                    <VideoTable
                      title="Least Viewed Recent Videos"
                      rows={toVideoTableRows(dashboard.leastViewedRecentVideos, "views", { showCohort: true })}
                      metric="views"
                      ascending
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                    <VideoTable
                      title="Most Viewed Videos This Month"
                      rows={toVideoTableRows(dashboard.topViewedVideos, "views", { showCohort: true })}
                      metric="views"
                      unavailableMessage={!dashboard.videoMetricsAvailable ? videoMetricsMessage : null}
                    />
                  </section>
                </>
              )}

            </>
          ) : null}
        </YoutubeFilterLoadingBoundary>
      </div>
    </main>
  );
}

function FilterSelect({
  label,
  name,
  value,
  children
}: {
  label: string;
  name: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  trend
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Eye;
  trend?: number;
}) {
  const isPositive = (trend ?? 0) >= 0;
  const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="rounded-lg bg-secondary p-2 text-primary">
            <Icon className="size-5" />
          </div>
          {trend !== undefined ? (
            <Badge variant={isPositive ? "secondary" : "outline"} className="gap-1 rounded-md">
              <TrendIcon className="size-3" />
              {formatSignedPercent(trend)}
            </Badge>
          ) : null}
        </div>
        <p className="mt-4 text-sm font-semibold text-muted-foreground">{title}</p>
        <p className="mt-1 text-3xl font-black">{value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function LongShortViewsCard({
  rows,
  compact = false
}: {
  rows: Array<{ contentType: ContentTypeFilter; views: number }>;
  compact?: boolean;
}) {
  const body = (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      {rows.length > 0 ? (
        rows.map((item) => (
          <div key={item.contentType} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 font-semibold capitalize">{contentTypeLabel(item.contentType)}</span>
              <span className="whitespace-nowrap tabular-nums">{formatCompactNumber(item.views)} views</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${getSplitWidth(item.views, rows)}%` }} />
            </div>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No format split is available for this filter.</p>
      )}
    </div>
  );

  if (compact) {
    return (
      <Card className="h-full shadow-sm">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center gap-2 text-base font-black">
            <Film className="size-4 text-primary" />
            Views breakdown
          </div>
          {body}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Film className="size-4 text-primary" />
          Views breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function CohortCard({
  title,
  totals,
  icon: Icon,
  canViewRevenue,
  unavailableMessage
}: {
  title: string;
  totals: MetricTotals;
  icon: typeof TrendingUp;
  canViewRevenue: boolean;
  unavailableMessage?: string | null;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className={unavailableMessage ? "space-y-3" : "grid gap-3 sm:grid-cols-3"}>
        {unavailableMessage ? (
          <p className="rounded-lg border bg-background/70 p-4 text-sm text-muted-foreground">{unavailableMessage}</p>
        ) : (
          <>
            <MiniMetric label="Views" value={formatCompactNumber(totals.views)} />
            <MiniMetric label="Watch time" value={`${formatCompactNumber(totals.estimatedMinutesWatched / 60)} hrs`} />
            {canViewRevenue ? <MiniMetric label="Revenue" value={formatCurrency(totals.estimatedRevenue)} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CountryRevenueCard({ rows, totalRevenue }: { rows: CountryRevenueRow[]; totalRevenue: number }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="size-4 text-primary" />
          Country Revenue Breakup
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length > 0 ? (
          <div className="min-w-[42rem] space-y-2">
            <div className="grid grid-cols-[minmax(10rem,1fr)_7rem_7rem_6rem_5rem] gap-3 px-3 text-xs font-semibold text-muted-foreground">
              <span>Country</span>
              <span className="text-right">Revenue</span>
              <span className="text-right">Views</span>
              <span className="text-right">RPM</span>
              <span className="text-right">Share</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.countryCode}
                className="grid grid-cols-[minmax(10rem,1fr)_7rem_7rem_6rem_5rem] items-center gap-3 rounded-lg border bg-background/70 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{row.countryName}</p>
                  <p className="text-xs text-muted-foreground">{row.countryCode}</p>
                </div>
                <span className="whitespace-nowrap text-right text-sm font-black tabular-nums">
                  {formatCurrency(row.estimatedRevenue)}
                </span>
                <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-muted-foreground">
                  {formatCompactNumber(row.views)}
                </span>
                <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-muted-foreground">
                  {formatCurrency(calculateRevenuePerThousandViews(row))}
                </span>
                <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-muted-foreground">
                  {formatPercent(calculateRevenueShare(row.estimatedRevenue, totalRevenue))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border bg-background/70 p-4 text-sm text-muted-foreground">
            No country revenue data found for this month. Channel Pulse will load it automatically when the CMS returns country data for this range.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TargetProgressCard({
  channelLabel,
  data
}: {
  channelLabel: string;
  data: MonthlyTargetDashboardData;
}) {
  const visibleMetrics = MONTHLY_TARGET_METRICS.filter((metric) => data.totals.target[metric.key] !== null);

  return (
    <section>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4 text-primary" />
            Target Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleMetrics.map((metric) => {
            const progress = data.totals.progress[metric.key];
            const percent = progress.percent ?? 0;

            return (
              <div className="rounded-lg border bg-background/70 p-3" key={metric.key}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">{metric.label}</p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      {channelLabel} · {formatMonthLabel(data.month)}
                    </p>
                  </div>
                  <Badge variant="secondary" className="rounded-md">
                    {formatPercent(percent)}
                  </Badge>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <TargetMiniMetric label="Actual" value={formatTargetMetricValue(metric.key, progress.actual)} />
                  <TargetMiniMetric label="Target" value={formatTargetMetricValue(metric.key, progress.target ?? 0)} />
                  <TargetMiniMetric label="Remaining" value={formatTargetMetricValue(metric.key, progress.remaining ?? 0)} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}

function TargetMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function VideoTable({ metric: _metric, ...props }: Parameters<typeof YoutubeVideoTable>[0] & { metric?: "views" | "revenue" }) {
  return <YoutubeVideoTable {...props} />;
}

function StatusPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="youtube-print-hidden rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-black">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

function getDashboardSyncChannels<T extends { channelId: string }>(channelId: string, channels: T[]) {
  if (channelId === "all") return channels;
  return channels.filter((channel) => channel.channelId === channelId);
}

async function hasCompleteMonthlyDataAfterSync({
  channels,
  selectedStartDate,
  selectedEndDate,
  previousStartDate,
  previousEndDate
}: {
  channels: Array<{ channelId: string }>;
  selectedStartDate: string;
  selectedEndDate: string;
  previousStartDate: string;
  previousEndDate: string;
}) {
  try {
    const [selectedMissingChannelIds, previousMissingChannelIds] = await Promise.all([
      getIncompleteYoutubeAnalyticsChannelIds({
        channels,
        endDate: selectedEndDate,
        startDate: selectedStartDate
      }),
      getIncompleteYoutubeAnalyticsChannelIds({
        channels,
        endDate: previousEndDate,
        startDate: previousStartDate
      })
    ]);

    return selectedMissingChannelIds.length === 0 && previousMissingChannelIds.length === 0;
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Automatic data sync failed.";
}

function getSplitWidth(views: number, rows: Array<{ views: number }>) {
  const max = Math.max(...rows.map((row) => row.views), 1);
  return Math.max(4, Math.round((views / max) * 100));
}

function contentTypeLabel(value: ContentTypeFilter) {
  if (value === "short") return "Short form";
  if (value === "long") return "Long form";
  if (value === "live") return "Live";
  if (value === "unknown") return "Unknown";
  return "All formats";
}

function getContentTypeOptions(availableContentTypes: ReadonlyArray<ContentTypeFilter>, selected: ContentTypeFilter) {
  const options: ContentTypeFilter[] = ["all", "short", "long"];

  for (const optionalType of ["live", "unknown"] as ContentTypeFilter[]) {
    if (availableContentTypes.includes(optionalType) || selected === optionalType) {
      options.push(optionalType);
    }
  }

  return options;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatSignedNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    signDisplay: "exceptZero",
    maximumFractionDigits: 0
  }).format(value);
}

function formatTargetMetricValue(metric: MonthlyTargetMetric, value: number) {
  if (metric === "watchHours") return `${formatCompactNumber(value)} hrs`;
  if (metric === "netSubscribers") return formatSignedNumber(value);

  return formatCompactNumber(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1))
  );
}

function toVideoTableRows(
  rows: VideoPerformanceRow[],
  metric: "views" | "revenue",
  options: { showCohort?: boolean } = {}
) {
  return rows.map((row) => ({
    videoId: row.videoId,
    title: row.title,
    value: metric === "revenue" ? formatCurrency(row.estimatedRevenue) : formatCompactNumber(row.views),
    subvalue: `${formatCompactNumber(row.estimatedMinutesWatched / 60)} hrs`,
    meta: [row.channelTitle, contentTypeLabel(row.contentType), ...(options.showCohort ? [row.cohort] : [])]
  }));
}

function calculatePlaybackCpm(totals: MetricTotals) {
  if (totals.monetizedPlaybacks > 0) {
    return (totals.estimatedRevenue / totals.monetizedPlaybacks) * 1000;
  }

  return totals.playbackBasedCpm;
}

function calculateRevenuePerThousandViews(totals: Pick<MetricTotals, "estimatedRevenue" | "views">) {
  if (totals.views <= 0) return 0;
  return (totals.estimatedRevenue / totals.views) * 1000;
}

function calculateRevenueShare(revenue: number, totalRevenue: number) {
  if (totalRevenue <= 0) return 0;
  return (revenue / totalRevenue) * 100;
}
