"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ReportDownloadButton } from "@/components/report-download-button";
import { buttonVariants } from "@/components/ui/button";
import type { ManagedChannel } from "@/lib/youtube-performance";

type TargetAchievementReportDownloadProps = {
  channels: ManagedChannel[];
  defaultMonth: string;
  schemaReady: boolean;
};

export function TargetAchievementReportDownload({
  channels,
  defaultMonth,
  schemaReady
}: TargetAchievementReportDownloadProps) {
  const [month, setMonth] = useState(defaultMonth);
  const [channelSearch, setChannelSearch] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState(() =>
    channels.map((channel) => channel.channelId)
  );
  const selectedChannelSet = useMemo(() => new Set(selectedChannelIds), [selectedChannelIds]);
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
    for (const channelId of selectedChannelIds) query.append("channel", channelId);
    return `/api/reports/monthly?${query.toString()}`;
  }, [month, selectedChannelIds]);

  return (
    <div className="grid gap-5">
      <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
        Target Month
        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
        />
      </label>

      <div className="rounded-md border bg-background/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold">Channels</span>
          <span className="text-xs font-semibold text-muted-foreground">
            {selectedChannelIds.length}/{channels.length} selected
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={buttonVariants({ variant: "secondary", size: "sm", className: "rounded-md" })}
            type="button"
            onClick={() => setSelectedChannelIds(channels.map((channel) => channel.channelId))}
          >
            Select all
          </button>
          <button
            className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-md" })}
            type="button"
            onClick={() => setSelectedChannelIds([])}
          >
            Clear
          </button>
        </div>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={channelSearch}
            onChange={(event) => setChannelSearch(event.target.value)}
            placeholder="Search channels"
            className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          />
        </label>
        <div className="mt-3 max-h-72 overflow-auto rounded-md border">
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
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1 text-sm">
          <div className="font-semibold text-foreground">Target vs Achievement · {month}</div>
          <div className="text-muted-foreground">{selectedChannelIds.length} channels selected</div>
        </div>
        <ReportDownloadButton
          disabled={!schemaReady || !month || selectedChannelIds.length === 0}
          href={downloadHref}
          idleLabel="Download Target vs Achievement Excel"
          loadingLabel="Preparing target report..."
        />
      </div>
    </div>
  );
}
