"use client";

import { AlertTriangle, BarChart3, CheckSquare, Download, FileText, LoaderCircle, Search, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RangeChannelSeries, RangeDashboardData, RangeMetricValues } from "@/lib/range-dashboard";
import { buildRangeMonthlyCsv } from "@/lib/range-export";
import type { StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";

type Props = {
  canViewRevenue: boolean;
  channels: StoredYoutubeManagedChannel[];
  defaultEndDate: string;
  defaultStartDate: string;
};

type MetricKey = keyof Pick<RangeMetricValues, "estimatedRevenue" | "netSubscribers" | "views" | "engagedViews" | "watchHours">;

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#059669", "#7c3aed", "#be123c"];
const METRICS: Array<{ metricKey: MetricKey; label: string; formatter: (value: number) => string }> = [
  { metricKey: "views", label: "Daily public views", formatter: formatCompact },
  { metricKey: "engagedViews", label: "Daily engaged views", formatter: formatCompact },
  { metricKey: "watchHours", label: "Daily watch hours", formatter: formatCompact },
  { metricKey: "netSubscribers", label: "Daily net subscribers", formatter: formatSigned },
  { metricKey: "estimatedRevenue", label: "Daily estimated revenue", formatter: formatCurrency }
];

export function RangeAnalyticsDashboard({ canViewRevenue, channels, defaultEndDate, defaultStartDate }: Props) {
  const defaultIds = useMemo(() => {
    const kidsIds = channels.filter((channel) => /^KidsOne/i.test(channel.title)).map((channel) => channel.channelId);
    return kidsIds.length > 0 ? kidsIds : channels.slice(0, 6).map((channel) => channel.channelId);
  }, [channels]);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [selectedIds, setSelectedIds] = useState(defaultIds);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<RangeDashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const visibleChannels = channels.filter((channel) => channel.title.toLowerCase().includes(search.trim().toLowerCase()));
  const invalidRange = startDate > endDate;

  const load = async () => {
    if (!startDate || !endDate || invalidRange || selectedIds.length === 0 || loading) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ startDate, endDate });
      selectedIds.forEach((id) => params.append("channel", id));
      const response = await fetch(`/api/range-dashboard?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = (await response.json()) as RangeDashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load range analytics.");
      setData(payload);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load range analytics.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
    // Initial data only; filters are applied explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleChannel = (channelId: string) => {
    setSelectedIds((ids) => ids.includes(channelId) ? ids.filter((id) => id !== channelId) : [...ids, channelId]);
    setData(null);
  };

  const metrics = (canViewRevenue ? METRICS : METRICS.filter((metric) => metric.metricKey !== "estimatedRevenue"))
    .filter((metric) => metric.metricKey !== "engagedViews" || data?.engagedViewsAvailable !== false);

  return (
    <div className="grid gap-4">
      <Card className="youtube-print-hidden shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4 text-primary" /> Dashboard filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <DateField label="Start date" value={startDate} onChange={(value) => { setStartDate(value); setData(null); }} />
            <DateField label="End date" value={endDate} onChange={(value) => { setEndDate(value); setData(null); }} />
            <Button className="h-10" disabled={loading || invalidRange || selectedIds.length === 0} onClick={() => void load()}>
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
              Generate graphs
            </Button>
          </div>

          <div className="rounded-md border bg-background/70 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black">Channels ({selectedIds.length} selected)</p>
                <p className="text-xs font-semibold text-muted-foreground">Choose one or more channels to overlay on every graph.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setSelectedIds(channels.map((channel) => channel.channelId)); setData(null); }}>Select all</Button>
                <Button size="sm" variant="secondary" onClick={() => { setSelectedIds(channels.filter((channel) => /^KidsOne/i.test(channel.title)).map((channel) => channel.channelId)); setData(null); }}>Kids channels</Button>
                <Button size="sm" variant="secondary" onClick={() => { setSelectedIds([]); setData(null); }}>Clear</Button>
              </div>
            </div>
            <label className="relative mt-3 block">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Search channels" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="mt-3 grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {visibleChannels.map((channel) => {
                const checked = selectedIds.includes(channel.channelId);
                return (
                  <button className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-semibold hover:bg-muted/60" key={channel.channelId} onClick={() => toggleChannel(channel.channelId)} type="button">
                    {checked ? <CheckSquare className="size-4 shrink-0 text-primary" /> : <Square className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{channel.title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {invalidRange ? <ErrorMessage message="End date must be on or after the start date." /> : null}
          {selectedIds.length === 0 ? <ErrorMessage message="Select at least one channel." /> : null}
          {error ? <ErrorMessage message={error} /> : null}
        </CardContent>
      </Card>

      {data ? (
        <>
          <Card className="youtube-print-hidden shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black">Download analytics</p>
                <p className="text-xs font-semibold text-muted-foreground">
                  PDF includes the dashboard shown below; choose Save as PDF in the print dialog. CSV contains one row per channel for every month in the selected range.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => downloadMonthlyCsv(data)} type="button">
                  <Download className="size-4" /> Download CSV
                </Button>
                <RangePdfDownloadButton data={data} />
              </div>
            </CardContent>
          </Card>

          {data.publicViewMethodologyWarning ? (
            <ErrorMessage message="This range crosses August 24, 2026, so public views use mixed counting definitions. Use engaged views for performance comparisons." />
          ) : null}

          <section className={`grid gap-3 sm:grid-cols-2 ${canViewRevenue ? "xl:grid-cols-6" : "xl:grid-cols-5"}`}>
            <SummaryCard label="Public views" value={formatCompact(data.totals.views)} />
            <SummaryCard label="Engaged views" value={data.engagedViewsAvailable ? formatCompact(data.totals.engagedViews ?? 0) : "Unavailable"} />
            <SummaryCard label="Engagement rate" value={data.engagedViewsAvailable && data.totals.engagementRate !== null ? `${data.totals.engagementRate.toFixed(1)}%` : "Unavailable"} />
            <SummaryCard label="Watch hours" value={formatCompact(data.totals.watchHours)} />
            <SummaryCard label="Net subscribers" value={formatSigned(data.totals.netSubscribers)} />
            {canViewRevenue ? <SummaryCard label="Estimated revenue" value={formatCurrency(data.totals.estimatedRevenue ?? 0)} /> : null}
          </section>

          <Card className="shadow-sm">
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-xs font-semibold text-muted-foreground">
              <span>Requested: {formatDate(data.startDate)} – {formatDate(data.endDate)}</span>
              <span>Available data: {data.coverage.firstDay ? `${formatDate(data.coverage.firstDay)} – ${formatDate(data.coverage.lastDay ?? data.coverage.firstDay)}` : "No rows found"}</span>
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            {metrics.map((metric) => <MultiSeriesChart data={data} key={metric.metricKey} {...metric} />)}
          </section>

          <section className="grid gap-4">
            <div>
              <h2 className="text-lg font-black">Individual channel graphs</h2>
              <p className="text-sm font-semibold text-muted-foreground">
                Separate daily trends for every selected channel in the same date range.
              </p>
            </div>
            {data.series.map((series) => {
              const channelData: RangeDashboardData = {
                ...data,
                series: [series],
                totals: series.totals
              };

              return (
                <div className="rounded-lg border bg-card/60 p-4 shadow-sm" key={series.channel.channelId}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-black">{series.channel.title}</h3>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {formatDate(data.startDate)} – {formatDate(data.endDate)}
                    </span>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {metrics.map((metric) => (
                      <MultiSeriesChart
                        data={channelData}
                        key={`${series.channel.channelId}-${metric.metricKey}`}
                        {...metric}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>

          <Card className="shadow-sm">
            <CardHeader><CardTitle className="text-base">Channel totals for selected range</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-3 py-2">Channel</th><th className="px-3 py-2 text-right">Public views</th><th className="px-3 py-2 text-right">Engaged views</th><th className="px-3 py-2 text-right">Engagement</th><th className="px-3 py-2 text-right">Watch hours</th><th className="px-3 py-2 text-right">Net subscribers</th>{canViewRevenue ? <th className="px-3 py-2 text-right">Revenue</th> : null}</tr></thead>
                <tbody>{data.series.map((item, index) => <tr className="border-b last:border-0" key={item.channel.channelId}><td className="px-3 py-3 font-bold"><span className="mr-2 inline-block size-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{item.channel.title}</td><td className="px-3 py-3 text-right tabular-nums">{formatNumber(item.totals.views)}</td><td className="px-3 py-3 text-right tabular-nums">{item.totals.engagedViews === null ? "Unavailable" : formatNumber(item.totals.engagedViews)}</td><td className="px-3 py-3 text-right tabular-nums">{item.totals.engagementRate === null ? "Unavailable" : `${item.totals.engagementRate.toFixed(1)}%`}</td><td className="px-3 py-3 text-right tabular-nums">{formatNumber(item.totals.watchHours)}</td><td className="px-3 py-3 text-right tabular-nums">{formatSigned(item.totals.netSubscribers)}</td>{canViewRevenue ? <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(item.totals.estimatedRevenue ?? 0)}</td> : null}</tr>)}</tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function MultiSeriesChart({ data, formatter, metricKey, label }: { data: RangeDashboardData; formatter: (value: number) => string; metricKey: MetricKey; label: string }) {
  const values = data.series.flatMap((series) => series.points.map((point) => Number(point[metricKey] ?? 0)));
  const min = metricKey === "netSubscribers" ? Math.min(0, ...values) : 0;
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const startTime = new Date(`${data.startDate}T00:00:00Z`).getTime();
  const endTime = new Date(`${data.endDate}T00:00:00Z`).getTime();
  const timeSpan = endTime - startTime || 1;
  const x = (day: string) => 42 + ((new Date(`${day}T00:00:00Z`).getTime() - startTime) / timeSpan) * 556;
  const y = (value: number) => 172 - ((value - min) / span) * 140;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2"><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent>
        <svg className="h-64 w-full" preserveAspectRatio="none" role="img" viewBox="0 0 640 210">
          <title>{label} by channel from {data.startDate} to {data.endDate}</title>
          {[0, 0.5, 1].map((ratio) => { const value = min + span * ratio; const lineY = y(value); return <g key={ratio}><line className="stroke-border" x1="42" x2="598" y1={lineY} y2={lineY} /><text className="fill-muted-foreground text-[10px]" x="4" y={lineY + 3}>{formatter(value)}</text></g>; })}
          {data.series.map((series, index) => {
            const points = series.points.map((point) => `${x(point.day)},${y(Number(point[metricKey] ?? 0))}`).join(" ");
            return <polyline fill="none" key={series.channel.channelId} points={points} stroke={COLORS[index % COLORS.length]} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />;
          })}
          <text className="fill-muted-foreground text-[10px]" x="42" y="198">{formatDate(data.startDate)}</text>
          <text className="fill-muted-foreground text-[10px]" textAnchor="end" x="598" y="198">{formatDate(data.endDate)}</text>
        </svg>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {data.series.map((series, index) => <div className="flex items-center gap-1.5 text-xs font-semibold" key={series.channel.channelId}><span className="size-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{series.channel.title}</div>)}
        </div>
      </CardContent>
    </Card>
  );
}

function DateField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="grid gap-1 text-sm font-semibold text-muted-foreground">{label}<input className="h-10 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring" type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function SummaryCard({ label, value }: { label: string; value: string }) { return <Card className="shadow-sm"><CardContent className="p-4"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{value}</p></CardContent></Card>; }
function ErrorMessage({ message }: { message: string }) { return <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive"><AlertTriangle className="size-4 shrink-0" />{message}</div>; }
function RangePdfDownloadButton({ data }: { data: RangeDashboardData }) {
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    const finish = () => setPreparing(false);
    window.addEventListener("afterprint", finish);
    return () => window.removeEventListener("afterprint", finish);
  }, []);

  const download = () => {
    const previousTitle = document.title;
    document.title = rangeExportFilename(data, "pdf");
    setPreparing(true);
    window.setTimeout(() => {
      window.print();
      document.title = previousTitle;
      window.setTimeout(() => setPreparing(false), 1000);
    }, 50);
  };

  return (
    <Button disabled={preparing} onClick={download} type="button">
      {preparing ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
      {preparing ? "Preparing PDF…" : "Download PDF"}
    </Button>
  );
}

function downloadMonthlyCsv(data: RangeDashboardData) {
  const blob = new Blob([buildRangeMonthlyCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = rangeExportFilename(data, "csv");
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function rangeExportFilename(data: RangeDashboardData, extension: "csv" | "pdf") {
  return `date-range-analytics-${data.startDate}-to-${data.endDate}.${extension}`;
}
function formatCompact(value: number) { return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value); }
function formatSigned(value: number) { return `${value > 0 ? "+" : ""}${formatNumber(value)}`; }
function formatCurrency(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
