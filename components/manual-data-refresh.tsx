"use client";

import { CheckSquare, LoaderCircle, RefreshCcw, Search, Square } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMaximumManualRefreshEndDate, isManualRefreshRangeValid } from "@/lib/manual-data-refresh";

type RefreshChannel = {
  channelId: string;
  title: string;
};

type RefreshResult = {
  channelId: string;
  channelTitle: string;
  error?: string;
  metricsRowsSynced?: number;
  status: "failed" | "success";
  warnings?: string[];
};

type RefreshPayload = {
  error?: string;
  failed?: number;
  results?: RefreshResult[];
  status?: "failed" | "partial" | "success";
  succeeded?: number;
};

type MessageTone = "error" | "info" | "success";

export function ManualDataRefresh({
  channels,
  defaultEndDate,
  defaultStartDate
}: {
  channels: RefreshChannel[];
  defaultEndDate: string;
  defaultStartDate: string;
}) {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [search, setSearch] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("info");
  const [errors, setErrors] = useState<RefreshResult[]>([]);

  const selectedChannelSet = useMemo(() => new Set(selectedChannelIds), [selectedChannelIds]);
  const filteredChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter(
      (channel) =>
        channel.title.toLowerCase().includes(query) || channel.channelId.toLowerCase().includes(query)
    );
  }, [channels, search]);
  const maximumEndDate = getMaximumManualRefreshEndDate(startDate);
  const rangeIsValid = isManualRefreshRangeValid(startDate, endDate);
  const canRefresh = rangeIsValid && selectedChannelIds.length > 0 && !isRefreshing;

  const runRefresh = async () => {
    if (!canRefresh) return;

    setErrors([]);
    setMessage(`Force-refreshing ${selectedChannelIds.length} channel(s). Keep this page open...`);
    setMessageTone("info");
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/youtube/manual-refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelIds: selectedChannelIds, endDate, startDate })
      });
      const payload = (await response.json().catch(() => null)) as RefreshPayload | null;
      if (!response.ok || !payload) {
        setMessage(payload?.error ?? "Manual data refresh failed.");
        setMessageTone("error");
        return;
      }

      const failedResults = payload.results?.filter((result) => result.status === "failed") ?? [];
      setErrors(failedResults);
      if (failedResults.length > 0) {
        setMessageTone("error");
        setMessage(
          `Refresh completed with errors: ${payload.succeeded ?? 0} succeeded and ${payload.failed ?? failedResults.length} failed.`
        );
      } else {
        setMessageTone("success");
        const warningCount =
          payload.results?.reduce((total, result) => total + (result.warnings?.length ?? 0), 0) ?? 0;
        setMessage(
          `Refresh complete: ${payload.succeeded ?? selectedChannelIds.length} channel(s) refreshed${
            warningCount > 0 ? ` with ${warningCount} warning(s)` : ""
          }.`
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Manual data refresh failed.");
      setMessageTone("error");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCcw className="size-4 text-primary" />
          Manual data refresh
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Force-refresh stored analytics for selected channels. A single refresh can cover up to two months.
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <DateField label="Start date" value={startDate} onChange={setStartDate} />
          <DateField label="End date" value={endDate} max={maximumEndDate} onChange={setEndDate} />
        </div>
        {!rangeIsValid && startDate && endDate ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            Choose a valid range no longer than two months. The latest allowed end date is {maximumEndDate || "unavailable"}.
          </p>
        ) : null}

        <div className="grid gap-3 rounded-md border bg-background/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold">
              {selectedChannelIds.length === channels.length && channels.length > 0 ? (
                <CheckSquare className="size-4 text-primary" />
              ) : (
                <Square className="size-4 text-muted-foreground" />
              )}
              Channels ({selectedChannelIds.length} selected)
            </div>
            <div className="flex gap-2">
              <button
                className="text-xs font-bold text-primary hover:underline disabled:opacity-50"
                disabled={isRefreshing || channels.length === 0}
                onClick={() => setSelectedChannelIds(channels.map((channel) => channel.channelId))}
                type="button"
              >
                Select all
              </button>
              <button
                className="text-xs font-bold text-muted-foreground hover:underline disabled:opacity-50"
                disabled={isRefreshing || selectedChannelIds.length === 0}
                onClick={() => setSelectedChannelIds([])}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              disabled={isRefreshing}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search channels"
              value={search}
            />
          </label>
          <div className="max-h-64 overflow-auto rounded-md border">
            {filteredChannels.map((channel) => (
              <label
                className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                key={channel.channelId}
              >
                <input
                  checked={selectedChannelSet.has(channel.channelId)}
                  className="size-4 accent-primary"
                  disabled={isRefreshing}
                  onChange={() =>
                    setSelectedChannelIds((current) =>
                      current.includes(channel.channelId)
                        ? current.filter((channelId) => channelId !== channel.channelId)
                        : [...current, channel.channelId]
                    )
                  }
                  type="checkbox"
                />
                <span className="font-semibold text-foreground">{channel.title}</span>
              </label>
            ))}
            {filteredChannels.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No channels found.</div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {startDate || "Start date"} to {endDate || "End date"} · {selectedChannelIds.length} channel(s)
          </div>
          <Button className="h-11 gap-2 rounded-md" disabled={!canRefresh} onClick={runRefresh} type="button">
            {isRefreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            {isRefreshing ? "Force-refreshing..." : "Force refresh data"}
          </Button>
        </div>

        {message ? (
          <p
            className={
              messageTone === "error"
                ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
                : messageTone === "success"
                  ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
                  : "rounded-md border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground"
            }
          >
            {message}
          </p>
        ) : null}
        {errors.length > 0 ? (
          <div className="grid gap-2 rounded-md border border-destructive/40 p-3">
            {errors.map((result) => (
              <div className="text-sm" key={result.channelId}>
                <span className="font-bold text-foreground">{result.channelTitle}:</span>{" "}
                <span className="text-destructive">{result.error ?? "Refresh failed."}</span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DateField({
  label,
  max,
  onChange,
  value
}: {
  label: string;
  max?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
      {label}
      <input
        className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
        max={max || undefined}
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  );
}
