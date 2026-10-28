"use client";

import { Download, LoaderCircle, RefreshCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DAILY_STATUS_METRICS, getSelectedDailyStatusMetrics, getDailyStatusWindow, validateDailyStatusSelection, type DailyStatusChannel, type DailyStatusData, type DailyStatusMetric,
  type DailyStatusMetrics, type DailyStatusSection, type RecentVideoMetrics } from "@/lib/daily-status";
import { buildDailyStatusExport } from "@/lib/daily-status-export";
import { buildStyledReportWorkbook } from "@/lib/xlsx-export";

type Props = { channels: DailyStatusChannel[]; canViewRevenue: boolean; today: string; defaultDate: string };
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function DailyStatusDashboard({ channels, canViewRevenue, today, defaultDate }: Props) {
  const [date, setDate] = useState(defaultDate);
  const [selectedIds, setSelectedIds] = useState(channels.map((channel) => channel.channelId));
  const availableMetrics = DAILY_STATUS_METRICS.filter((metric) => canViewRevenue || metric.valueKey !== "estimatedRevenue");
  const [selectedMetrics, setSelectedMetrics] = useState<DailyStatusMetric[]>(availableMetrics.map((metric) => metric.key));
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const forceRefreshQuery = useRef<string | null>(null);
  const [downloadError, setDownloadError] = useState<{ key: string; message: string } | null>(null);
  const [result, setResult] = useState<{ key: string; data?: DailyStatusData; error?: string } | null>(null);
  const query = useMemo(() => {
    const params = new URLSearchParams({ date });
    [...selectedIds].sort().forEach((id) => params.append("channel", id));
    return params.toString();
  }, [date, selectedIds]);
  const requestKey = `${query}|${retry}`;
  let validationError = "";
  try { validateDailyStatusSelection(date, selectedIds, channels.map((channel) => channel.channelId), today); }
  catch (error) { validationError = error instanceof Error ? error.message : "Check your selection."; }
  const current = result?.key === requestKey ? result : null;
  const loading = !validationError && !current;
  const data = current?.data;
  const metrics = getSelectedDailyStatusMetrics(selectedMetrics, canViewRevenue);
  const allVideoMetrics = metrics.filter((metric) => metric.section === "allVideos");
  const recentVideoMetrics = metrics.filter((metric) => metric.section === "recentVideos");
  const window = !validationError ? getDailyStatusWindow(date) : null;

  useEffect(() => {
    if (validationError) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams(query);
        if (forceRefreshQuery.current === query) params.set("refresh", "1");
        forceRefreshQuery.current = null;
        const response = await fetch(`/api/daily-status?${params}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load daily status.");
        if (!controller.signal.aborted) setResult({ key: requestKey, data: payload });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key: requestKey, error: error instanceof Error ? error.message : "Unable to load daily status." });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, requestKey, validationError]);

  useEffect(() => {
    if (!data || validationError) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/daily-status?${query}`, { signal: controller.signal, cache: "no-store" });
        if (response.ok) {
          const payload = await response.json();
          if (!controller.signal.aborted) setResult({ key: requestKey, data: payload });
        }
      } catch { /* Keep the current saved results when a quiet reload fails. */ }
      finally { pending = false; }
    }, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [data, query, requestKey, validationError]);

  const toggle = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  const toggleMetric = (key: DailyStatusMetric) => setSelectedMetrics((keys) => keys.includes(key) ? keys.filter((value) => value !== key) : [...keys, key]);
  const refresh = () => { forceRefreshQuery.current = query; setRetry((value) => value + 1); };
  const hasUnavailable = data?.rows.some((row) => (allVideoMetrics.length > 0 && row.allVideos.status !== "available") ||
    (recentVideoMetrics.length > 0 && row.recentVideos.status !== "available"));

  const download = () => {
    if (!data || validationError || !data.rows.length || !metrics.length) return;
    setDownloadError(null);
    try {
      const report = buildDailyStatusExport(data, canViewRevenue, selectedMetrics);
      const workbook = buildStyledReportWorkbook(report);
      const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = report.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch {
      setDownloadError({ key: requestKey, message: "Unable to generate the Excel report. Please try again." });
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <Card className="shadow-sm">
        <CardHeader><CardTitle className="text-base">Dashboard filters</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid flex-1 gap-1 text-sm font-bold sm:max-w-xs">Date
              <input type="date" min="2005-01-01" max={today} value={date} onChange={(event) => setDate(event.target.value)}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button variant="secondary" disabled={!!validationError || loading} onClick={refresh}><RefreshCcw className="size-4" />Refresh data</Button>
            <Button variant="secondary" disabled={!!validationError || !data?.rows.length || !metrics.length} onClick={download}><Download className="size-4" />Download Excel</Button>
          </div>
          <fieldset className="min-w-0 rounded-md border p-3">
            <legend className="px-1 text-sm font-bold">Channels ({selectedIds.length} selected)</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative w-full min-w-0 flex-none sm:w-auto sm:flex-1"><span className="sr-only">Search channels</span><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input placeholder="Search channels" value={search} onChange={(event) => setSearch(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <Button size="sm" variant="secondary" onClick={() => setSelectedIds(channels.map((channel) => channel.channelId))}>All accessible channels</Button>
              <Button size="sm" variant="secondary" onClick={() => setSelectedIds([])}>Clear</Button>
            </div>
            <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {channels.filter((channel) => channel.title.toLowerCase().includes(search.toLowerCase())).map((channel) => (
                <label key={channel.channelId} className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm font-semibold">
                  <input type="checkbox" checked={selectedIds.includes(channel.channelId)} onChange={() => toggle(channel.channelId)} className="size-4 shrink-0 accent-primary" />
                  <span className="break-words">{channel.title}</span>
                </label>
              ))}
            </div>
            {!channels.length && <p className="mt-2 text-sm text-muted-foreground">No channels are accessible for this account.</p>}
          </fieldset>
          <fieldset className="min-w-0 rounded-md border p-3">
            <legend className="px-1 text-sm font-bold">Metrics ({metrics.length} selected)</legend>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSelectedMetrics(availableMetrics.map((metric) => metric.key))}>All metrics</Button>
              <Button size="sm" variant="secondary" onClick={() => setSelectedMetrics([])}>Clear metrics</Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {availableMetrics.map((metric) => <label key={metric.key} className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm font-semibold">
                <input type="checkbox" checked={selectedMetrics.includes(metric.key)} onChange={() => toggleMetric(metric.key)} className="size-4 shrink-0 accent-primary" />
                <span>{metric.label}</span>
              </label>)}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">Metrics use YouTube reporting dates. Publication dates use India time (IST). Recent dates may still be processing in YouTube.</p>
          <p className="text-xs text-muted-foreground">Daily results are stored in the database. A separate background worker refreshes the last 10 completed days. This view reloads saved results every minute while visible. Refresh data fetches a new copy for this selection.</p>
        </CardContent>
      </Card>

      {validationError && <p role="alert" className="rounded-md border bg-card p-4 text-sm">{validationError}</p>}
      {!metrics.length && <p role="alert" className="rounded-md border bg-card p-4 text-sm">Select at least one metric to display and download.</p>}
      {downloadError?.key === requestKey && <p role="alert" className="rounded-md border bg-card p-4 text-sm">{downloadError.message}</p>}
      {loading && <div role="status" className="flex items-center justify-center gap-3 rounded-lg border bg-card p-8"><LoaderCircle className="size-6 animate-spin text-primary" /><span>Loading daily status and recent-video analytics…</span></div>}
      {current?.error && <div role="alert" className="rounded-md border bg-card p-4 text-sm"><p>{current.error}</p><Button className="mt-3" variant="secondary" onClick={refresh}>Retry</Button></div>}
      {data && metrics.length > 0 && <>
        {allVideoMetrics.length > 0 && <section aria-labelledby="all-videos-heading" className="grid gap-3">
          <h2 id="all-videos-heading" className="text-lg font-black">All videos · {formatDate(data.date)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {allVideoMetrics.map((metric) => <MetricCard key={metric.key} label={metric.label} section={data.totals.allVideos} metric={metric.valueKey}
              helper={metric.key === "netSubscribers" ? "Gained minus lost on this day" : undefined} />)}
          </div>
          {data.totals.allVideos.message && <p className="text-sm text-muted-foreground">{data.totals.allVideos.message}</p>}
        </section>}
        {recentVideoMetrics.length > 0 && <section aria-labelledby="recent-videos-heading" className="grid gap-3">
          <div><h2 id="recent-videos-heading" className="text-lg font-black">Videos published in the last two months</h2>
            <p className="mt-1 text-sm text-muted-foreground">Published {formatDate(data.publicationWindow.startDate)} – {formatDate(data.publicationWindow.endDate)} (IST, inclusive). Performance earned on {formatDate(data.date)} only.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {recentVideoMetrics.map((metric) => <MetricCard key={metric.key} label={metric.label} section={data.totals.recentVideos} metric={metric.valueKey}
              helper={metric.key === "recentRevenue" && data.totals.recentVideos.values?.estimatedRevenue == null ? "Revenue has not been reported for every selected channel yet." : undefined} />)}
          </div>
          {data.totals.recentVideos.message && <p className="text-sm text-muted-foreground">{data.totals.recentVideos.message}</p>}
          {data.totals.recentVideos.updatedAt && <p className="text-xs text-muted-foreground">Recent-video data last fetched: {formatFetchedAt(data.totals.recentVideos.updatedAt)}{data.rows.length > 1 ? " (oldest selected channel)" : ""}.</p>}
          {canViewRevenue && recentVideoMetrics.some((metric) => metric.key === "recentRevenue") && data.totals.recentVideos.revenueUpdatedAt && <p className="text-xs text-muted-foreground">Recent-video revenue last reported: {formatFetchedAt(data.totals.recentVideos.revenueUpdatedAt)}.</p>}
          {data.totals.recentVideos.cacheWarning && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{data.totals.recentVideos.cacheWarning}</p>}
        </section>}
        {hasUnavailable && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm"><span>Some data is unavailable. Channel results below show which sections need attention.</span><Button size="sm" variant="secondary" onClick={refresh}>Retry unavailable data</Button></div>}
        <Card className="min-w-0 shadow-sm"><CardHeader><CardTitle className="text-base">Channel breakdown</CardTitle></CardHeader><CardContent>
          <p className="mb-2 text-xs text-muted-foreground lg:hidden">Scroll the table horizontally to see all metrics.</p>
          <div role="region" aria-label="Channel performance metrics" tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>
              {["Channel", ...metrics.map((metric) => metric.label), "Availability"].map((title) => <th key={title} className="px-3 py-3 font-black">{title}</th>)}
            </tr></thead>
            <tbody>{data.rows.map((row) => <tr key={row.channelId} className="border-t">
              <th scope="row" className="px-3 py-3 text-left font-bold">{row.title}</th>
              {metrics.map((metric) => <ValueCell key={metric.key} section={row[metric.section]} metric={metric.valueKey} />)}
              <td className="max-w-xs px-3 py-3 text-xs text-muted-foreground">{allVideoMetrics.length > 0 && <p>All videos: {availability(row.allVideos)}</p>}{recentVideoMetrics.length > 0 && <p className={allVideoMetrics.length ? "mt-1" : undefined}>Recent videos: {availability(row.recentVideos)}{row.recentVideos.values ? ` (${number.format(row.recentVideos.values.videoCount)} videos)` : ""}</p>}</td>
            </tr>)}</tbody>
          </table></div>
          <p className="mt-3 text-xs text-muted-foreground">Loaded: {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(data.generatedAt))} IST</p>
        </CardContent></Card>
      </>}
      {!data && window && !loading && !current?.error && <p className="text-sm text-muted-foreground">Publication window: {formatDate(window.startDate)} – {formatDate(window.endDate)} (IST).</p>}
    </div>
  );
}

type MetricSection = DailyStatusSection<DailyStatusMetrics> | DailyStatusSection<RecentVideoMetrics>;
type Metric = "views" | "watchHours" | "netSubscribers" | "estimatedRevenue";
function formatValue(section: MetricSection, metric: Metric) {
  const value = section.values && (section.values as Partial<DailyStatusMetrics>)[metric];
  if (value === undefined || value === null || section.status !== "available") return "Unavailable";
  return metric === "estimatedRevenue" ? currency.format(value) : number.format(value);
}
function availability(section: MetricSection) {
  return [section.message || (section.status === "available" ? "Available" : "Unavailable"),
    section.updatedAt ? `${section.source === "cache" ? "Saved result" : "Fetched"}: ${formatFetchedAt(section.updatedAt)}.` : "",
    section.revenueUpdatedAt ? `Revenue fetched: ${formatFetchedAt(section.revenueUpdatedAt)}.` : "",
    section.stale ? "Saved result is out of date." : "", section.cacheWarning].filter(Boolean).join(" ");
}
function formatFetchedAt(value: string) { return `${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value))} IST`; }
function MetricCard({ label, section, metric, helper }: { label: string; section: MetricSection; metric: Metric; helper?: string }) {
  return <Card className="shadow-sm"><CardContent className="p-4"><div className="text-sm font-bold text-muted-foreground">{label}</div>
    <div className="mt-2 break-words text-2xl font-black">{formatValue(section, metric)}</div>{helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}</CardContent></Card>;
}
function ValueCell({ section, metric }: { section: MetricSection; metric: Metric }) { return <td className="px-3 py-3 tabular-nums">{formatValue(section, metric)}</td>; }
function formatDate(date: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
