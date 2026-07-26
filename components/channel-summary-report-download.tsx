"use client";

import { CheckSquare, Search, Square } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { ReportDownloadButton } from "@/components/report-download-button";
import { buttonVariants } from "@/components/ui/button";
import {
  CHANNEL_SUMMARY_COLUMN_IDS,
  CHANNEL_SUMMARY_COLUMNS,
  isChannelSummaryRevenueColumnId,
  type ChannelSummaryColumnId
} from "@/lib/channel-summary-report";
import type { ManagedChannel } from "@/lib/youtube-performance";

type ChannelSummaryReportDownloadProps = {
  canViewRevenue: boolean;
  channels: ManagedChannel[];
  defaultStartDate: string;
  defaultEndDate: string;
  schemaReady: boolean;
};

export function ChannelSummaryReportDownload({
  canViewRevenue,
  channels,
  defaultStartDate,
  defaultEndDate,
  schemaReady
}: ChannelSummaryReportDownloadProps) {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [channelSearch, setChannelSearch] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [selectedColumnIds, setSelectedColumnIds] = useState<ChannelSummaryColumnId[]>([]);

  const selectedChannelSet = useMemo(() => new Set(selectedChannelIds), [selectedChannelIds]);
  const selectedColumnSet = useMemo(() => new Set(selectedColumnIds), [selectedColumnIds]);
  const visibleColumns = useMemo(
    () =>
      canViewRevenue
        ? CHANNEL_SUMMARY_COLUMNS
        : CHANNEL_SUMMARY_COLUMNS.filter((column) => !isChannelSummaryRevenueColumnId(column.id)),
    [canViewRevenue]
  );
  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channels;

    return channels.filter(
      (channel) =>
        channel.title.toLowerCase().includes(query) || channel.channelId.toLowerCase().includes(query)
    );
  }, [channelSearch, channels]);
  const downloadHref = useMemo(() => {
    const query = new URLSearchParams({
      report: "channel-summary",
      startDate,
      endDate
    });

    for (const channelId of selectedChannelIds) {
      query.append("channel", channelId);
    }

    for (const columnId of selectedColumnIds) {
      query.append("column", columnId);
    }

    return `/api/reports/monthly?${query.toString()}`;
  }, [endDate, selectedChannelIds, selectedColumnIds, startDate]);
  const isInvalidDateRange = Boolean(startDate && endDate && startDate > endDate);
  const canDownload =
    schemaReady && !isInvalidDateRange && selectedChannelIds.length > 0 && selectedColumnIds.length > 0;

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-2">
        <DateField label="Start Date" value={startDate} onChange={setStartDate} />
        <DateField label="End Date" value={endDate} onChange={setEndDate} />
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
          total={visibleColumns.length}
          onSelectAll={() =>
            setSelectedColumnIds(
              canViewRevenue
                ? [...CHANNEL_SUMMARY_COLUMN_IDS]
                : visibleColumns.map((column) => column.id)
            )
          }
          onClear={() => setSelectedColumnIds([])}
        >
          <div className="max-h-80 overflow-auto rounded-md border">
            {visibleColumns.map((column) => (
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
          <div className="font-semibold text-foreground">
            {startDate || "Start date"} to {endDate || "End date"}
          </div>
          <div className="text-muted-foreground">
            {selectedChannelIds.length} channels selected · {selectedColumnIds.length} columns selected
          </div>
          {selectedColumnIds.length === 0 ? (
            <div className="text-xs font-semibold text-muted-foreground">Select at least one report column.</div>
          ) : null}
          {isInvalidDateRange ? (
            <div className="text-xs font-semibold text-destructive">End date must be after start date.</div>
          ) : null}
        </div>
        <ReportDownloadButton
          disabled={!canDownload}
          href={downloadHref}
          idleLabel="Download Channel Summary Excel"
          loadingLabel="Syncing data from YouTube..."
        />
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
      />
    </label>
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
          <button className={buttonVariants({ variant: "secondary", size: "sm", className: "rounded-md" })} type="button" onClick={onSelectAll}>
            Select all
          </button>
          <button className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-md" })} type="button" onClick={onClear}>
            Clear
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
