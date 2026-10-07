"use client";

import { AlertTriangle, Download, LoaderCircle, Search, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MONTHLY_GROWTH_METRICS, buildMonthlyGrowthExport, formatGrowthMonth, formatGrowthValue, growthCoverageLabel,
  shiftGrowthMonth, validateMonthlyGrowthSelection, type MonthlyGrowthChannel, type MonthlyGrowthData,
  type MonthlyGrowthMetric, type MonthlyGrowthPoint, type MonthlyGrowthSeries, type MonthlyGrowthValue
} from "@/lib/monthly-growth";
import { buildXlsxWorkbook } from "@/lib/xlsx-export";

type Props = {
  channels: MonthlyGrowthChannel[];
  canViewRevenue: boolean;
  currentMonth: string;
  defaultStartMonth: string;
  defaultEndMonth: string;
};

export function MonthlyGrowthDashboard({ channels, canViewRevenue, currentMonth, defaultStartMonth, defaultEndMonth }: Props) {
  const visibleMetrics = MONTHLY_GROWTH_METRICS.filter((metric) => canViewRevenue || metric.key !== "estimatedRevenue");
  const [startMonth, setStartMonth] = useState(defaultStartMonth);
  const [endMonth, setEndMonth] = useState(defaultEndMonth);
  const [selectedIds, setSelectedIds] = useState(channels.map((channel) => channel.channelId));
  const [metrics, setMetrics] = useState<MonthlyGrowthMetric[]>(visibleMetrics.map((metric) => metric.key));
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ key: string; data?: MonthlyGrowthData; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams({ startMonth, endMonth });
    [...selectedIds].sort().forEach((id) => params.append("channel", id));
    [...metrics].sort().forEach((metric) => params.append("metric", metric));
    return params.toString();
  }, [startMonth, endMonth, selectedIds, metrics]);
  const requestKey = `${query}|${retry}`;
  let validationError = "";
  try {
    validateMonthlyGrowthSelection({ startMonth, endMonth, channelIds: selectedIds, metrics }, currentMonth,
      channels.map((channel) => channel.channelId), canViewRevenue);
  } catch (error) { validationError = error instanceof Error ? error.message : "Invalid selections."; }
  const data = !validationError && result?.key === requestKey ? result.data : undefined;
  const error = !validationError && result?.key === requestKey ? result.error : undefined;
  const loading = !validationError && result?.key !== requestKey;

  useEffect(() => {
    if (validationError) return;
    const controller = new AbortController();
    // Batch quick checkbox changes and cancel outdated requests on every filter update.
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/monthly-growth?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as MonthlyGrowthData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load monthly growth.");
        if (!controller.signal.aborted) setResult({ key: requestKey, data: payload });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key: requestKey, error: error instanceof Error ? error.message : "Unable to load monthly growth." });
      }
    }, 250);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query, requestKey, validationError]);

  const toggleChannel = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  const toggleMetric = (metric: MonthlyGrowthMetric) => setMetrics((keys) => keys.includes(metric) ? keys.filter((key) => key !== metric) : [...keys, metric]);
  const download = () => {
    if (!data) return;
    setDownloadError("");
    try {
      const report = buildMonthlyGrowthExport(data);
      const workbook = buildXlsxWorkbook({ ...report, sheetName: "Monthly Growth", columnWidth: 20, autoFilter: false });
      const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `monthly-growth-${data.startMonth}-to-${data.endMonth}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError("Unable to generate the Excel report. Please try again."); }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <Card className="shadow-sm">
        <CardHeader><CardTitle className="text-base">Dashboard filters</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <MonthField label="Start month" value={startMonth} max={currentMonth} onChange={setStartMonth} />
            <MonthField label="End month" value={endMonth} max={currentMonth} onChange={setEndMonth} />
          </div>
          <fieldset className="min-w-0 rounded-md border p-3">
            <legend className="px-1 text-sm font-bold">Channels ({selectedIds.length} selected)</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search channels</span><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Search channels" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <Button size="sm" variant="secondary" onClick={() => setSelectedIds(channels.map((channel) => channel.channelId))}>Select all</Button>
              <Button size="sm" variant="secondary" onClick={() => setSelectedIds([])}>Clear</Button>
            </div>
            <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {channels.filter((channel) => channel.title.toLowerCase().includes(search.trim().toLowerCase())).map((channel) => (
                <label key={channel.channelId} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-background/70 px-3 py-2 text-sm">
                  <input type="checkbox" checked={selectedIds.includes(channel.channelId)} onChange={() => toggleChannel(channel.channelId)} className="size-4 shrink-0 accent-primary" />
                  <span className="break-words">{channel.title}</span>
                </label>
              ))}
            </div>
            {channels.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No channels are available for your account.</p> : null}
            {channels.length > 0 && !channels.some((channel) => channel.title.toLowerCase().includes(search.trim().toLowerCase())) ? <p className="mt-2 text-sm text-muted-foreground">No channels match your search.</p> : null}
          </fieldset>
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-sm font-bold">Metrics ({metrics.length} selected)</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {visibleMetrics.map((metric) => (
                <label key={metric.key} className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={metrics.includes(metric.key)} onChange={() => toggleMetric(metric.key)} className="size-4 accent-primary" />
                  {metric.label}
                </label>
              ))}
            </div>
          </fieldset>
          {validationError ? <Notice>{validationError}</Notice> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {loading ? <span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" /> Loading monthly growth…</span> : data ? (
            <span>{formatGrowthMonth(data.startMonth)} – {formatGrowthMonth(data.endMonth)} · {data.channels.length} selected {data.channels.length === 1 ? "channel" : "channels"} · {data.metrics.length} {data.metrics.length === 1 ? "metric" : "metrics"}</span>
          ) : "Choose months, channels, and metrics to populate the dashboard."}
        </div>
        <Button disabled={!data || loading} onClick={download} variant="secondary"><Download className="size-4" /> Download Excel</Button>
      </div>
      {downloadError ? <Notice>{downloadError}</Notice> : null}
      {error ? <Notice><span>{error}</span><Button size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry</Button></Notice> : null}
      {data ? (
        <>
          <p className="text-sm text-muted-foreground">Every month compares with its previous calendar month, including the first selected month. Each metric uses its own scale; hover or focus a bar for exact values.</p>
          {data.combined.points.some((point) => point.monthToDate) ? <Notice>Month-to-date totals use the latest stored day shown on each chart. Growth compares this partial month with the full previous month.</Notice> : null}
          {data.publicViewMethodologyWarning ? <Notice>Public-view counting changed on 24 August 2026. Growth across this range may reflect the methodology change; engaged views provide an additional comparison.</Notice> : null}
          {data.combined.points.every((point) => point.coverage === "missing") ? <Notice>No stored data is available for these channels and months. Change your selection or refresh analytics using the existing data refresh options.</Notice> : null}
          <ChannelCharts series={data.combined} metrics={data.metrics} channelCount={data.channels.length} />
          {data.channels.map((series) => <ChannelCharts key={series.channelId} series={series} metrics={data.metrics} channelCount={1} />)}
          <p className="text-xs text-muted-foreground">Report generated: {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(data.generatedAt))} IST</p>
        </>
      ) : null}
    </div>
  );
}

function MonthField({ label, value, max, onChange }: { label: string; value: string; max: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-sm font-semibold text-muted-foreground">{label}
    <input type="month" min="1900-01" max={max} value={value} onChange={(event) => onChange(event.target.value)}
      className="h-11 min-w-0 rounded-md border bg-background px-3 text-foreground focus-visible:ring-2 focus-visible:ring-ring" />
  </label>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/10 dark:text-amber-100">
    <AlertTriangle className="size-4 shrink-0" />{children}
  </div>;
}

function ChannelCharts({ series, metrics, channelCount }: { series: MonthlyGrowthSeries; metrics: MonthlyGrowthMetric[]; channelCount: number }) {
  const definitions = MONTHLY_GROWTH_METRICS.filter((metric) => metrics.includes(metric.key));
  const gridStyle = { gridTemplateColumns: `160px repeat(${series.points.length}, minmax(148px, 1fr))`, minWidth: `${160 + series.points.length * 148}px` };
  return (
    <Card className="min-w-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><TrendingUp className="size-5 shrink-0 text-primary" />{series.title}</CardTitle>
        <p className="text-xs text-muted-foreground">{series.channelId === "combined" ? `${channelCount} selected ${channelCount === 1 ? "channel" : "channels"} only` : "Individual channel performance"} · Months run left to right</p>
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label={`${series.title}: monthly charts, scroll horizontally for more months`}>
          <div className="grid border-b bg-muted/40" style={gridStyle}>
            <div className="sticky left-0 z-10 flex items-center border-r bg-card p-3 text-sm font-bold">Metric / scale</div>
            {series.points.map((point) => (
              <div key={point.month} className="grid content-start gap-1 p-3 text-center">
                <p className="text-sm font-bold">{formatGrowthMonth(point.month)}</p>
                <p className="text-xs text-muted-foreground">vs {formatGrowthMonth(shiftGrowthMonth(point.month, -1))}</p>
                {point.monthToDate ? <p className="text-xs text-muted-foreground">MTD through {point.periodEnd.slice(8)}</p> : null}
                {point.coverage !== "complete" ? <p className="text-xs text-amber-700 dark:text-amber-300">{point.coverage === "missing" ? "No data" : "Incomplete data"}</p> : null}
              </div>
            ))}
          </div>
          {definitions.map((metric) => {
            const values = series.points.map((point) => point.values[metric.key]!.value).filter((value): value is number => value !== null);
            const min = Math.min(0, ...values);
            const max = Math.max(0, ...values);
            const span = max - min || 1;
            const y = (value: number) => 12 + (max - value) / span * 112;
            return (
              <div key={metric.key} className="grid border-b last:border-b-0" style={gridStyle}>
                <div className="sticky left-0 z-10 flex flex-col justify-between border-r bg-card p-3">
                  <div><h3 className="text-sm font-bold">{metric.label}</h3><p className="text-xs text-muted-foreground">{metric.unit}</p></div>
                  <div className="flex h-28 flex-col justify-between text-right text-xs tabular-nums text-muted-foreground" aria-label="Chart scale">
                    <span>{formatGrowthValue(max, metric.key, true)}</span>
                    <span>{formatGrowthValue(min, metric.key, true)}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Change vs previous month</p>
                </div>
                {series.points.map((point) => <MonthBar key={point.month} point={point} metric={metric.key} y={y} channelCount={channelCount} />)}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MonthBar({ point, metric, y, channelCount }: { point: MonthlyGrowthPoint; metric: MonthlyGrowthMetric; y: (value: number) => number; channelCount: number }) {
  const value = point.values[metric]!;
  const coverage = growthCoverageLabel(point, channelCount);
  const exact = value.value === null ? "Unavailable" : formatGrowthValue(value.value, metric);
  const details = `${formatGrowthMonth(point.month)}: ${exact}. ${comparisonText(value, metric)}. ${coverage}.`;
  const zero = y(0);
  const barY = value.value === null ? zero : y(value.value);
  return (
    <div className="flex flex-col items-center px-2 py-3 text-center">
      <p className="text-sm font-bold tabular-nums" title={exact}>{value.value === null ? "Unavailable" : formatGrowthValue(value.value, metric, true)}</p>
      <div tabIndex={0} role="img" aria-label={details} title={details} className="group relative my-2 w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <svg width="100%" height="136" viewBox="0 0 120 136" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="120" y1={zero} y2={zero} stroke="currentColor" className="text-border" />
          {value.value !== null && value.value !== 0 ? <rect x="34" width="52" y={Math.min(barY, zero)} height={Math.abs(zero - barY)} rx="3"
            fill="currentColor" className={point.coverage === "complete" ? "text-primary" : "text-primary opacity-40"} /> : null}
          {value.value === 0 ? <circle cx="60" cy={zero} r="3" fill="currentColor" className="text-primary" /> : null}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden rounded-md border bg-card p-2 text-xs shadow-sm group-hover:block group-focus:block" aria-hidden="true">{exact}<br />{comparisonText(value, metric)}<br />{coverage}</div>
      </div>
      <GrowthBadge value={value} />
      <p className="mt-1 min-h-4 text-xs tabular-nums text-muted-foreground">{value.change === null ? "Comparison unavailable" : formatGrowthValue(value.change, metric, false, true)}</p>
      {point.coverage === "incomplete" ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{point.observedDays}/{point.expectedDays} {channelCount > 1 ? "channel-days" : "days"}</p> : null}
    </div>
  );
}

function GrowthBadge({ value }: { value: MonthlyGrowthValue }) {
  if (value.change === null) return <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">—</span>;
  const up = value.change > 0;
  const down = value.change < 0;
  const color = up ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" : down ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300" : "bg-muted text-muted-foreground";
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${color}`}>
    {up ? "↑ " : down ? "↓ " : ""}{value.change === 0 ? "No change" : value.percent === null ? "N/A %" : `${Math.abs(value.percent).toFixed(1)}%`}
  </span>;
}

function comparisonText(value: MonthlyGrowthValue, metric: MonthlyGrowthMetric) {
  if (value.change === null) return "Comparison unavailable due to missing data";
  return `${formatGrowthValue(value.change, metric, false, true)}; ${value.percent === null ? "percentage unavailable for zero or negative baseline" : `${value.percent > 0 ? "+" : ""}${value.percent.toFixed(1)}%`} versus previous month`;
}
