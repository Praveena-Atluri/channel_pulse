import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock3,
  DollarSign,
  Eye,
  Film,
  PieChart,
  Users
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppLogo } from "@/components/app-logo";
import { CompareFilterChangeBoundary } from "@/components/compare-filter-change-boundary";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/logout-button";
import { ReportDownloadButton } from "@/components/report-download-button";
import { YoutubeChannelSelect } from "@/components/youtube-channel-select";
import { YoutubePdfDownloadButton } from "@/components/youtube-pdf-download-button";
import { YoutubeSubmitButton } from "@/components/youtube-submit-button";
import { YoutubeVideoTable } from "@/components/youtube-video-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccountViewRevenue, getAccountChannelAccess, isAuthConfigured } from "@/lib/auth";
import { CHANNEL_COMPARE_COLUMN_IDS } from "@/lib/channel-compare-report";
import { isLoginSyncFresh } from "@/lib/login-sync-utils";
import { requireCurrentAccount } from "@/lib/server-auth";
import { ensureYoutubeAnalyticsRangeData, getIncompleteYoutubeAnalyticsChannelIds } from "@/lib/youtube-auto-sync";
import { isYouTubeCmsConfigured } from "@/lib/youtube-cms-api";
import {
  getYoutubeComparisonDashboard,
  normalizeYoutubeComparisonFilters,
  type ComparisonChannelBreakdownRow,
  type ComparisonDelta,
  type ContentTypeFilter,
  type VideoPerformanceRow
} from "@/lib/youtube-performance";
import { calculateNetSubscribers, type MetricTotals } from "@/lib/youtube-performance-utils";

export const dynamic = "force-dynamic";

type YoutubeComparisonPageProps = {
  searchParams: Promise<{
    channel?: string;
    contentType?: string;
    primaryStartDate?: string;
    primaryEndDate?: string;
    comparisonStartDate?: string;
    comparisonEndDate?: string;
  }>;
};

const CHANNEL_CHART_COLORS = [
  "#2563eb",
  "#0f766e",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#65a30d",
  "#db2777",
  "#475569",
  "#ea580c"
];
const ANALYTICS_RECENCY_WARNING_DAYS = 3;

export default async function YoutubeComparisonPage({ searchParams }: YoutubeComparisonPageProps) {
  const params = await searchParams;
  const account = await requireCurrentAccount("/compare");
  const canViewRevenue = canAccountViewRevenue(account);
  const filters = normalizeYoutubeComparisonFilters(params);
  let dashboard = await getYoutubeComparisonDashboard(filters, getAccountChannelAccess(account));
  const cmsConfigured = isYouTubeCmsConfigured();
  let autoSyncError = "";

  if (dashboard.schemaReady && cmsConfigured && !isLoginSyncFresh(dashboard.latestSync?.finishedAt)) {
    const channelsToSync = getDashboardSyncChannels(dashboard.filters.channelId, dashboard.channels);
    try {
      await ensureYoutubeAnalyticsRangeData({
        channels: channelsToSync,
        endDate: dashboard.filters.primaryEndDate,
        startDate: dashboard.filters.primaryStartDate,
        storePeriodBreakdowns: false
      });
      await ensureYoutubeAnalyticsRangeData({
        channels: channelsToSync,
        endDate: dashboard.filters.comparisonEndDate,
        startDate: dashboard.filters.comparisonStartDate,
        storePeriodBreakdowns: false
      });
      dashboard = await getYoutubeComparisonDashboard(filters, getAccountChannelAccess(account));
    } catch (error) {
      const isCompleteAfterSync = await hasCompleteComparisonDataAfterSync({
        channels: channelsToSync,
        comparisonEndDate: dashboard.filters.comparisonEndDate,
        comparisonStartDate: dashboard.filters.comparisonStartDate,
        primaryEndDate: dashboard.filters.primaryEndDate,
        primaryStartDate: dashboard.filters.primaryStartDate
      });

      if (isCompleteAfterSync) {
        dashboard = await getYoutubeComparisonDashboard(filters, getAccountChannelAccess(account));
      } else {
        autoSyncError = getErrorMessage(error);
      }
    }
  }
  const selectedChannel = dashboard.channels.find((channel) => channel.channelId === dashboard.filters.channelId);
  const channelLabel = dashboard.filters.channelId === "all" ? "All channels" : selectedChannel?.title ?? "Selected channel";
  const reportChannels = getDashboardSyncChannels(dashboard.filters.channelId, dashboard.channels);
  const compareReportHref = buildCompareReportHref({
    channels: reportChannels,
    comparisonEndDate: dashboard.filters.comparisonEndDate,
    comparisonStartDate: dashboard.filters.comparisonStartDate,
    primaryEndDate: dashboard.filters.primaryEndDate,
    primaryStartDate: dashboard.filters.primaryStartDate
  });
  const canEvaluateDataCoverage = dashboard.schemaReady && cmsConfigured;
  const hasComparisonData = canEvaluateDataCoverage && dashboard.primary.hasData && dashboard.comparison.hasData;
  const canShowComparisonData = hasComparisonData && !autoSyncError;
  const canShowVideoLeaderboards = dashboard.filters.channelId !== "all";
  const canShowChannelBreakdown = dashboard.filters.channelId === "all" && dashboard.channelBreakdown.length > 0;
  const shouldShowRecentDateWarning = hasRecentAnalyticsDate(dashboard.filters);
  const dashboardRenderKey = [
    dashboard.filters.primaryStartDate,
    dashboard.filters.primaryEndDate,
    dashboard.filters.comparisonStartDate,
    dashboard.filters.comparisonEndDate,
    dashboard.filters.channelId,
    dashboard.filters.contentType,
    canShowComparisonData ? "loaded" : "empty",
    autoSyncError,
    Date.now()
  ].join("|");

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
                Range 1: {formatRangeLabel(dashboard.primary.startDate, dashboard.primary.endDate)} compared with Range 2:{" "}
                {formatRangeLabel(dashboard.comparison.startDate, dashboard.comparison.endDate)}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {channelLabel} | {contentTypeLabel(dashboard.filters.contentType)}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Last updated: {formatLastUpdatedLabel(dashboard.latestSync?.finishedAt)}
              </p>
            </div>
          </div>

          <div className="youtube-print-hidden flex items-center gap-2">
            {canViewRevenue ? (
              <ReportDownloadButton
                disabled={!dashboard.schemaReady || !cmsConfigured || reportChannels.length === 0}
                href={compareReportHref}
                idleLabel="Download Compare Excel"
                loadingLabel="Syncing data from YouTube..."
              />
            ) : null}
            {canShowComparisonData ? (
              <YoutubePdfDownloadButton
                filename={`youtube-compare-${dashboard.primary.startDate}-to-${dashboard.primary.endDate}-vs-${dashboard.comparison.startDate}-to-${dashboard.comparison.endDate}-${slugify(channelLabel)}`}
              />
            ) : null}
            <Link
              href="/"
              className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}
            >
              Home
            </Link>
            <LogoutButton />
            <ThemeToggle />
          </div>
        </header>

        {!dashboard.schemaReady ? (
          <StatusPanel
            title="Analytics schema is not ready"
            message="Apply the Channel Pulse Turso schema, then sync the date ranges you want to compare."
          />
        ) : null}

        {!cmsConfigured ? (
          <StatusPanel
            title="YouTube CMS OAuth is not configured"
            message="Add the Google OAuth and YouTube CMS environment values before running a comparison sync."
          />
        ) : null}

        {!isAuthConfigured() ? (
          <StatusPanel
            title="Dashboard login is not enabled"
            message="Configure at least one Channel Pulse account before using this management dashboard."
          />
        ) : null}

        <CompareFilterChangeBoundary
          renderKey={dashboardRenderKey}
          filters={
            <section className="youtube-print-hidden rounded-lg border bg-card/95 p-4 shadow-sm">
              <form className="grid gap-4" action="/compare" method="get">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <DateInput label="Range 1 start" name="primaryStartDate" value={dashboard.filters.primaryStartDate} />
                  <DateInput label="Range 1 end" name="primaryEndDate" value={dashboard.filters.primaryEndDate} />
                  <DateInput label="Range 2 start" name="comparisonStartDate" value={dashboard.filters.comparisonStartDate} />
                  <DateInput label="Range 2 end" name="comparisonEndDate" value={dashboard.filters.comparisonEndDate} />
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(18rem,1.5fr)_minmax(12rem,0.8fr)_auto]">
                  <YoutubeChannelSelect
                    canRefreshChannels={account.role === "admin"}
                    channels={dashboard.channels}
                    disabled={!dashboard.schemaReady || !cmsConfigured}
                    includeAllOption
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

                  <div className="flex items-end">
                    <YoutubeSubmitButton />
                  </div>
                </div>
              </form>
            </section>
          }
        >
          {canEvaluateDataCoverage && (!canShowComparisonData || autoSyncError) ? (
            <StatusPanel
              title="Data is unavailable"
              message={
                autoSyncError ||
                "Channel Pulse could not load data for the selected comparison ranges. The YouTube CMS did not return data for this channel and date range."
              }
            />
          ) : null}

          {shouldShowRecentDateWarning ? (
            <StatusPanel
              title="Recent YouTube Analytics data may still be processing"
              message={`One or more selected dates are within the last ${ANALYTICS_RECENCY_WARNING_DAYS} days. YouTube can take some time to finalize analytics, so this comparison may use cached or partial data until newer metrics are available.`}
            />
          ) : null}

          {canShowComparisonData ? (
            <>
            <section
              className={
                canViewRevenue
                  ? "youtube-report-kpi-grid grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4"
                  : "youtube-report-kpi-grid grid items-start gap-4 md:grid-cols-3"
              }
            >
              <ComparisonMetricCard
                title="Views"
                rangeOneValue={formatCompactNumber(dashboard.deltas.views.current)}
                rangeTwoValue={formatCompactNumber(dashboard.deltas.views.previous)}
                delta={dashboard.deltas.views}
                deltaLabel={formatSignedCompactNumber(dashboard.deltas.views.absolute)}
                icon={Eye}
              />
              <ComparisonMetricCard
                title="Watch Time"
                rangeOneValue={`${formatCompactNumber(dashboard.deltas.watchTime.current / 60)} hrs`}
                rangeTwoValue={`${formatCompactNumber(dashboard.deltas.watchTime.previous / 60)} hrs`}
                delta={dashboard.deltas.watchTime}
                deltaLabel={`${formatSignedCompactNumber(dashboard.deltas.watchTime.absolute / 60)} hrs`}
                icon={Clock3}
              />
              <ComparisonMetricCard
                title="Subscribers"
                rangeOneValue={formatSignedCompactNumber(dashboard.deltas.subscribers.current)}
                rangeTwoValue={formatSignedCompactNumber(dashboard.deltas.subscribers.previous)}
                delta={dashboard.deltas.subscribers}
                deltaLabel={formatSignedCompactNumber(dashboard.deltas.subscribers.absolute)}
                icon={Users}
              />
              {canViewRevenue ? (
                <ComparisonMetricCard
                  title="Estimated Revenue"
                  rangeOneValue={formatCurrency(dashboard.deltas.revenue.current)}
                  rangeTwoValue={formatCurrency(dashboard.deltas.revenue.previous)}
                  delta={dashboard.deltas.revenue}
                  deltaLabel={formatSignedCurrency(dashboard.deltas.revenue.absolute)}
                  icon={DollarSign}
                />
              ) : null}
            </section>

            {canViewRevenue ? (
              <section className="youtube-report-two-col grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <ComparisonTotalsCard primary={dashboard.primary.totals} comparison={dashboard.comparison.totals} />
                <FormatComparisonCard rows={dashboard.contentTypeComparison} />
              </section>
            ) : (
              <section>
                <FormatComparisonCard rows={dashboard.contentTypeComparison} />
              </section>
            )}

            {canShowChannelBreakdown ? (
              <>
                <ChannelAnalyticsCharts rows={dashboard.channelBreakdown} canViewRevenue={canViewRevenue} />
                <ChannelBreakdownTable rows={dashboard.channelBreakdown} canViewRevenue={canViewRevenue} />
              </>
            ) : null}

            {canShowVideoLeaderboards ? (
              <section className="youtube-report-two-col youtube-compare-video-section grid gap-4 xl:grid-cols-2">
                <VideoTable
                  title="Top Viewed Videos In Range 1"
                  rows={toVideoTableRows(dashboard.topViewedRangeOneVideos, "views")}
                  metric="views"
                />
                <VideoTable
                  title="Top Viewed Videos In Range 2"
                  rows={toVideoTableRows(dashboard.topViewedRangeTwoVideos, "views")}
                  metric="views"
                />
              </section>
            ) : null}

            {canShowVideoLeaderboards && canViewRevenue ? (
              <section className="youtube-report-two-col youtube-compare-video-section grid gap-4 xl:grid-cols-2">
                <VideoTable
                  title="Top Revenue Videos In Range 1"
                  rows={toVideoTableRows(dashboard.topRevenueRangeOneVideos, "revenue")}
                  metric="revenue"
                />
                <VideoTable
                  title="Top Revenue Videos In Range 2"
                  rows={toVideoTableRows(dashboard.topRevenueRangeTwoVideos, "revenue")}
                  metric="revenue"
                />
              </section>
            ) : null}

            </>
          ) : null}
        </CompareFilterChangeBoundary>
      </div>
    </main>
  );
}

function ChannelAnalyticsCharts({
  rows,
  canViewRevenue
}: {
  rows: ComparisonChannelBreakdownRow[];
  canViewRevenue: boolean;
}) {
  const pieMetrics = [
    {
      formatter: formatCompactNumber,
      getValue: (row: ComparisonChannelBreakdownRow) => row.primary.views,
      title: "Range 1 View Share"
    },
    {
      formatter: formatCompactNumber,
      getValue: (row: ComparisonChannelBreakdownRow) => row.comparison.views,
      title: "Range 2 View Share"
    },
    ...(canViewRevenue
      ? [
          {
            formatter: formatCurrency,
            getValue: (row: ComparisonChannelBreakdownRow) => row.primary.estimatedRevenue,
            title: "Range 1 Revenue Share"
          },
          {
            formatter: formatCurrency,
            getValue: (row: ComparisonChannelBreakdownRow) => row.comparison.estimatedRevenue,
            title: "Range 2 Revenue Share"
          }
        ]
      : [])
  ];

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <h2 className="text-base font-black">Channel Analytics</h2>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {pieMetrics.map((metric) => (
          <ChannelSharePieChart
            formatter={metric.formatter}
            getValue={metric.getValue}
            key={metric.title}
            rows={rows}
            title={metric.title}
          />
        ))}
      </div>

      <ChannelMetricsByChannel rows={rows} canViewRevenue={canViewRevenue} />
    </section>
  );
}

function ChannelMetricsByChannel({
  rows,
  canViewRevenue
}: {
  rows: ComparisonChannelBreakdownRow[];
  canViewRevenue: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <h3 className="text-base font-black">Each Channel</h3>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((row) => {
          const metrics = [
            {
              delta: row.deltas.views.absolute,
              deltaFormatter: formatSignedCompactNumber,
              formatter: formatCompactNumber,
              icon: Eye,
              label: "Views",
              primary: row.primary.views,
              comparison: row.comparison.views
            },
            {
              delta: row.deltas.watchTime.absolute / 60,
              deltaFormatter: formatSignedCompactNumber,
              formatter: formatCompactNumber,
              icon: Clock3,
              label: "Watch hours",
              primary: row.primary.estimatedMinutesWatched / 60,
              comparison: row.comparison.estimatedMinutesWatched / 60
            },
            {
              delta: row.deltas.subscribers.absolute,
              deltaFormatter: formatSignedCompactNumber,
              formatter: formatSignedCompactNumber,
              icon: Users,
              label: "Net subscribers",
              primary: calculateNetSubscribers(row.primary),
              comparison: calculateNetSubscribers(row.comparison)
            },
            ...(canViewRevenue
              ? [
                  {
                    delta: row.deltas.revenue.absolute,
                    deltaFormatter: formatSignedCurrency,
                    formatter: formatCurrency,
                    icon: DollarSign,
                    label: "Revenue",
                    primary: row.primary.estimatedRevenue,
                    comparison: row.comparison.estimatedRevenue
                  }
                ]
              : [])
          ];

          return (
            <Card className="shadow-sm" key={row.channelId}>
              <CardHeader>
                <CardTitle className="line-clamp-2 text-base">{row.title}</CardTitle>
              </CardHeader>
              <CardContent className={canViewRevenue ? "grid gap-3 md:grid-cols-2" : "grid gap-3 lg:grid-cols-3"}>
                {metrics.map((metric) => (
                  <ChannelMetricBlock
                    comparison={metric.comparison}
                    delta={metric.delta}
                    deltaFormatter={metric.deltaFormatter}
                    formatter={metric.formatter}
                    icon={metric.icon}
                    key={metric.label}
                    label={metric.label}
                    primary={metric.primary}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ChannelMetricBlock({
  comparison,
  delta,
  deltaFormatter,
  formatter,
  icon: Icon,
  label,
  primary
}: {
  comparison: number;
  delta: number;
  deltaFormatter: (value: number) => string;
  formatter: (value: number) => string;
  icon: typeof Eye;
  label: string;
  primary: number;
}) {
  const maxValue = Math.max(Math.abs(primary), Math.abs(comparison), 1);

  return (
    <div className="rounded-md border bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-black">{label}</span>
        </div>
        <span className="grid justify-items-end gap-0.5">
          <span className="text-[10px] font-black uppercase text-muted-foreground">R2-R1</span>
          <span className={`whitespace-nowrap text-xs font-black tabular-nums ${getSignedMetricClass(delta)}`}>
            {deltaFormatter(delta)}
          </span>
        </span>
      </div>

      <div className="mt-3 grid gap-1.5">
        <ChannelMetricRangeBar
          className={primary < 0 ? "bg-red-500" : "bg-primary"}
          label="Range 1"
          maxValue={maxValue}
          value={primary}
          valueLabel={formatter(primary)}
        />
        <ChannelMetricRangeBar
          className={comparison < 0 ? "bg-red-500" : "bg-emerald-500"}
          label="Range 2"
          maxValue={maxValue}
          value={comparison}
          valueLabel={formatter(comparison)}
        />
      </div>
    </div>
  );
}

function ChannelMetricRangeBar({
  className,
  label,
  maxValue,
  value,
  valueLabel
}: {
  className: string;
  label: string;
  maxValue: number;
  value: number;
  valueLabel: string;
}) {
  const width = value === 0 ? 0 : Math.max(2, Math.round((Math.abs(value) / maxValue) * 100));

  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)_6.75rem] items-center gap-2 text-xs">
      <span className="font-semibold text-muted-foreground">{label}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${width}%` }} />
      </div>
      <span className="whitespace-nowrap text-right font-black tabular-nums text-foreground">{valueLabel}</span>
    </div>
  );
}

function ChannelSharePieChart({
  formatter,
  getValue,
  rows,
  title
}: {
  formatter: (value: number) => string;
  getValue: (row: ComparisonChannelBreakdownRow) => number;
  rows: ComparisonChannelBreakdownRow[];
  title: string;
}) {
  const chartRows = rows
    .map((row) => ({
      channelId: row.channelId,
      title: row.title,
      value: Math.max(0, getValue(row))
    }))
    .sort((left, right) => right.value - left.value);
  const positiveRows = chartRows.filter((row) => row.value > 0);
  const total = chartRows.reduce((sum, row) => sum + row.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PieChart className="size-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-center">
        <div className="relative mx-auto size-36">
          <svg className="size-36 -rotate-90" viewBox="0 0 140 140" role="img" aria-label={title}>
            <circle cx="70" cy="70" fill="none" r={radius} stroke="currentColor" strokeWidth="18" className="text-muted" />
            {total > 0
              ? positiveRows.map((row, index) => {
                  const segmentLength = (row.value / total) * circumference;
                  const segment = (
                    <circle
                      cx="70"
                      cy="70"
                      fill="none"
                      key={row.channelId}
                      r={radius}
                      stroke={getChannelChartColor(index)}
                      strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                      strokeDashoffset={-offset}
                      strokeLinecap="butt"
                      strokeWidth="18"
                    />
                  );
                  offset += segmentLength;
                  return segment;
                })
              : null}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Total</p>
              <p className="text-lg font-black tabular-nums">{formatter(total)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-background/70">
          {chartRows.map((row, index) => {
            const percent = total > 0 ? (row.value / total) * 100 : 0;

            return (
              <div className="flex items-center gap-3 border-b px-3 py-2 text-xs last:border-b-0" key={row.channelId}>
                <span
                  className="size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: row.value > 0 ? getChannelChartColor(index) : "hsl(var(--muted))" }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{row.title}</span>
                <span className="whitespace-nowrap font-black tabular-nums">{formatter(row.value)}</span>
                <span className="w-12 text-right font-black tabular-nums text-muted-foreground">
                  {formatPercent(percent)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelBreakdownTable({
  rows,
  canViewRevenue
}: {
  rows: ComparisonChannelBreakdownRow[];
  canViewRevenue: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-primary" />
          Channel Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className={canViewRevenue ? "w-full min-w-[84rem] text-sm" : "w-full min-w-[64rem] text-sm"}>
          <thead>
            <tr className="border-b text-xs font-black uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Channel</th>
              <th className="px-3 py-2 text-right">Range 1 Views</th>
              <th className="px-3 py-2 text-right">Range 2 Views</th>
              <th className="px-3 py-2 text-right">R2-R1 Views</th>
              <th className="px-3 py-2 text-right">Range 1 Watch Hrs</th>
              <th className="px-3 py-2 text-right">Range 2 Watch Hrs</th>
              <th className="px-3 py-2 text-right">R2-R1 Watch Hrs</th>
              <th className="px-3 py-2 text-right">Range 1 Subs</th>
              <th className="px-3 py-2 text-right">Range 2 Subs</th>
              <th className="px-3 py-2 text-right">R2-R1 Subs</th>
              {canViewRevenue ? (
                <>
                  <th className="px-3 py-2 text-right">Range 1 Revenue</th>
                  <th className="px-3 py-2 text-right">Range 2 Revenue</th>
                  <th className="px-3 py-2 text-right">R2-R1 Revenue</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const primarySubscribers = calculateNetSubscribers(row.primary);
              const comparisonSubscribers = calculateNetSubscribers(row.comparison);

              return (
                <tr key={row.channelId} className="bg-background/60">
                  <td className="max-w-[18rem] px-3 py-3 align-middle font-semibold text-foreground">
                    <span className="line-clamp-2">{row.title}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {formatCompactNumber(row.primary.views)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {formatCompactNumber(row.comparison.views)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 text-right font-black tabular-nums ${getSignedMetricClass(
                      row.deltas.views.absolute
                    )}`}
                  >
                    {formatSignedCompactNumber(row.deltas.views.absolute)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {formatCompactNumber(row.primary.estimatedMinutesWatched / 60)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {formatCompactNumber(row.comparison.estimatedMinutesWatched / 60)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 text-right font-black tabular-nums ${getSignedMetricClass(
                      row.deltas.watchTime.absolute
                    )}`}
                  >
                    {formatSignedCompactNumber(row.deltas.watchTime.absolute / 60)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {formatSignedCompactNumber(primarySubscribers)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {formatSignedCompactNumber(comparisonSubscribers)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 text-right font-black tabular-nums ${getSignedMetricClass(
                      row.deltas.subscribers.absolute
                    )}`}
                  >
                    {formatSignedCompactNumber(row.deltas.subscribers.absolute)}
                  </td>
                  {canViewRevenue ? (
                    <>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(row.primary.estimatedRevenue)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(row.comparison.estimatedRevenue)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-3 text-right font-black tabular-nums ${getSignedMetricClass(
                          row.deltas.revenue.absolute
                        )}`}
                      >
                        {formatSignedCurrency(row.deltas.revenue.absolute)}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function DateInput({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
      {label}
      <input
        className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
        name={name}
        type="date"
        defaultValue={value}
      />
    </label>
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

function ComparisonMetricCard({
  title,
  rangeOneValue,
  rangeTwoValue,
  delta,
  deltaLabel,
  icon: Icon
}: {
  title: string;
  rangeOneValue: string;
  rangeTwoValue: string;
  delta: ComparisonDelta;
  deltaLabel: string;
  icon: typeof Eye;
}) {
  const isPositive = delta.absolute >= 0;
  const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-secondary p-2 text-primary">
              <Icon className="size-5" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">{title}</p>
          </div>
          <Badge variant={isPositive ? "secondary" : "outline"} className="gap-1 rounded-md">
            <TrendIcon className="size-3" />
            {formatSignedPercent(delta.percent)}
          </Badge>
        </div>

        <div className="mt-4 grid gap-2">
          <ComparisonValueRow label="Range 1" value={rangeOneValue} />
          <ComparisonValueRow label="Range 2" value={rangeTwoValue} />
          <ComparisonValueRow label="R2-R1" value={deltaLabel} emphasized tone={isPositive ? "positive" : "negative"} />
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonValueRow({
  label,
  value,
  emphasized = false,
  tone = "neutral"
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  tone?: "neutral" | "positive" | "negative";
}) {
  const rowClass =
    emphasized && tone === "positive"
      ? "rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30"
      : emphasized && tone === "negative"
        ? "rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
        : emphasized
          ? "rounded-lg border border-primary/40 bg-primary/10 p-3"
          : "rounded-lg border bg-background/70 p-3";
  const valueClass =
    emphasized && tone === "positive"
      ? "text-lg font-black text-emerald-700 dark:text-emerald-300"
      : emphasized && tone === "negative"
        ? "text-lg font-black text-red-700 dark:text-red-300"
        : emphasized
          ? "text-lg font-black text-foreground"
          : "text-base font-black text-foreground";

  return (
    <div className={rowClass}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className={valueClass}>{value}</span>
      </div>
    </div>
  );
}

function ComparisonTotalsCard({ primary, comparison }: { primary: MetricTotals; comparison: MetricTotals }) {
  const rows = [
    {
      label: "Estimated revenue",
      primary: formatCurrency(primary.estimatedRevenue),
      comparison: formatCurrency(comparison.estimatedRevenue),
      difference: formatSignedCurrency(comparison.estimatedRevenue - primary.estimatedRevenue),
      differenceValue: comparison.estimatedRevenue - primary.estimatedRevenue
    },
    {
      label: "Estimated ad revenue",
      primary: formatCurrency(primary.estimatedAdRevenue),
      comparison: formatCurrency(comparison.estimatedAdRevenue),
      difference: formatSignedCurrency(comparison.estimatedAdRevenue - primary.estimatedAdRevenue),
      differenceValue: comparison.estimatedAdRevenue - primary.estimatedAdRevenue
    },
    {
      label: "Gross revenue",
      primary: formatCurrency(primary.grossRevenue),
      comparison: formatCurrency(comparison.grossRevenue),
      difference: formatSignedCurrency(comparison.grossRevenue - primary.grossRevenue),
      differenceValue: comparison.grossRevenue - primary.grossRevenue
    },
    {
      label: "Monetized playbacks",
      primary: formatCompactNumber(primary.monetizedPlaybacks),
      comparison: formatCompactNumber(comparison.monetizedPlaybacks),
      difference: formatSignedCompactNumber(comparison.monetizedPlaybacks - primary.monetizedPlaybacks),
      differenceValue: comparison.monetizedPlaybacks - primary.monetizedPlaybacks
    },
    {
      label: "Ad impressions",
      primary: formatCompactNumber(primary.adImpressions),
      comparison: formatCompactNumber(comparison.adImpressions),
      difference: formatSignedCompactNumber(comparison.adImpressions - primary.adImpressions),
      differenceValue: comparison.adImpressions - primary.adImpressions
    },
    {
      label: "Playback CPM",
      primary: formatCurrency(calculatePlaybackCpm(primary)),
      comparison: formatCurrency(calculatePlaybackCpm(comparison)),
      difference: formatSignedCurrency(calculatePlaybackCpm(comparison) - calculatePlaybackCpm(primary)),
      differenceValue: calculatePlaybackCpm(comparison) - calculatePlaybackCpm(primary)
    }
  ];

  return (
    <Card className="youtube-revenue-comparison-card shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-primary" />
          Revenue Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="youtube-revenue-comparison-content space-y-2 overflow-x-auto">
        <div className="youtube-revenue-comparison-header grid min-w-[44rem] grid-cols-[minmax(12rem,1fr)_8rem_8rem_8.5rem] items-center gap-4 px-3 text-xs font-semibold text-muted-foreground">
          <span>Metric</span>
          <span className="text-right">Range 1</span>
          <span className="text-right">Range 2</span>
          <span className="text-right">R2-R1</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.label}
            className="youtube-revenue-comparison-row grid min-w-[44rem] grid-cols-[minmax(12rem,1fr)_8rem_8rem_8.5rem] items-center gap-4 rounded-lg border bg-background/70 p-3"
          >
            <span className="text-sm font-semibold text-muted-foreground">{row.label}</span>
            <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-foreground">{row.primary}</span>
            <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-foreground">
              {row.comparison}
            </span>
            <span
              className={
                row.differenceValue >= 0
                  ? "whitespace-nowrap text-right text-sm font-black tabular-nums text-emerald-700 dark:text-emerald-300"
                  : "whitespace-nowrap text-right text-sm font-black tabular-nums text-red-700 dark:text-red-300"
              }
            >
              {row.difference}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FormatComparisonCard({
  rows
}: {
  rows: Array<{
    contentType: ContentTypeFilter;
    primaryViews: number;
    comparisonViews: number;
    viewsDelta: number;
    primaryRevenue: number;
    comparisonRevenue: number;
    revenueDelta: number;
  }>;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Film className="size-4 text-primary" />
          Format Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length > 0 ? (
          rows.map((row) => {
            const rowMaxViews = Math.max(row.primaryViews, row.comparisonViews, 1);

            return (
              <div key={row.contentType} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">{contentTypeLabel(row.contentType)}</span>
                  <span className="text-muted-foreground">{formatSignedCompactNumber(row.viewsDelta)} views</span>
                </div>
                <ComparisonBar label="Range 1" value={row.primaryViews} max={rowMaxViews} />
                <ComparisonBar label="Range 2" value={row.comparisonViews} max={rowMaxViews} muted />
              </div>
            );
          })
        ) : (
          <p className="rounded-lg border bg-background/70 p-4 text-sm text-muted-foreground">
            No format split is available for these filters.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ComparisonBar({ label, value, max, muted = false }: { label: string; value: number; max: number; muted?: boolean }) {
  const width = value <= 0 ? 0 : Math.max(2, Math.round((value / max) * 100));

  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={muted ? "h-full rounded-full bg-muted-foreground/40" : "h-full rounded-full bg-primary"}
          style={{ width: `${width}%` }}
        />
      </div>
      <span>{formatCompactNumber(value)}</span>
    </div>
  );
}

function VideoTable({ metric: _metric, ...props }: Parameters<typeof YoutubeVideoTable>[0] & { metric?: "views" | "revenue" }) {
  return <YoutubeVideoTable {...props} />;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function StatusPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="youtube-print-hidden rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-black">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

function getDashboardSyncChannels(channelId: string, channels: Array<{ channelId: string }>) {
  if (channelId === "all") return channels;
  return channels.filter((channel) => channel.channelId === channelId);
}

function buildCompareReportHref({
  channels,
  comparisonEndDate,
  comparisonStartDate,
  primaryEndDate,
  primaryStartDate
}: {
  channels: Array<{ channelId: string }>;
  comparisonEndDate: string;
  comparisonStartDate: string;
  primaryEndDate: string;
  primaryStartDate: string;
}) {
  const query = new URLSearchParams({
    comparisonEndDate,
    comparisonStartDate,
    primaryEndDate,
    primaryStartDate,
    report: "channel-compare"
  });

  for (const channel of channels) {
    query.append("channel", channel.channelId);
  }

  for (const columnId of CHANNEL_COMPARE_COLUMN_IDS) {
    query.append("column", columnId);
  }

  return `/api/reports/monthly?${query.toString()}`;
}

async function hasCompleteComparisonDataAfterSync({
  channels,
  primaryStartDate,
  primaryEndDate,
  comparisonStartDate,
  comparisonEndDate
}: {
  channels: Array<{ channelId: string }>;
  primaryStartDate: string;
  primaryEndDate: string;
  comparisonStartDate: string;
  comparisonEndDate: string;
}) {
  try {
    const [primaryMissingChannelIds, comparisonMissingChannelIds] = await Promise.all([
      getIncompleteYoutubeAnalyticsChannelIds({
        channels,
        endDate: primaryEndDate,
        startDate: primaryStartDate
      }),
      getIncompleteYoutubeAnalyticsChannelIds({
        channels,
        endDate: comparisonEndDate,
        startDate: comparisonStartDate
      })
    ]);

    return primaryMissingChannelIds.length === 0 && comparisonMissingChannelIds.length === 0;
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Automatic data sync failed.";
}

function contentTypeLabel(value: ContentTypeFilter) {
  if (value === "short") return "Short form";
  if (value === "long") return "Long form";
  if (value === "live") return "Live";
  if (value === "unknown") return "Unclassified / other";
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

function hasRecentAnalyticsDate(filters: {
  primaryStartDate: string;
  primaryEndDate: string;
  comparisonStartDate: string;
  comparisonEndDate: string;
}) {
  const today = getIndiaDateKey();
  const recentCutoff = addDaysToDateKey(today, -ANALYTICS_RECENCY_WARNING_DAYS);

  return (
    dateRangesOverlap(filters.primaryStartDate, filters.primaryEndDate, recentCutoff, today) ||
    dateRangesOverlap(filters.comparisonStartDate, filters.comparisonEndDate, recentCutoff, today)
  );
}

function dateRangesOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return firstStart <= secondEnd && secondStart <= firstEnd;
}

function getIndiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatRangeLabel(startDate: string, endDate: string) {
  return `${formatDateLabel(startDate)} to ${formatDateLabel(endDate)}`;
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${value}T00:00:00.000Z`)
  );
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

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatSignedCompactNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    signDisplay: "exceptZero",
    maximumFractionDigits: 1
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatSignedCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "USD",
    signDisplay: "exceptZero",
    maximumFractionDigits: 2
  }).format(value);
}

function getSignedMetricClass(value: number) {
  return value >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300";
}

function getChannelChartColor(index: number) {
  return CHANNEL_CHART_COLORS[index % CHANNEL_CHART_COLORS.length];
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function toVideoTableRows(rows: VideoPerformanceRow[], metric: "views" | "revenue") {
  return rows.map((row) => ({
    videoId: row.videoId,
    title: row.title,
    value: metric === "revenue" ? formatCurrency(row.estimatedRevenue) : formatCompactNumber(row.views),
    subvalue: `${formatCompactNumber(row.estimatedMinutesWatched / 60)} hrs`,
    meta: [row.channelTitle, contentTypeLabel(row.contentType)]
  }));
}

function calculatePlaybackCpm(totals: MetricTotals) {
  if (totals.monetizedPlaybacks > 0) {
    return (totals.estimatedRevenue / totals.monetizedPlaybacks) * 1000;
  }

  return totals.playbackBasedCpm;
}
