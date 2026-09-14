"use client";

import { CheckSquare, Search, Square } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { ReportDownloadButton } from "@/components/report-download-button";
import { buttonVariants } from "@/components/ui/button";
import {
  getTargetAchievementColumns,
  type TargetAchievementColumnId
} from "@/lib/monthly-target-metrics";
import type { ManagedChannel } from "@/lib/youtube-performance";

type TargetAchievementReportDownloadProps = {
  canViewRevenue: boolean;
  channels: ManagedChannel[];
  defaultMonth: string;
  schemaReady: boolean;
};

export function TargetAchievementReportDownload({
  canViewRevenue,
  channels,
  defaultMonth,
  schemaReady
}: TargetAchievementReportDownloadProps) {
  const [month, setMonth] = useState(defaultMonth);
  const [periodMode, setPeriodMode] = useState<"month" | "custom">("month");
  const [startDate, setStartDate] = useState(() => getMonthBounds(defaultMonth).startDate);
  const [endDate, setEndDate] = useState(() => getMonthBounds(defaultMonth).endDate);
  const [channelSearch, setChannelSearch] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState(() =>
    channels.map((channel) => channel.channelId)
  );
  const availableColumns = useMemo(
    () => getTargetAchievementColumns(canViewRevenue, month),
    [canViewRevenue, month]
  );
  const [selectedColumnIds, setSelectedColumnIds] = useState<TargetAchievementColumnId[]>(() =>
    getTargetAchievementColumns(canViewRevenue, defaultMonth).map((column) => column.id)
  );
  const selectedChannelSet = useMemo(() => new Set(selectedChannelIds), [selectedChannelIds]);
  const selectedColumnSet = useMemo(() => new Set(selectedColumnIds), [selectedColumnIds]);
  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channels;

    return channels.filter(
      (channel) =>
        channel.title.toLowerCase().includes(query) || channel.channelId.toLowerCase().includes(query)
    );
  }, [channelSearch, channels]);
  const downloadHref = useMemo(() => {
    const query = new URLSearchParams({ report: "target-achievement", month });
    if (periodMode === "custom") {
      query.set("startDate", startDate);
      query.set("endDate", endDate);
    }
    for (const channelId of selectedChannelIds) query.append("channel", channelId);
    for (const columnId of selectedColumnIds) query.append("column", columnId);
    return `/api/reports/monthly?${query.toString()}`;
  }, [endDate, month, periodMode, selectedChannelIds, selectedColumnIds, startDate]);
  const monthBounds = getMonthBounds(month);
  const isInvalidDateRange =
    periodMode === "custom" &&
    (!startDate ||
      !endDate ||
      startDate > endDate ||
      startDate.slice(0, 7) !== month ||
      endDate.slice(0, 7) !== month);

  return (
    <div className="grid gap-5">
      <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
        Target Month
        <input
          type="month"
          value={month}
          onChange={(event) => {
            const nextMonth = event.target.value;
            const bounds = getMonthBounds(nextMonth);
            setMonth(nextMonth);
            setStartDate(bounds.startDate);
            setEndDate(bounds.endDate);
            setSelectedColumnIds(
              getTargetAchievementColumns(canViewRevenue, nextMonth).map((column) => column.id)
            );
          }}
          className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
        />
      </label>

      <div className="grid gap-3">
        <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
          Achievement Period
          <select
            value={periodMode}
            onChange={(event) => setPeriodMode(event.target.value as "month" | "custom")}
            className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          >
            <option value="month">Entire month</option>
            <option value="custom">Custom period within month</option>
          </select>
        </label>
        {periodMode === "custom" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <DateField
              label="Start Date"
              value={startDate}
              min={monthBounds.startDate}
              max={monthBounds.endDate}
              onChange={setStartDate}
            />
            <DateField
              label="End Date"
              value={endDate}
              min={monthBounds.startDate}
              max={monthBounds.endDate}
              onChange={setEndDate}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <SelectorPanel
          title="Channels"
          count={selectedChannelIds.length}
          total={channels.length}
          onSelectAll={() => setSelectedChannelIds(channels.map((channel) => channel.channelId))}
          onClear={() => setSelectedChannelIds([])}
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={channelSearch}
              onChange={(event) => setChannelSearch(event.target.value)}
              placeholder="Search channels"
              className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="max-h-72 overflow-auto rounded-md border">
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
                  }}
                />
                <span className="font-semibold text-foreground">{channel.title}</span>
              </label>
            ))}
            {filteredChannels.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No channels found.</div>
            ) : null}
          </div>
        </SelectorPanel>

        <SelectorPanel
          title="Report Columns"
          count={selectedColumnIds.length}
          total={availableColumns.length}
          onSelectAll={() => setSelectedColumnIds(availableColumns.map((column) => column.id))}
          onClear={() => setSelectedColumnIds([])}
        >
          <div className="max-h-80 overflow-auto rounded-md border">
            {availableColumns.map((column) => (
              <label
                className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm font-semibold last:border-b-0 hover:bg-muted/50"
                key={column.id}
              >
                <input
                  className="size-4 accent-primary"
                  type="checkbox"
                  checked={selectedColumnSet.has(column.id)}
                  onChange={() => {
                    setSelectedColumnIds((current) =>
                      current.includes(column.id)
                        ? current.filter((columnId) => columnId !== column.id)
                        : [...current, column.id]
                    );
                  }}
                />
                {column.label}
              </label>
            ))}
          </div>
        </SelectorPanel>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1 text-sm">
          <div className="font-semibold text-foreground">Target vs Achievement · {month}</div>
          <div className="text-muted-foreground">
            Achievement: {periodMode === "custom" ? `${startDate || "Start date"} to ${endDate || "End date"}` : "Entire month"}
          </div>
          <div className="text-muted-foreground">
            {selectedChannelIds.length} channels selected · {selectedColumnIds.length} columns selected
          </div>
          {selectedColumnIds.length === 0 ? (
            <div className="text-xs font-semibold text-muted-foreground">Select at least one report column.</div>
          ) : null}
          {isInvalidDateRange ? (
            <div className="text-xs font-semibold text-destructive">
              Select a valid period within {month} only.
            </div>
          ) : null}
        </div>
        <ReportDownloadButton
          disabled={
            !schemaReady ||
            !month ||
            isInvalidDateRange ||
            selectedChannelIds.length === 0 ||
            selectedColumnIds.length === 0
          }
          href={downloadHref}
          idleLabel="Download Target vs Achievement Excel"
          loadingLabel="Preparing target report..."
        />
      </div>
    </div>
  );
}

function SelectorPanel({
  title,
  count,
  total,
  onSelectAll,
  onClear,
  children
}: {
  title: string;
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background/80 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold">
          {count === total ? (
            <CheckSquare className="size-4 text-primary" />
          ) : (
            <Square className="size-4 text-muted-foreground" />
          )}
          {title}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {count}/{total} selected
        </span>
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
        {children}
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
      {label}
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function getMonthBounds(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return { startDate: "", endDate: "" };

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(lastDay).padStart(2, "0")}`
  };
}
