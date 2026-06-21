"use client";

import { AlertTriangle, BarChart3, CheckSquare, LoaderCircle, Search, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ReportDownloadButton } from "@/components/report-download-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";
import type {
  WeeklyMetricComparison,
  WeeklyMetricValues,
  WeeklyPerformanceDashboardData,
  WeeklyTrendPoint
} from "@/lib/weekly-performance";

type WeeklyPerformanceDashboardProps = {
  channels: StoredYoutubeManagedChannel[];
  defaultEndDate: string;
  defaultStartDate: string;
};

type WeeklyPayload = WeeklyPerformanceDashboardData & {
  error?: string;
};

type WeeklyTrendMetricKey = keyof Pick<
  WeeklyMetricValues,
  "estimatedRevenue" | "netSubscribers" | "views" | "watchHours"
>;

const WEEKLY_TREND_METRICS: Array<{
  formatter: (value: number) => string;
  key: WeeklyTrendMetricKey;
  label: string;
}> = [
  { formatter: formatCompactNumber, key: "views", label: "Views" },
  { formatter: formatCompactNumber, key: "watchHours", label: "Watch hours" },
  { formatter: formatSignedNumber, key: "netSubscribers", label: "Net subscribers" },
  { formatter: formatCompactCurrency, key: "estimatedRevenue", label: "Estimated revenue" }
];

export function WeeklyPerformanceDashboard({
  channels,
  defaultEndDate,
  defaultStartDate
}: WeeklyPerformanceDashboardProps) {
  const latestStartDate = useMemo(() => addDaysToDate(defaultEndDate, -6), [defaultEndDate]);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [channelSearch, setChannelSearch] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState(() => channels.map((channel) => channel.channelId));
  const [data, setData] = useState<WeeklyPerformanceDashboardData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);
  const isRequestInFlightRef = useRef(false);

  const selectedChannelSet = useMemo(() => new Set(selectedChannelIds), [selectedChannelIds]);
  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((channel) => channel.title.toLowerCase().includes(query));
  }, [channelSearch, channels]);
  const reportHref = useMemo(() => buildWeeklyUrl("/api/reports/weekly", startDate, endDate, selectedChannelIds), [
    endDate,
    selectedChannelIds,
    startDate
  ]);
  const hasInvalidRange = Boolean(startDate && endDate && startDate > endDate);
  const canApply = !hasInvalidRange && selectedChannelIds.length > 0 && !isLoading;

  useEffect(() => {
    void loadWeeklyData();
    return () => {
      activeRequestRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markFiltersChanged = () => {
    setData(null);
    setErrorMessage("");
  };

  const loadWeeklyData = async () => {
    if (!canApply || isRequestInFlightRef.current) return;

    isRequestInFlightRef.current = true;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch(buildWeeklyUrl("/api/weekly", startDate, endDate, selectedChannelIds), {
        cache: "no-store",
        signal: controller.signal
      });
      const payload = (await response.json()) as WeeklyPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load weekly performance.");
      }

      setData(payload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErrorMessage(error instanceof Error ? error.message : "Unable to load weekly performance.");
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
      isRequestInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4 text-primary" />
            Weekly Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <DateField
              label="Week start"
              max={latestStartDate}
              value={startDate}
              onChange={(value) => {
                const range = buildWeekRangeFromStart(value, defaultEndDate);
                setStartDate(range.startDate);
                setEndDate(range.endDate);
                markFiltersChanged();
              }}
            />
            <DateField
              label="Week end"
              max={defaultEndDate}
              value={endDate}
              onChange={(value) => {
                const range = buildWeekRangeFromEnd(value, defaultEndDate);
                setStartDate(range.startDate);
                setEndDate(range.endDate);
                markFiltersChanged();
              }}
            />
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            Weekly reports use YouTube-ready data through {defaultEndDate}; recent revenue days can arrive later.
          </p>

          <div className="rounded-md border bg-background/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                {selectedChannelIds.length === channels.length ? (
                  <CheckSquare className="size-4 text-primary" />
                ) : (
                  <Square className="size-4 text-muted-foreground" />
                )}
                Channels
              </div>
              <div className="text-xs font-semibold text-muted-foreground">
                {selectedChannelIds.length}/{channels.length} selected
              </div>
            </div>

            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  className={buttonVariants({ variant: "secondary", size: "sm", className: "rounded-md" })}
                  type="button"
                  onClick={() => {
                    setSelectedChannelIds(channels.map((channel) => channel.channelId));
                    markFiltersChanged();
                  }}
                >
                  Select all
                </button>
                <button
                  className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-md" })}
                  type="button"
                  onClick={() => {
                    setSelectedChannelIds([]);
                    markFiltersChanged();
                  }}
                >
                  Clear
                </button>
              </div>

              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={channelSearch}
                  onChange={(event) => setChannelSearch(event.target.value)}
                  placeholder="Search channels"
                  className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                />
              </label>

              <div className="max-h-64 overflow-auto rounded-md border">
                {filteredChannels.map((channel) => (
                  <label
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                    key={channel.channelId}
                  >
                    <input
                      className="size-4 accent-primary"
                      type="checkbox"
                      checked={selectedChannelSet.has(channel.channelId)}
                      onChange={() => {
                        setSelectedChannelIds((current) =>
                          current.includes(channel.channelId)
                            ? current.filter((channelId) => channelId !== channel.channelId)
                            : [...current, channel.channelId]
                        );
                        markFiltersChanged();
                      }}
                    />
                    <span className="font-semibold text-foreground">{channel.title}</span>
                  </label>
                ))}
                {filteredChannels.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">No channels found.</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1 text-sm">
              <div className="font-semibold text-foreground">
                {startDate || "Start date"} to {endDate || "End date"}
              </div>
              <div className="text-muted-foreground">
                7-day week range | {selectedChannelIds.length} channels selected
              </div>
              {selectedChannelIds.length === 0 ? (
                <div className="text-xs font-semibold text-muted-foreground">Select at least one channel.</div>
              ) : null}
              {hasInvalidRange ? (
                <div className="text-xs font-semibold text-destructive">End date must be after start date.</div>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button className="h-11 gap-2 rounded-md" disabled={!canApply} onClick={loadWeeklyData} type="button">
                {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
                {isLoading ? "Syncing weekly data..." : "Apply"}
              </Button>
              <ReportDownloadButton
                disabled={!canApply}
                href={reportHref}
                idleLabel="Download Weekly Excel"
                loadingLabel="Syncing data from YouTube..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? <LoadingPanel /> : null}
      {errorMessage ? <ErrorPanel message={errorMessage} /> : null}
      {!isLoading && !errorMessage && !data ? (
        <Card className="shadow-sm">
          <CardContent className="p-4 text-sm font-semibold text-muted-foreground">
            Select channels and apply to load weekly performance.
          </CardContent>
        </Card>
      ) : null}
      {data ? <WeeklyResults data={data} /> : null}
    </div>
  );
}

function WeeklyResults({ data }: { data: WeeklyPerformanceDashboardData }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Views" value={formatCompactNumber(data.totals.current.views)} />
        <MetricCard label="Watch hours" value={formatCompactNumber(data.totals.current.watchHours)} />
        <MetricCard label="Estimated revenue" value={formatCurrency(data.totals.current.estimatedRevenue)} />
        <MetricCard label="RPM" value={formatCurrency(data.totals.current.rpm)} />
      </div>

      <WeeklyTrendSection data={data} points={data.weeklyTrend} />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Channel Weekly Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            headers={[
              "Channel",
              "Views",
              "Watch Hours",
              "Net Subscribers",
              "Estimated Revenue",
              "RPM",
              "Playback CPM",
              "Ad Impressions",
              "Long Videos Published",
              "Short Videos Published"
            ]}
            rows={data.rows.map((row) => [
              row.channel.title,
              formatCompactNumber(row.current.views),
              formatCompactNumber(row.current.watchHours),
              formatSignedNumber(row.current.netSubscribers),
              formatCurrency(row.current.estimatedRevenue),
              formatCurrency(row.current.rpm),
              formatCurrency(row.current.playbackCpm),
              formatCompactNumber(row.current.adImpressions),
              formatCompactNumber(row.current.longVideosPublished),
              formatCompactNumber(row.current.shortVideosPublished)
            ])}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Strengths and Weaknesses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {data.rows.map((row) => (
              <div className="rounded-md border bg-background/80 p-3" key={row.channel.channelId}>
                <div className="mb-3 font-bold">{row.channel.title}</div>
                <div className="grid gap-3 text-sm lg:grid-cols-2">
                  <InsightList label="Strengths" items={row.strengths} />
                  <InsightList label="Weaknesses" items={row.weaknesses} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WeeklyTrendSection({ data, points }: { data: WeeklyPerformanceDashboardData; points: WeeklyTrendPoint[] }) {
  return (
    <div className="grid gap-4">
      <TrendPanel
        description="Actual weekly values for the selected week and the three previous weeks."
        points={points}
        title="Combined Weekly Trend"
      />

      <section className="grid gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-black">
            <BarChart3 className="size-4 text-primary" />
            Channel Weekly Trends
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            Separate weekly graphs for each selected channel.
          </p>
        </div>
        <div className="grid gap-4">
          {data.rows.map((row) => (
            <TrendPanel key={row.channel.channelId} points={row.weeklyTrend} title={row.channel.title} compact />
          ))}
        </div>
      </section>
    </div>
  );
}

function TrendPanel({
  compact = false,
  description,
  points,
  title
}: {
  compact?: boolean;
  description?: string;
  points: WeeklyTrendPoint[];
  title: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className={compact ? "pb-2" : undefined}>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-primary" />
          {title}
        </CardTitle>
        {description ? <p className="text-xs font-semibold text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {WEEKLY_TREND_METRICS.map((metric) => (
          <WeeklyMetricLineChart
            formatter={metric.formatter}
            key={metric.key}
            metricKey={metric.key}
            points={points}
            title={metric.label}
          />
        ))}
        <WeeklyPublishedVideosBarChart points={points} />
      </CardContent>
    </Card>
  );
}

function WeeklyMetricLineChart({
  formatter,
  metricKey,
  points,
  title
}: {
  formatter: (value: number) => string;
  metricKey: WeeklyTrendMetricKey;
  points: WeeklyTrendPoint[];
  title: string;
}) {
  const weeklyValues = points.map((point) => point.totals[metricKey]);
  const min = Math.min(...weeklyValues, 0);
  const max = Math.max(...weeklyValues, 0);
  const range = max - min || 1;
  const bottomY = 116;
  const chartHeight = 92;
  const valueToY = (value: number) => bottomY - ((value - min) / range) * chartHeight;
  const baselineY = valueToY(0);
  const coordinates = weeklyValues.map((value, index) => {
    const x = points.length <= 1 ? 160 : 18 + (index / (points.length - 1)) * 284;
    const y = valueToY(value);
    return { x, y };
  });
  const linePoints = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = coordinates.length > 0 ? `18,${baselineY} ${linePoints} 302,${baselineY}` : "";
  const selectedWeeklyValue = weeklyValues[weeklyValues.length - 1] ?? 0;
  const trendTone = getTrendTone(weeklyValues);
  const toneStyles = getTrendToneStyles(trendTone);

  return (
    <div className="min-w-0 rounded-md border bg-background/80 p-3">
      <div>
        <div className="text-sm font-black">{title}</div>
        <div className="mt-1 text-xs font-semibold text-muted-foreground">
          Selected week {formatter(selectedWeeklyValue)}
        </div>
      </div>

      <svg className="mt-3 h-36 w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 320 140" role="img">
        <title>{title} weekly trend</title>
        <line className="stroke-border" x1="18" x2="302" y1={baselineY} y2={baselineY} strokeWidth="1" />
        <line className="stroke-border" x1="18" x2="18" y1="20" y2="116" strokeWidth="1" />
        {areaPoints ? <polygon className={toneStyles.areaClassName} points={areaPoints} /> : null}
        <polyline
          className={cn("fill-none", toneStyles.strokeClassName)}
          points={linePoints}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {coordinates.map((coordinate, index) => (
          <g key={`${points[index]?.range.startDate ?? index}-${metricKey}`}>
            <circle
              className={cn("fill-background", toneStyles.strokeClassName)}
              cx={coordinate.x}
              cy={coordinate.y}
              r="4"
              strokeWidth="2"
            />
            <title>
              {points[index]?.label}: {formatter(weeklyValues[index] ?? 0)}
            </title>
          </g>
        ))}
      </svg>

      <div className="grid grid-cols-4 gap-2 text-center">
        {points.map((point, index) => (
          <div className="grid min-w-0 gap-0.5" key={`${point.range.startDate}-${point.range.endDate}`}>
            <div
              className={cn(
                "truncate text-[11px] font-black",
                index === points.length - 1 ? toneStyles.textClassName : "text-foreground"
              )}
              title={formatter(weeklyValues[index] ?? 0)}
            >
              {formatter(weeklyValues[index] ?? 0)}
            </div>
            <div className="text-[10px] font-semibold leading-tight text-muted-foreground">{formatShortRange(point.range)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyPublishedVideosBarChart({ points }: { points: WeeklyTrendPoint[] }) {
  const longValues = points.map((point) => point.totals.longVideosPublished);
  const shortValues = points.map((point) => point.totals.shortVideosPublished);
  const max = Math.max(...longValues, ...shortValues, 1);
  const bottomY = 116;
  const chartHeight = 92;
  const barWidth = 15;
  const barGap = 5;
  const groupStep = points.length <= 1 ? 0 : 244 / (points.length - 1);
  const selectedIndex = Math.max(0, points.length - 1);
  const selectedLong = longValues[selectedIndex] ?? 0;
  const selectedShort = shortValues[selectedIndex] ?? 0;

  return (
    <div className="min-w-0 rounded-md border bg-background/80 p-3 md:col-span-2 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black">Videos published</div>
          <div className="mt-1 text-xs font-semibold text-muted-foreground">
            Selected week Long {formatCompactNumber(selectedLong)} | Short {formatCompactNumber(selectedShort)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-primary" />
            Long
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-emerald-500" />
            Short
          </span>
        </div>
      </div>

      <svg className="mt-3 h-36 w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 320 140" role="img">
        <title>Long and short videos published weekly</title>
        <line className="stroke-border" x1="18" x2="302" y1={bottomY} y2={bottomY} strokeWidth="1" />
        <line className="stroke-border" x1="18" x2="18" y1="20" y2="116" strokeWidth="1" />
        {points.map((point, index) => {
          const groupX = points.length <= 1 ? 142 : 34 + index * groupStep;
          const longHeight = (longValues[index] / max) * chartHeight;
          const shortHeight = (shortValues[index] / max) * chartHeight;

          return (
            <g key={`${point.range.startDate}-${point.range.endDate}-published`}>
              <rect
                className="fill-primary"
                height={longHeight}
                rx="3"
                width={barWidth}
                x={groupX}
                y={bottomY - longHeight}
              />
              <rect
                className="fill-emerald-500"
                height={shortHeight}
                rx="3"
                width={barWidth}
                x={groupX + barWidth + barGap}
                y={bottomY - shortHeight}
              />
              <title>
                {point.label}: Long {formatCompactNumber(longValues[index] ?? 0)}, Short{" "}
                {formatCompactNumber(shortValues[index] ?? 0)}
              </title>
            </g>
          );
        })}
      </svg>

      <div className="grid grid-cols-4 gap-2 text-center">
        {points.map((point, index) => (
          <div className="grid min-w-0 gap-0.5" key={`${point.range.startDate}-${point.range.endDate}-published-label`}>
            <div className="truncate text-[11px] font-black text-foreground">
              {formatCompactNumber(longValues[index] ?? 0)} / {formatCompactNumber(shortValues[index] ?? 0)}
            </div>
            <div className="text-[10px] font-semibold leading-tight text-muted-foreground">{formatShortRange(point.range)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="grid content-start gap-2">
      <div className="text-xs font-black uppercase text-muted-foreground">{label}</div>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground" key={item}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th className="px-3 py-2 font-black" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className="border-t" key={`${row[0]}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td
                  className={cn("px-3 py-2 align-top", cellIndex === 0 ? "font-bold text-foreground" : "text-muted-foreground")}
                  key={`${cell}-${cellIndex}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="text-sm font-bold text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-black">{value}</div>
      </CardContent>
    </Card>
  );
}

function DateField({
  label,
  max,
  value,
  onChange
}: {
  label: string;
  max: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
      {label}
      <input
        className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
        max={max}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function LoadingPanel() {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-3 p-4 text-sm font-semibold text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        Syncing weekly data from YouTube. More selected channels can take a bit longer.
      </CardContent>
    </Card>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <Card className="border-destructive/60 shadow-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 size-4 text-destructive" />
        <div>
          <div className="font-black text-destructive">Data is unavailable</div>
          <div className="mt-1 text-sm text-muted-foreground">{message}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function buildWeeklyUrl(path: string, startDate: string, endDate: string, channelIds: string[]) {
  const query = new URLSearchParams({ endDate, startDate });
  for (const channelId of channelIds) {
    query.append("channel", channelId);
  }
  return `${path}?${query.toString()}`;
}

function buildWeekRangeFromStart(startDate: string, maxEndDate: string) {
  const maxStartDate = addDaysToDate(maxEndDate, -6);
  const normalizedStartDate = startDate > maxStartDate ? maxStartDate : startDate;

  return {
    endDate: addDaysToDate(normalizedStartDate, 6),
    startDate: normalizedStartDate
  };
}

function buildWeekRangeFromEnd(endDate: string, maxEndDate: string) {
  const normalizedEndDate = endDate > maxEndDate ? maxEndDate : endDate;

  return {
    endDate: normalizedEndDate,
    startDate: addDaysToDate(normalizedEndDate, -6)
  };
}

function addDaysToDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTrendTone(values: number[]) {
  const current = values[values.length - 1] ?? 0;
  const previous = values[values.length - 2] ?? current;

  if (current > previous) return "up";
  if (current < previous) return "down";
  return "same";
}

function getTrendToneStyles(tone: ReturnType<typeof getTrendTone>) {
  if (tone === "up") {
    return {
      areaClassName: "fill-emerald-500/10",
      strokeClassName: "stroke-emerald-500",
      textClassName: "text-emerald-700 dark:text-emerald-300"
    };
  }

  if (tone === "down") {
    return {
      areaClassName: "fill-red-500/10",
      strokeClassName: "stroke-red-500",
      textClassName: "text-red-700 dark:text-red-300"
    };
  }

  return {
    areaClassName: "fill-sky-500/10",
    strokeClassName: "stroke-sky-500",
    textClassName: "text-sky-700 dark:text-sky-300"
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 1,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    style: "currency"
  }).format(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard"
  }).format(value);
}

function formatSignedNumber(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${formatCompactNumber(rounded)}`;
}

function formatCtr(value: number | null) {
  if (value === null) return "Unavailable";
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${Math.round(percent * 100) / 100}%`;
}

function formatShortRange(range: { endDate: string; startDate: string }) {
  const start = new Date(`${range.startDate}T00:00:00.000Z`);
  const end = new Date(`${range.endDate}T00:00:00.000Z`);
  const formatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
  return `${formatter.format(start)}-${formatter.format(end)}`;
}
