"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckSquare,
  Clapperboard,
  LoaderCircle,
  Search,
  Smartphone,
  Square
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ReportDownloadButton } from "@/components/report-download-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getEditableTargetMonths,
  getVisibleMonthlyTargetMetrics,
  roundTargetValue,
  type MonthlyTargetMetric,
  type MonthlyTargetMetricDefinition
} from "@/lib/monthly-target-metrics";
import type { MonthlyTargetDashboardRow } from "@/lib/monthly-targets";
import { cn } from "@/lib/utils";
import type { StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";
import type {
  WeeklyMetricValues,
  WeeklyPerformanceDashboardData,
  WeeklyTrendPoint
} from "@/lib/weekly-performance";

type WeeklyPerformanceDashboardProps = {
  canViewRevenue: boolean;
  channels: StoredYoutubeManagedChannel[];
  defaultEndDate: string;
  defaultStartDate: string;
};

type WeeklyPayload = WeeklyPerformanceDashboardData & {
  error?: string;
};

type MonthlyTargetsPayload = {
  error?: string;
  errorMessage?: string;
  month: string;
  rows: MonthlyTargetDashboardRow[];
  schemaReady: boolean;
};

type MonthlyTargetsDashboardState = Pick<MonthlyTargetsPayload, "errorMessage" | "month" | "rows" | "schemaReady">;

type WeeklyMode = "targets" | "compare";

type WeeklyTrendMetricKey = keyof Pick<
  WeeklyMetricValues,
  "estimatedRevenue" | "netSubscribers" | "views" | "watchHours"
>;

type MonthlyWeeklyTargetWeekChartRow = {
  actual: number;
  label: string;
  percent: number;
  rangeLabel: string;
  target: number;
};

type MonthlyWeeklyTargetMetricChartRow = {
  actualTotal: number;
  left: number;
  maxBarValue: number;
  metric: MonthlyTargetMetricDefinition;
  monthlyTarget: number;
  sourceLabel?: string;
  totalPercent: number;
  weekRows: MonthlyWeeklyTargetWeekChartRow[];
};

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

function getWeeklyTrendMetrics(canViewRevenue: boolean) {
  return canViewRevenue
    ? WEEKLY_TREND_METRICS
    : WEEKLY_TREND_METRICS.filter((metric) => metric.key !== "estimatedRevenue");
}

export function WeeklyPerformanceDashboard({
  canViewRevenue,
  channels,
  defaultEndDate,
  defaultStartDate
}: WeeklyPerformanceDashboardProps) {
  const targetMonths = useMemo(() => getEditableTargetMonths(), []);
  const defaultTargetMonth = targetMonths[0] ?? defaultEndDate.slice(0, 7);
  const latestStartDate = useMemo(() => addDaysToDate(defaultEndDate, -6), [defaultEndDate]);

  const [mode, setMode] = useState<WeeklyMode>("targets");
  const [targetMonth, setTargetMonth] = useState(defaultTargetMonth);
  const [targetChannelSearch, setTargetChannelSearch] = useState("");
  const [targetChannelIds, setTargetChannelIds] = useState(() => channels.map((channel) => channel.channelId));
  const [targetData, setTargetData] = useState<MonthlyTargetsDashboardState | null>(null);
  const [targetErrorMessage, setTargetErrorMessage] = useState("");
  const [isTargetLoading, setIsTargetLoading] = useState(false);
  const targetRequestRef = useRef<AbortController | null>(null);
  const isTargetRequestInFlightRef = useRef(false);

  const [compareStartDate, setCompareStartDate] = useState(defaultStartDate);
  const [compareEndDate, setCompareEndDate] = useState(defaultEndDate);
  const [compareChannelSearch, setCompareChannelSearch] = useState("");
  const [compareChannelIds, setCompareChannelIds] = useState(() => channels.map((channel) => channel.channelId));
  const [compareData, setCompareData] = useState<WeeklyPerformanceDashboardData | null>(null);
  const [compareErrorMessage, setCompareErrorMessage] = useState("");
  const [isCompareLoading, setIsCompareLoading] = useState(false);
  const compareRequestRef = useRef<AbortController | null>(null);
  const isCompareRequestInFlightRef = useRef(false);

  const compareReportHref = useMemo(
    () => buildWeeklyUrl("/api/reports/weekly", compareStartDate, compareEndDate, compareChannelIds),
    [compareEndDate, compareChannelIds, compareStartDate]
  );
  const hasInvalidCompareRange = Boolean(compareStartDate && compareEndDate && compareStartDate > compareEndDate);
  const canApplyTargets = Boolean(targetMonth) && targetChannelIds.length > 0 && !isTargetLoading;
  const canApplyCompare =
    Boolean(compareStartDate && compareEndDate) &&
    !hasInvalidCompareRange &&
    compareChannelIds.length > 0 &&
    !isCompareLoading;

  useEffect(() => {
    void loadTargetData();
    return () => {
      targetRequestRef.current?.abort();
      compareRequestRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markTargetFiltersChanged = () => {
    setTargetData(null);
    setTargetErrorMessage("");
  };

  const markCompareFiltersChanged = () => {
    setCompareData(null);
    setCompareErrorMessage("");
  };

  const loadTargetData = async () => {
    if (!canApplyTargets || isTargetRequestInFlightRef.current) return;

    isTargetRequestInFlightRef.current = true;
    targetRequestRef.current?.abort();
    const controller = new AbortController();
    targetRequestRef.current = controller;
    setIsTargetLoading(true);
    setTargetErrorMessage("");

    try {
      const response = await fetch(buildMonthlyTargetsUrl("/api/targets/monthly", targetMonth, targetChannelIds), {
        cache: "no-store",
        signal: controller.signal
      });
      const payload = (await response.json()) as MonthlyTargetsPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? payload.errorMessage ?? "Unable to load weekly target progress.");
      }

      setTargetData({
        errorMessage: payload.errorMessage,
        month: payload.month,
        rows: payload.rows,
        schemaReady: payload.schemaReady
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTargetErrorMessage(error instanceof Error ? error.message : "Unable to load weekly target progress.");
    } finally {
      if (targetRequestRef.current === controller) {
        targetRequestRef.current = null;
      }
      isTargetRequestInFlightRef.current = false;
      setIsTargetLoading(false);
    }
  };

  const loadCompareData = async () => {
    if (!canApplyCompare || isCompareRequestInFlightRef.current) return;

    isCompareRequestInFlightRef.current = true;
    compareRequestRef.current?.abort();
    const controller = new AbortController();
    compareRequestRef.current = controller;
    setIsCompareLoading(true);
    setCompareErrorMessage("");

    try {
      const response = await fetch(buildWeeklyUrl("/api/weekly", compareStartDate, compareEndDate, compareChannelIds), {
        cache: "no-store",
        signal: controller.signal
      });
      const payload = (await response.json()) as WeeklyPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load weekly performance.");
      }

      setCompareData(payload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCompareErrorMessage(error instanceof Error ? error.message : "Unable to load weekly performance.");
    } finally {
      if (compareRequestRef.current === controller) {
        compareRequestRef.current = null;
      }
      isCompareRequestInFlightRef.current = false;
      setIsCompareLoading(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ModeButton
          description="Split monthly targets by the weeks in that month."
          isSelected={mode === "targets"}
          label="Weekly targets & achievements"
          onClick={() => {
            setMode("targets");
            if (!targetData && !isTargetLoading) void loadTargetData();
          }}
        />
        <ModeButton
          description="Review the selected week against the three previous weeks."
          isSelected={mode === "compare"}
          label="Compare 4 weeks data"
          onClick={() => {
            setMode("compare");
            if (!compareData && !isCompareLoading) void loadCompareData();
          }}
        />
      </div>

      {mode === "targets" ? (
        <div className="grid gap-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="size-4 text-primary" />
                Weekly targets & achievements
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <MonthField
                months={targetMonths}
                value={targetMonth}
                onChange={(value) => {
                  setTargetMonth(value);
                  markTargetFiltersChanged();
                }}
              />
              <p className="text-xs font-semibold text-muted-foreground">
                Monthly targets are divided by the days present in each week of the selected month.
              </p>

              <ChannelSelector
                channels={channels}
                search={targetChannelSearch}
                selectedChannelIds={targetChannelIds}
                onClear={() => {
                  setTargetChannelIds([]);
                  markTargetFiltersChanged();
                }}
                onSearchChange={setTargetChannelSearch}
                onSelectAll={() => {
                  setTargetChannelIds(channels.map((channel) => channel.channelId));
                  markTargetFiltersChanged();
                }}
                onToggleChannel={(channelId) => {
                  setTargetChannelIds((current) =>
                    current.includes(channelId)
                      ? current.filter((selectedChannelId) => selectedChannelId !== channelId)
                      : [...current, channelId]
                  );
                  markTargetFiltersChanged();
                }}
              />

              <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid gap-1 text-sm">
                  <div className="font-semibold text-foreground">{formatMonthLabel(targetMonth)}</div>
                  <div className="text-muted-foreground">{targetChannelIds.length} channels selected</div>
                  {targetChannelIds.length === 0 ? (
                    <div className="text-xs font-semibold text-muted-foreground">Select at least one channel.</div>
                  ) : null}
                </div>
                <Button className="h-11 gap-2 rounded-md" disabled={!canApplyTargets} onClick={loadTargetData} type="button">
                  {isTargetLoading ? <LoaderCircle className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
                  {isTargetLoading ? "Loading targets..." : "Apply"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {isTargetLoading ? <LoadingPanel message="Loading weekly target progress for the selected month." /> : null}
          {targetErrorMessage ? <ErrorPanel message={targetErrorMessage} /> : null}
          {!isTargetLoading && !targetErrorMessage && !targetData ? (
            <Card className="shadow-sm">
              <CardContent className="p-4 text-sm font-semibold text-muted-foreground">
                Select a month and apply to load weekly targets and achievements.
              </CardContent>
            </Card>
          ) : null}
          {targetData ? <MonthlyWeeklyTargetsResults canViewRevenue={canViewRevenue} data={targetData} /> : null}
        </div>
      ) : (
        <div className="grid gap-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="size-4 text-primary" />
                Compare 4 weeks data
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <DateField
                  label="Week start"
                  max={latestStartDate}
                  value={compareStartDate}
                  onChange={(value) => {
                    const range = buildWeekRangeFromStart(value, defaultEndDate);
                    setCompareStartDate(range.startDate);
                    setCompareEndDate(range.endDate);
                    markCompareFiltersChanged();
                  }}
                />
                <DateField
                  label="Week end"
                  max={defaultEndDate}
                  value={compareEndDate}
                  onChange={(value) => {
                    const range = buildWeekRangeFromEnd(value, defaultEndDate);
                    setCompareStartDate(range.startDate);
                    setCompareEndDate(range.endDate);
                    markCompareFiltersChanged();
                  }}
                />
              </div>
              <p className="text-xs font-semibold text-muted-foreground">
                Weekly reports use YouTube-ready data through {defaultEndDate}.
              </p>

              <ChannelSelector
                channels={channels}
                search={compareChannelSearch}
                selectedChannelIds={compareChannelIds}
                onClear={() => {
                  setCompareChannelIds([]);
                  markCompareFiltersChanged();
                }}
                onSearchChange={setCompareChannelSearch}
                onSelectAll={() => {
                  setCompareChannelIds(channels.map((channel) => channel.channelId));
                  markCompareFiltersChanged();
                }}
                onToggleChannel={(channelId) => {
                  setCompareChannelIds((current) =>
                    current.includes(channelId)
                      ? current.filter((selectedChannelId) => selectedChannelId !== channelId)
                      : [...current, channelId]
                  );
                  markCompareFiltersChanged();
                }}
              />

              <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid gap-1 text-sm">
                  <div className="font-semibold text-foreground">
                    {compareStartDate || "Start date"} to {compareEndDate || "End date"}
                  </div>
                  <div className="text-muted-foreground">
                    7-day week range | {compareChannelIds.length} channels selected
                  </div>
                  {compareChannelIds.length === 0 ? (
                    <div className="text-xs font-semibold text-muted-foreground">Select at least one channel.</div>
                  ) : null}
                  {hasInvalidCompareRange ? (
                    <div className="text-xs font-semibold text-destructive">End date must be after start date.</div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <Button className="h-11 gap-2 rounded-md" disabled={!canApplyCompare} onClick={loadCompareData} type="button">
                    {isCompareLoading ? <LoaderCircle className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
                    {isCompareLoading ? "Syncing weekly data..." : "Apply"}
                  </Button>
                  {canViewRevenue ? (
                    <ReportDownloadButton
                      disabled={!canApplyCompare}
                      href={compareReportHref}
                      idleLabel="Download Weekly Excel"
                      loadingLabel="Syncing data from YouTube..."
                    />
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          {isCompareLoading ? <LoadingPanel /> : null}
          {compareErrorMessage ? <ErrorPanel message={compareErrorMessage} /> : null}
          {!isCompareLoading && !compareErrorMessage && !compareData ? (
            <Card className="shadow-sm">
              <CardContent className="p-4 text-sm font-semibold text-muted-foreground">
                Select a week and apply to compare it with the three previous weeks.
              </CardContent>
            </Card>
          ) : null}
          {compareData ? <WeeklyResults canViewRevenue={canViewRevenue} data={compareData} /> : null}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  description,
  isSelected,
  label,
  onClick
}: {
  description: string;
  isSelected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "min-h-24 rounded-md border bg-background/80 p-4 text-left shadow-sm transition hover:border-primary/60 hover:bg-primary/5",
        isSelected ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "border-border"
      )}
      type="button"
      onClick={onClick}
    >
      <div className="flex items-center gap-2 text-sm font-black text-foreground">
        <BarChart3 className={cn("size-4", isSelected ? "text-primary" : "text-muted-foreground")} />
        {label}
      </div>
      <div className="mt-2 text-xs font-semibold text-muted-foreground">{description}</div>
    </button>
  );
}

function MonthField({
  months,
  value,
  onChange
}: {
  months: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
      Month
      <select
        className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {months.map((month) => (
          <option key={month} value={month}>
            {formatMonthLabel(month)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChannelSelector({
  channels,
  onClear,
  onSearchChange,
  onSelectAll,
  onToggleChannel,
  search,
  selectedChannelIds
}: {
  channels: StoredYoutubeManagedChannel[];
  onClear: () => void;
  onSearchChange: (value: string) => void;
  onSelectAll: () => void;
  onToggleChannel: (channelId: string) => void;
  search: string;
  selectedChannelIds: string[];
}) {
  const selectedChannelSet = useMemo(() => new Set(selectedChannelIds), [selectedChannelIds]);
  const filteredChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((channel) => channel.title.toLowerCase().includes(query));
  }, [search, channels]);

  return (
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
            onClick={onSelectAll}
          >
            Select all
          </button>
          <button
            className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-md" })}
            type="button"
            onClick={onClear}
          >
            Clear
          </button>
        </div>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
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
                onChange={() => onToggleChannel(channel.channelId)}
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
  );
}

function MonthlyWeeklyTargetsResults({
  canViewRevenue,
  data
}: {
  canViewRevenue: boolean;
  data: MonthlyTargetsDashboardState;
}) {
  const visibleMetrics = getVisibleMonthlyTargetMetrics(canViewRevenue);
  const targetMetricCount = data.rows.reduce(
    (total, row) => total + visibleMetrics.filter((metric) => row.target[metric.key] !== null).length,
    0
  );

  if (!data.schemaReady) {
    return (
      <Card className="border-amber-500/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-amber-500" />
            Weekly targets & achievements
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm font-semibold text-muted-foreground">
          {data.errorMessage ?? "Weekly target tracking is unavailable."}
        </CardContent>
      </Card>
    );
  }

  if (data.rows.length === 0 || targetMetricCount === 0) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4 text-primary" />
            Weekly targets & achievements
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm font-semibold text-muted-foreground">
          No monthly targets are set for {formatMonthLabel(data.month)}.
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-black">
            <BarChart3 className="size-4 text-primary" />
            Weekly targets & achievements
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            {formatMonthLabel(data.month)} | {data.rows.length} channel{data.rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className="rounded-md border bg-background/80 px-2 py-1 text-xs font-black text-muted-foreground">
          {targetMetricCount} target{targetMetricCount === 1 ? "" : "s"} set
        </span>
      </div>

      <div className="grid gap-4">
        {data.rows.map((row) => (
          <ChannelMonthlyWeeklyTargetsCard key={row.channelId} metrics={visibleMetrics} row={row} />
        ))}
      </div>
    </section>
  );
}

function ChannelMonthlyWeeklyTargetsCard({
  metrics,
  row
}: {
  metrics: readonly MonthlyTargetMetricDefinition[];
  row: MonthlyTargetDashboardRow;
}) {
  const metricRows = metrics.flatMap((metric) => {
    const target = row.target[metric.key];
    if (target === null) return [];

    return [{ metric, sourceLabel: row.targetSourceLabels?.[metric.key], target }];
  });
  const totalWeekDays = row.weeklyActuals.reduce((total, week) => total + week.daysInMonth, 0);

  return (
    <div className="rounded-md border bg-background/80 p-3 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-black">{row.channelTitle}</p>
        <p className="text-xs font-semibold text-muted-foreground">
          {metricRows.length} target{metricRows.length === 1 ? "" : "s"} set
        </p>
      </div>

      {metricRows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No targets set for this channel.</p>
      ) : row.weeklyActuals.length === 0 || totalWeekDays <= 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Weekly target split is unavailable for this month.</p>
      ) : (
        <MonthlyWeeklyTargetChartGrid metricRows={metricRows} row={row} totalWeekDays={totalWeekDays} />
      )}
    </div>
  );
}

function MonthlyWeeklyTargetChartGrid({
  metricRows,
  row,
  totalWeekDays
}: {
  metricRows: Array<{ metric: MonthlyTargetMetricDefinition; sourceLabel?: string; target: number }>;
  row: MonthlyTargetDashboardRow;
  totalWeekDays: number;
}) {
  const chartRows = metricRows.map((metricRow) =>
    buildMonthlyWeeklyTargetMetricChartRow({
      metric: metricRow.metric,
      monthlyTarget: metricRow.target,
      sourceLabel: metricRow.sourceLabel,
      totalWeekDays,
      weeks: row.weeklyActuals
    })
  );
  const publishingCharts = chartRows.filter((chart) => isPublishingTargetMetric(chart.metric.key));
  const performanceCharts = chartRows.filter((chart) => !isPublishingTargetMetric(chart.metric.key));

  return (
    <div className="mt-3 grid gap-3">
      <div
        className={cn(
          "grid gap-3",
          publishingCharts.length > 0 ? "xl:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.65fr)]" : ""
        )}
      >
        {publishingCharts.length > 0 ? (
          <div className="grid content-start gap-3">
            <div className="text-xs font-black uppercase text-muted-foreground">Publishing plan</div>
            {publishingCharts.map((chart) => (
              <PublishingTargetMetricCard chart={chart} key={chart.metric.key} />
            ))}
          </div>
        ) : null}

        <div className="grid content-start gap-3">
          <div className="text-xs font-black uppercase text-muted-foreground">Performance targets</div>
          <div className={cn("grid gap-3 lg:grid-cols-2", publishingCharts.length === 0 ? "2xl:grid-cols-3" : "")}>
            {performanceCharts.map((chart) => (
              <MonthlyWeeklyTargetMetricChart chart={chart} key={chart.metric.key} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildMonthlyWeeklyTargetMetricChartRow({
  metric,
  monthlyTarget,
  sourceLabel,
  totalWeekDays,
  weeks
}: {
  metric: MonthlyTargetMetricDefinition;
  monthlyTarget: number;
  sourceLabel?: string;
  totalWeekDays: number;
  weeks: MonthlyTargetDashboardRow["weeklyActuals"];
}): MonthlyWeeklyTargetMetricChartRow {
  const weeklyTargets = buildMonthlyWeekTargetValues(metric, monthlyTarget, weeks, totalWeekDays);
  const actualTotal = roundTargetValue(
    metric.key,
    weeks.reduce((total, week) => total + week.actual[metric.key], 0)
  );
  const left = roundTargetValue(metric.key, Math.max(0, monthlyTarget - actualTotal));
  const totalPercent = calculateTargetProgressPercent(actualTotal, monthlyTarget);
  const weekRows = weeks.map((week, index) => {
    const target = weeklyTargets[index] ?? 0;
    const actual = week.actual[metric.key];

    return {
      actual,
      label: `Week ${index + 1}`,
      percent: calculateTargetProgressPercent(actual, target),
      rangeLabel: formatShortRange({ endDate: week.endDate, startDate: week.startDate }),
      target
    };
  });
  const maxBarValue = Math.max(
    1,
    ...weekRows.flatMap((week) => [week.actual, week.target])
  );

  return {
    actualTotal,
    left,
    maxBarValue,
    metric,
    monthlyTarget,
    sourceLabel,
    totalPercent,
    weekRows
  };
}

function MonthlyWeeklyTargetMetricChart({ chart }: { chart: MonthlyWeeklyTargetMetricChartRow }) {
  const { actualTotal, left, maxBarValue, metric, monthlyTarget, totalPercent, weekRows } = chart;
  const boundedPercent = Math.min(100, Math.max(0, totalPercent));

  if (isPublishingTargetMetric(metric.key)) {
    return <PublishingTargetMetricCard chart={chart} />;
  }

  if (isViewTargetMetric(metric.key)) {
    return <ViewTargetMetricCard chart={chart} />;
  }

  if (isWeeklyProgressTargetMetric(metric.key)) {
    return <WeeklyProgressTargetMetricCard chart={chart} />;
  }

  return (
    <div className="rounded-md border bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-foreground" title={metric.label}>
            {metric.label}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {formatTargetMetricValue(metric.key, actualTotal)} achieved
          </p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-black", getTargetProgressBadgeClass(totalPercent))}>
          {formatTargetPercent(totalPercent)}
        </span>
      </div>

      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", getTargetProgressBarClass(totalPercent))}
            style={{ width: `${boundedPercent}%` }}
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <TargetValue label="Target" value={formatTargetMetricValue(metric.key, monthlyTarget)} />
          <TargetValue label="Achieved" value={formatTargetMetricValue(metric.key, actualTotal)} />
          <TargetValue label="Left" value={formatTargetMetricValue(metric.key, left)} />
        </div>
      </div>

      <MiniWeeklyBars maxValue={maxBarValue} metric={metric} weeks={weekRows} />
    </div>
  );
}

function WeeklyProgressTargetMetricCard({ chart }: { chart: MonthlyWeeklyTargetMetricChartRow }) {
  const { actualTotal, metric, monthlyTarget, totalPercent, weekRows } = chart;

  return (
    <div className="rounded-md border bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-foreground" title={metric.label}>
            {metric.label}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {formatTargetMetricValue(metric.key, actualTotal)} achieved of {formatTargetMetricValue(metric.key, monthlyTarget)}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-black", getTargetProgressBadgeClass(totalPercent))}>
          {formatTargetPercent(totalPercent)}
        </span>
      </div>

      <div className="mt-3 grid gap-2">
        {weekRows.map((week) => (
          <WeeklyProgressTargetRow key={`${metric.key}-${week.label}-${week.rangeLabel}`} metric={metric} week={week} />
        ))}
      </div>
    </div>
  );
}

function WeeklyProgressTargetRow({
  metric,
  week
}: {
  metric: MonthlyTargetMetricDefinition;
  week: MonthlyWeeklyTargetWeekChartRow;
}) {
  const boundedPercent = Math.min(100, Math.max(0, week.percent));

  return (
    <div className="grid gap-2 rounded-md bg-muted/20 p-2 sm:grid-cols-[4.25rem_minmax(0,1fr)_6.75rem_4rem] sm:items-center">
      <div className="min-w-0">
        <div className="text-xs font-black text-foreground">{week.label.replace("Week ", "W")}</div>
        <div className="truncate text-[10px] font-semibold text-muted-foreground">{week.rangeLabel}</div>
      </div>

      <div
        className="h-4 overflow-hidden rounded-full bg-muted"
        title={`${week.label}: ${formatTargetMetricValue(metric.key, week.actual)} achieved of ${formatTargetMetricValue(
          metric.key,
          week.target
        )}`}
      >
        <div className={cn("h-full rounded-full", getTargetProgressBarClass(week.percent))} style={{ width: `${boundedPercent}%` }} />
      </div>

      <div className="text-right text-xs font-black tabular-nums text-foreground">
        {formatWeeklyProgressRatioValue(metric.key, week.actual)}
        <span className="text-muted-foreground">/{formatWeeklyProgressRatioValue(metric.key, week.target)}</span>
      </div>

      <div className="text-right">
        <span
          className={cn(
            "inline-flex min-w-12 justify-center rounded-md px-2 py-0.5 text-[10px] font-black tabular-nums",
            getTargetProgressBadgeClass(week.percent)
          )}
        >
          {formatTargetPercent(week.percent)}
        </span>
      </div>
    </div>
  );
}

function ViewTargetMetricCard({ chart }: { chart: MonthlyWeeklyTargetMetricChartRow }) {
  const { actualTotal, metric, monthlyTarget, totalPercent, weekRows } = chart;

  return (
    <div className="rounded-md border bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-foreground" title={metric.label}>
            {metric.label}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {formatTargetMetricValue(metric.key, actualTotal)} achieved of {formatTargetMetricValue(metric.key, monthlyTarget)}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-black", getTargetProgressBadgeClass(totalPercent))}>
          {formatTargetPercent(totalPercent)}
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-md border bg-muted/10">
        <div className="border-b px-3 py-2 text-[10px] font-black uppercase text-muted-foreground">Weekly performance</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-xs">
            <thead className="text-[10px] font-black uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-black">Week</th>
                <th className="px-3 py-2 text-right font-black">Target</th>
                <th className="px-3 py-2 text-right font-black">Achieved</th>
                <th className="px-3 py-2 text-right font-black">Progress</th>
              </tr>
            </thead>
            <tbody>
              {weekRows.map((week) => {
                const hasActual = week.actual > 0;

                return (
                  <tr
                    className={cn("border-t last:border-b-0", hasActual ? getTargetProgressRowClass(week.percent) : "")}
                    key={`${metric.key}-${week.label}-${week.rangeLabel}`}
                  >
                    <td className="px-3 py-1.5 font-black text-foreground">{week.label.replace("Week ", "W")}</td>
                    <td className="px-3 py-1.5 text-right font-black tabular-nums text-foreground">
                      {formatTargetMetricValue(metric.key, week.target)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-black tabular-nums text-foreground">
                      {hasActual ? formatTargetMetricValue(metric.key, week.actual) : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {hasActual ? (
                        <span
                          className={cn(
                            "inline-flex min-w-12 justify-center rounded-md px-2 py-0.5 text-[10px] font-black tabular-nums",
                            getTargetProgressBadgeClass(week.percent)
                          )}
                        >
                          {formatTargetPercent(week.percent)}
                        </span>
                      ) : (
                        <span className="font-black text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PublishingTargetMetricCard({ chart }: { chart: MonthlyWeeklyTargetMetricChartRow }) {
  const { actualTotal, left, metric, monthlyTarget, sourceLabel, totalPercent, weekRows } = chart;
  const Icon = metric.key === "shortVideosToPublish" ? Smartphone : Clapperboard;
  const isAhead = totalPercent >= 100;
  const plannedWeeks = weekRows.filter((week) => week.target > 0).length;

  return (
    <div className="rounded-md border bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-md border", getPublishingIconClass(metric.key))}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-foreground" title={metric.label}>
              {metric.label}
            </p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {formatCompactNumber(actualTotal)} published of {formatCompactNumber(monthlyTarget)}
              {sourceLabel ? <span> · {sourceLabel}</span> : null}
            </p>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-black", getTargetProgressBadgeClass(totalPercent))}>
          {formatTargetPercent(totalPercent)}
        </span>
      </div>

      <div className="mt-3 grid gap-3">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-[10px] font-black uppercase text-muted-foreground">Publishing slots</div>
          <PublishingSlotsGauge metric={metric} published={actualTotal} target={monthlyTarget} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <TargetValue label={isAhead ? "Extra" : "Left"} value={formatCompactNumber(left)} />
            <TargetValue label="Weeks" value={String(plannedWeeks)} />
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase text-muted-foreground">Weekly publishing cadence</div>
            <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-primary/20" />
                Plan
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={cn("size-2 rounded-sm", getPublishingFillClass(metric.key))} />
                Published
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {weekRows.map((week) => (
              <PublishingWeekRow key={`${metric.key}-${week.label}-${week.rangeLabel}`} metric={metric} week={week} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PublishingSlotsGauge({
  metric,
  published,
  target
}: {
  metric: MonthlyTargetMetricDefinition;
  published: number;
  target: number;
}) {
  const boundedPercent = target <= 0 ? 0 : Math.min(100, Math.max(0, (published / target) * 100));
  const needleAngle = -90 + (boundedPercent / 100) * 180;

  return (
    <div className="mt-2">
      <svg className="h-28 w-full overflow-visible" viewBox="0 0 220 126" role="img">
        <title>{metric.label} publishing slots</title>
        <path className="fill-slate-300/40 dark:fill-slate-500/30" d={describeGaugeSegment(110, 110, 88, 58, -90, -54)} />
        <path className="fill-sky-500/70" d={describeGaugeSegment(110, 110, 88, 58, -54, 18)} />
        <path className={cn("opacity-80", getPublishingGaugeClass(metric.key))} d={describeGaugeSegment(110, 110, 88, 58, 18, 90)} />
        <line className="stroke-foreground/70" x1="110" y1="110" x2="110" y2="43" strokeLinecap="round" strokeWidth="2.5" transform={`rotate(${needleAngle} 110 110)`} />
        <circle className="fill-background stroke-border" cx="110" cy="110" r="5" strokeWidth="2" />
        <text className="fill-muted-foreground text-[13px] font-black" textAnchor="middle" x="32" y="122">
          0
        </text>
        <text className="fill-muted-foreground text-[13px] font-black" textAnchor="middle" x="188" y="122">
          {formatCompactNumber(target)}
        </text>
        <text className="fill-foreground text-[24px] font-black" textAnchor="middle" x="110" y="88">
          {formatCompactNumber(published)}
        </text>
        <text className="fill-muted-foreground text-[12px] font-bold" textAnchor="middle" x="110" y="106">
          Published
        </text>
      </svg>
    </div>
  );
}

function PublishingWeekRow({
  metric,
  week
}: {
  metric: MonthlyTargetMetricDefinition;
  week: MonthlyWeeklyTargetWeekChartRow;
}) {
  const boundedPercent = Math.min(100, Math.max(0, week.percent));

  return (
    <div className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] sm:items-center">
      <div className="min-w-0">
        <div className="text-xs font-black text-foreground">{week.label.replace("Week ", "W")}</div>
        <div className="truncate text-[10px] font-semibold text-muted-foreground">{week.rangeLabel}</div>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/20" style={{ width: "100%" }} />
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", getPublishingFillClass(metric.key))}
          style={{ width: `${boundedPercent}%` }}
        />
      </div>
      <div className="text-right text-xs font-black tabular-nums text-foreground">
        {formatCompactNumber(week.actual)}
        <span className="text-muted-foreground">/{formatCompactNumber(week.target)}</span>
      </div>
    </div>
  );
}

function MiniWeeklyBars({
  maxValue,
  metric,
  weeks
}: {
  maxValue: number;
  metric: MonthlyTargetMetricDefinition;
  weeks: MonthlyWeeklyTargetWeekChartRow[];
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase text-muted-foreground">Week split</div>
        <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-primary/20" />
            Target
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-primary" />
            Achieved
          </span>
        </div>
      </div>

      <div
        className="mt-2 grid items-end gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, weeks.length)}, minmax(0, 1fr))` }}
      >
        {weeks.map((week) => (
          <div className="grid min-w-0 gap-1" key={`${metric.key}-${week.label}-${week.rangeLabel}`}>
            <div
              className="relative h-12 overflow-hidden rounded-md bg-muted/50"
              title={`${week.label}: ${formatTargetMetricValue(metric.key, week.actual)} achieved of ${formatTargetMetricValue(
                metric.key,
                week.target
              )}`}
            >
              <div
                className="absolute bottom-0 left-1/2 w-5 -translate-x-1/2 rounded-t-md bg-primary/20"
                style={{ height: getBarHeightPercent(week.target, maxValue) }}
              />
              <div
                className={cn("absolute bottom-0 left-1/2 w-2 -translate-x-1/2 rounded-t-md", getTargetProgressBarClass(week.percent))}
                style={{ height: getBarHeightPercent(week.actual, maxValue) }}
              />
            </div>
            <div className="truncate text-center text-[10px] font-black text-foreground">{week.label.replace("Week ", "W")}</div>
            <div className="text-center text-[10px] font-semibold text-muted-foreground">{formatTargetPercent(week.percent)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TargetValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-black tabular-nums text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function buildMonthlyWeekTargetValues(
  metric: MonthlyTargetMetricDefinition,
  monthlyTarget: number,
  weeks: MonthlyTargetDashboardRow["weeklyActuals"],
  totalWeekDays: number
) {
  const scale = 10 ** metric.decimals;
  const scaledTotal = Math.round(monthlyTarget * scale);
  const rawValues = weeks.map((week) => (scaledTotal * week.daysInMonth) / totalWeekDays);
  const scaledValues = rawValues.map(Math.floor);
  let remaining = scaledTotal - scaledValues.reduce((total, value) => total + value, 0);

  rawValues
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach(({ index }) => {
      if (remaining <= 0) return;
      scaledValues[index] += 1;
      remaining -= 1;
    });

  return scaledValues.map((value) => roundTargetValue(metric.key, value / scale));
}

function WeeklyResults({
  canViewRevenue,
  data
}: {
  canViewRevenue: boolean;
  data: WeeklyPerformanceDashboardData;
}) {
  const summaryCards = canViewRevenue
    ? [
        { label: "Views", value: formatCompactNumber(data.totals.current.views) },
        { label: "Watch hours", value: formatCompactNumber(data.totals.current.watchHours) },
        { label: "Estimated revenue", value: formatCurrency(data.totals.current.estimatedRevenue) },
        { label: "RPM", value: formatCurrency(data.totals.current.rpm) }
      ]
    : [
        { label: "Views", value: formatCompactNumber(data.totals.current.views) },
        { label: "Watch hours", value: formatCompactNumber(data.totals.current.watchHours) },
        { label: "Net subscribers", value: formatSignedNumber(data.totals.current.netSubscribers) },
        {
          label: "Videos published",
          value: `${formatCompactNumber(data.totals.current.longVideosPublished)} long / ${formatCompactNumber(
            data.totals.current.shortVideosPublished
          )} short`
        }
      ];
  const weeklySummaryHeaders = canViewRevenue
    ? [
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
      ]
    : [
        "Channel",
        "Views",
        "Watch Hours",
        "Net Subscribers",
        "Long Videos Published",
        "Short Videos Published"
      ];
  const weeklySummaryRows = data.rows.map((row) =>
    canViewRevenue
      ? [
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
        ]
      : [
          row.channel.title,
          formatCompactNumber(row.current.views),
          formatCompactNumber(row.current.watchHours),
          formatSignedNumber(row.current.netSubscribers),
          formatCompactNumber(row.current.longVideosPublished),
          formatCompactNumber(row.current.shortVideosPublished)
        ]
  );

  return (
    <div className="grid gap-4">
      <section className="grid gap-4">
        <div>
          <div className="flex items-center gap-2 text-base font-black">
            <BarChart3 className="size-4 text-primary" />
            Compare 4 weeks data
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            Selected week and the three previous weeks.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>

        <WeeklyTrendSection canViewRevenue={canViewRevenue} data={data} points={data.weeklyTrend} />

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Channel Weekly Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              headers={weeklySummaryHeaders}
              rows={weeklySummaryRows}
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
      </section>
    </div>
  );
}

function WeeklyTrendSection({
  canViewRevenue,
  data,
  points
}: {
  canViewRevenue: boolean;
  data: WeeklyPerformanceDashboardData;
  points: WeeklyTrendPoint[];
}) {
  return (
    <div className="grid gap-4">
      <TrendPanel
        canViewRevenue={canViewRevenue}
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
            <TrendPanel
              canViewRevenue={canViewRevenue}
              key={row.channel.channelId}
              points={row.weeklyTrend}
              title={row.channel.title}
              compact
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TrendPanel({
  canViewRevenue,
  compact = false,
  description,
  points,
  title
}: {
  canViewRevenue: boolean;
  compact?: boolean;
  description?: string;
  points: WeeklyTrendPoint[];
  title: string;
}) {
  const trendMetrics = getWeeklyTrendMetrics(canViewRevenue);

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
        {trendMetrics.map((metric) => (
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

function LoadingPanel({
  message = "Syncing weekly data from YouTube. More selected channels can take a bit longer."
}: {
  message?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-3 p-4 text-sm font-semibold text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        {message}
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

function buildMonthlyTargetsUrl(path: string, month: string, channelIds: string[]) {
  const query = new URLSearchParams({ baseline: "latest-month", month });
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

function formatTargetMetricValue(metric: MonthlyTargetMetric, value: number) {
  if (metric === "estimatedRevenue") return formatCompactCurrency(value);
  if (metric === "watchHours") return `${formatCompactNumber(value)} hrs`;
  if (metric === "netSubscribers") return formatSignedNumber(value);

  return formatCompactNumber(value);
}

function formatWeeklyProgressRatioValue(metric: MonthlyTargetMetric, value: number) {
  if (metric === "watchHours") return formatCompactNumber(value);
  return formatTargetMetricValue(metric, value);
}

function calculateTargetProgressPercent(actual: number, target: number) {
  if (target <= 0) return actual >= target ? 100 : 0;
  return Math.round((actual / target) * 1000) / 10;
}

function isPublishingTargetMetric(metric: MonthlyTargetMetric) {
  return metric === "shortVideosToPublish" || metric === "longVideosToPublish";
}

function isViewTargetMetric(metric: MonthlyTargetMetric) {
  return metric === "shortViews" || metric === "longViews";
}

function isWeeklyProgressTargetMetric(metric: MonthlyTargetMetric) {
  return metric === "watchHours" || metric === "netSubscribers" || metric === "estimatedRevenue";
}

function getBarHeightPercent(value: number, maxValue: number) {
  if (value <= 0 || maxValue <= 0) return "0%";
  const percent = Math.min(100, Math.max(0, (value / maxValue) * 100));
  return `${Math.max(4, percent)}%`;
}

function getTargetProgressBadgeClass(percent: number) {
  if (percent >= 100) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  if (percent >= 60) return "bg-primary/15 text-primary";
  return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
}

function getTargetProgressBarClass(percent: number) {
  if (percent >= 100) return "bg-emerald-500";
  if (percent >= 60) return "bg-primary";
  return "bg-amber-500";
}

function getTargetProgressRowClass(percent: number) {
  if (percent >= 100) return "bg-emerald-500/10";
  if (percent >= 60) return "bg-primary/10";
  return "bg-amber-500/10";
}

function getPublishingIconClass(metric: MonthlyTargetMetric) {
  if (metric === "shortVideosToPublish") {
    return "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-200";
  }

  return "border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-200";
}

function getPublishingFillClass(metric: MonthlyTargetMetric) {
  return metric === "shortVideosToPublish" ? "bg-sky-500" : "bg-violet-500";
}

function getPublishingGaugeClass(metric: MonthlyTargetMetric) {
  return metric === "shortVideosToPublish" ? "fill-sky-700 dark:fill-sky-400" : "fill-violet-700 dark:fill-violet-400";
}

function formatTargetPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatShortRange(range: { endDate: string; startDate: string }) {
  const start = new Date(`${range.startDate}T00:00:00.000Z`);
  const end = new Date(`${range.endDate}T00:00:00.000Z`);
  const formatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
  return `${formatter.format(start)}-${formatter.format(end)}`;
}

function describeGaugeSegment(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
) {
  const outerStart = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z"
  ].join(" ");
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians)
  };
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}
