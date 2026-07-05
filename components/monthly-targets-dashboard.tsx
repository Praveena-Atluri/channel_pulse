"use client";

import {
  BarChart3,
  CheckSquare,
  ChevronDown,
  Download,
  LoaderCircle,
  Save,
  Search,
  SlidersHorizontal,
  Square
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE,
  MONTHLY_TARGET_BASELINE_PRESETS,
  MONTHLY_TARGET_METRICS,
  TARGET_PERCENT_PRESETS,
  calculatePercentTarget,
  getEditableMonthlyTargetMetrics,
  getTargetBaselineMonthOptions,
  getVisibleMonthlyTargetMetrics,
  isMonthlyTargetBaselineMonthSource,
  normalizeMonthlyTargetBaselineSource,
  normalizeTargetValue,
  type MonthlyTargetBaselineSource,
  type MonthlyTargetMetric,
  type MonthlyTargetMetricDefinition,
  type MonthlyTargetValues
} from "@/lib/monthly-target-metrics";
import type { MonthlyTargetDashboardRow } from "@/lib/monthly-targets";
import { cn } from "@/lib/utils";
import { getMonthDateRange } from "@/lib/youtube-performance-utils";

type TargetChannel = {
  channelId: string;
  title: string;
};

type MonthlyTargetsDashboardProps = {
  availableMonths: string[];
  canEditTargets?: boolean;
  channels: TargetChannel[];
  defaultMonth: string;
};

type TargetsPayload = {
  baselineMonth: string;
  baselineMonths: string[];
  baselineSource: MonthlyTargetBaselineSource;
  error?: string;
  errorMessage?: string;
  month: string;
  rows: MonthlyTargetDashboardRow[];
  schemaReady: boolean;
};

type EditableTargetRow = Omit<MonthlyTargetDashboardRow, "target"> & {
  target: Record<MonthlyTargetMetric, string>;
};

type TargetsMode = "status" | "edit";

const EMPTY_BULK_VALUES = Object.fromEntries(MONTHLY_TARGET_METRICS.map((metric) => [metric.key, ""])) as Record<
  MonthlyTargetMetric,
  string
>;
const CHANNEL_PIE_COLORS = [
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

export function MonthlyTargetsDashboard({
  availableMonths,
  canEditTargets = true,
  channels,
  defaultMonth
}: MonthlyTargetsDashboardProps) {
  const [mode, setMode] = useState<TargetsMode>("status");
  const [month, setMonth] = useState(defaultMonth);
  const [channelSearch, setChannelSearch] = useState("");
  const [statusChannelIds, setStatusChannelIds] = useState<string[]>(() =>
    channels.map((channel) => channel.channelId)
  );
  const [editChannelIds, setEditChannelIds] = useState<string[]>([]);
  const [rows, setRows] = useState<EditableTargetRow[]>([]);
  const [bulkValues, setBulkValues] = useState(EMPTY_BULK_VALUES);
  const [baselineMonth, setBaselineMonth] = useState("");
  const [baselineMonths, setBaselineMonths] = useState<string[]>(() => getTargetBaselineMonthOptions(defaultMonth));
  const [baselineSource, setBaselineSource] = useState<MonthlyTargetBaselineSource>(
    DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const statusChannelDropdownRef = useRef<HTMLDetailsElement>(null);

  const activeMode = canEditTargets ? mode : "status";
  const selectedChannelIds = activeMode === "status" ? statusChannelIds : editChannelIds;
  const setSelectedChannelIds = activeMode === "status" ? setStatusChannelIds : setEditChannelIds;
  const statusMetrics = useMemo(() => getVisibleMonthlyTargetMetrics(canEditTargets), [canEditTargets]);
  const editableMetrics = useMemo(() => getEditableMonthlyTargetMetrics(canEditTargets), [canEditTargets]);
  const selectedChannelSet = useMemo(() => new Set(selectedChannelIds), [selectedChannelIds]);
  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channels;

    return channels.filter(
      (channel) =>
        channel.title.toLowerCase().includes(query) || channel.channelId.toLowerCase().includes(query)
    );
  }, [channelSearch, channels]);
  const hasRows = rows.length > 0;
  const hasAnyBaseline = rows.some((row) => row.hasBaselineData);
  const canUseLoadedRows = schemaReady && hasRows && !isLoading;
  const canSave = schemaReady && hasRows && !isSaving && !isLoading;
  const canDownload = schemaReady && hasRows && !isLoading;

  useEffect(() => {
    const closeStatusDropdown = () => {
      const dropdown = statusChannelDropdownRef.current;
      if (dropdown?.open) {
        dropdown.open = false;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const dropdown = statusChannelDropdownRef.current;
      if (!dropdown?.open) return;
      if (event.target instanceof Node && dropdown.contains(event.target)) return;

      closeStatusDropdown();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeStatusDropdown();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (selectedChannelIds.length === 0) {
      setRows([]);
      setMessage("");
      setErrorMessage("");
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ baseline: baselineSource, month });
    for (const channelId of selectedChannelIds) {
      query.append("channel", channelId);
    }

    setIsLoading(true);
    setMessage("");
    setErrorMessage("");

    fetch(`/api/targets/monthly?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = (await response.json()) as TargetsPayload;
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load monthly targets.");
        }

        setSchemaReady(payload.schemaReady);
        setBaselineMonth(payload.baselineMonth);
        setBaselineMonths(payload.baselineMonths);
        setBaselineSource(payload.baselineSource);
        setRows(payload.rows.map(toEditableRow));
        if (!payload.schemaReady) {
          setErrorMessage(payload.errorMessage ?? "Apply the monthly targets schema before saving targets.");
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage(error instanceof Error ? error.message : "Unable to load monthly targets.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [month, selectedChannelIds, baselineSource]);

  const updateMonth = (nextMonth: string) => {
    const nextBaselineMonths = getTargetBaselineMonthOptions(nextMonth);

    setMonth(nextMonth);
    setBaselineMonths(nextBaselineMonths);
    setBaselineSource((current) => normalizeMonthlyTargetBaselineSource(current, nextBaselineMonths));
  };

  const toggleChannel = (channelId: string) => {
    setSelectedChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((selectedChannelId) => selectedChannelId !== channelId)
        : [...current, channelId]
    );
  };

  const applyBulkValue = (metric: MonthlyTargetMetric) => {
    const value = bulkValues[metric];
    let normalizedValue = "";

    try {
      const normalized = normalizeTargetValue(metric, value);
      normalizedValue = normalized === null ? "" : String(normalized);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Enter a valid target.");
      return;
    }

    setRows((current) =>
      current.map((row) => ({
        ...row,
        target: {
          ...row.target,
          [metric]: normalizedValue
        }
      }))
    );
    setMessage(`${getMetricLabel(metric)} updated for ${rows.length} channel${rows.length === 1 ? "" : "s"}.`);
    setErrorMessage("");
  };

  const applyPercent = (metric: MonthlyTargetMetric, rawValue: string) => {
    if (!rawValue) return;

    const percent = rawValue === "custom" ? requestCustomPercent() : Number(rawValue);
    if (percent === null) return;

    setRows((current) =>
      current.map((row) => {
        if (!row.hasBaselineData) return row;

        return {
          ...row,
          target: {
            ...row.target,
            [metric]: String(calculatePercentTarget(metric, row.baseline[metric], percent))
          }
        };
      })
    );
    setMessage(
      `${getMetricLabel(metric)} set to +${percent}% from ${formatBaselineSourceLabel(
        baselineSource,
        baselineMonth
      )} base.`
    );
    setErrorMessage("");
  };

  const updateRowTarget = (channelId: string, metric: MonthlyTargetMetric, value: string) => {
    setRows((current) =>
      current.map((row) =>
        row.channelId === channelId
          ? {
              ...row,
              target: {
                ...row.target,
                [metric]: value
              }
            }
          : row
      )
    );
  };

  const saveTargets = async () => {
    setIsSaving(true);
    setErrorMessage("");
    setMessage("");

    let requestRows: Array<{ channelId: string; targets: MonthlyTargetValues }>;
    try {
      requestRows = rows.map((row) => ({
        channelId: row.channelId,
        targets: Object.fromEntries(
          editableMetrics.map((metric) => [
            metric.key,
            normalizeTargetValue(metric.key, row.target[metric.key])
          ])
        ) as MonthlyTargetValues
      }));
    } catch (error) {
      setIsSaving(false);
      setErrorMessage(error instanceof Error ? error.message : "Enter valid target values.");
      return;
    }

    try {
      const response = await fetch("/api/targets/monthly", {
        body: JSON.stringify({ baselineSource, month, rows: requestRows }),
        headers: { "content-type": "application/json" },
        method: "PUT"
      });
      const payload = (await response.json()) as TargetsPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save monthly targets.");
      }

      setSchemaReady(payload.schemaReady);
      setBaselineMonth(payload.baselineMonth);
      setBaselineMonths(payload.baselineMonths);
      setBaselineSource(payload.baselineSource);
      setRows(payload.rows.map(toEditableRow));
      setMessage(`Targets saved for ${requestRows.length} channel${requestRows.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save monthly targets.");
    } finally {
      setIsSaving(false);
    }
  };

  const downloadTargets = () => {
    try {
      const workbook = buildTargetsExcelWorkbook({
        metrics: editableMetrics,
        month,
        rows
      });
      downloadExcelFile(workbook, `channel-pulse-targets-${month}-${rows.length}-channels.xls`);
      setMessage(`Downloaded targets for ${rows.length} channel${rows.length === 1 ? "" : "s"}.`);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to download targets.");
    }
  };

  return (
    <div className="grid min-w-0 max-w-full gap-5">
      <div className={canEditTargets ? "grid min-w-0 gap-3 md:grid-cols-2" : "grid min-w-0 gap-3"}>
        <button
          className={cn(
            "min-w-0 rounded-md border p-4 text-left transition hover:bg-muted/50",
            activeMode === "status" ? "border-primary bg-primary/10 shadow-sm" : "bg-background/80"
          )}
          type="button"
          onClick={() => setMode("status")}
        >
          <span className="flex items-center gap-2 text-sm font-black">
            <BarChart3 className="size-4 text-primary" />
            View current status
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">
            See target versus achieved so far for selected channels.
          </span>
        </button>
        {canEditTargets ? (
          <button
            className={cn(
              "min-w-0 rounded-md border p-4 text-left transition hover:bg-muted/50",
              activeMode === "edit" ? "border-primary bg-primary/10 shadow-sm" : "bg-background/80"
            )}
            type="button"
            onClick={() => setMode("edit")}
          >
            <span className="flex items-center gap-2 text-sm font-black">
              <SlidersHorizontal className="size-4 text-primary" />
              Set target
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Update monthly goals and download the target sheet.
            </span>
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          "grid min-w-0 gap-3",
          activeMode === "edit"
            ? "md:grid-cols-[minmax(12rem,0.5fr)_minmax(0,1fr)]"
            : "md:grid-cols-[minmax(12rem,0.35fr)_minmax(18rem,0.65fr)]"
        )}
      >
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-muted-foreground">
          Month
          <select
            className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
            value={month}
            onChange={(event) => updateMonth(event.target.value)}
          >
            {availableMonths.map((availableMonth) => (
              <option key={availableMonth} value={availableMonth}>
                {formatMonthLabel(availableMonth)}
              </option>
            ))}
          </select>
        </label>

        {activeMode === "status" ? (
          <div className="grid min-w-0 gap-1 text-sm font-semibold text-muted-foreground">
            <span>Channels</span>
            <details className="group relative" ref={statusChannelDropdownRef}>
              <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="truncate">{formatChannelSelectionLabel(selectedChannelIds.length, channels.length)}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
              </summary>
              <div className="absolute left-0 right-0 top-full z-50 mt-2 grid gap-2 rounded-md border bg-card p-3 text-card-foreground shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {selectedChannelIds.length}/{channels.length} selected
                  </span>
                  <div className="flex flex-wrap gap-2">
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
                </div>

                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={channelSearch}
                    onChange={(event) => setChannelSearch(event.target.value)}
                    placeholder="Search channels"
                    className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  />
                </label>

                <div className="max-h-64 overflow-auto rounded-md border bg-background">
                  {filteredChannels.map((channel) => (
                    <label
                      className="flex cursor-pointer items-center gap-3 border-b border-border/70 px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                      key={channel.channelId}
                    >
                      <input
                        className="size-4 accent-primary"
                        type="checkbox"
                        checked={selectedChannelSet.has(channel.channelId)}
                        onChange={() => toggleChannel(channel.channelId)}
                      />
                      <span className="min-w-0 font-semibold text-foreground">{channel.title}</span>
                    </label>
                  ))}
                  {filteredChannels.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">No channels found.</div>
                  ) : null}
                </div>
              </div>
            </details>
          </div>
        ) : (
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-muted-foreground">
            Baseline
            <select
              className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              value={baselineSource}
              onChange={(event) =>
                setBaselineSource(normalizeMonthlyTargetBaselineSource(event.target.value, baselineMonths))
              }
            >
              {MONTHLY_TARGET_BASELINE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              <optgroup label="Last one year months">
                {baselineMonths.map((availableBaselineMonth) => (
                  <option key={availableBaselineMonth} value={availableBaselineMonth}>
                    {formatMonthLabel(availableBaselineMonth)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        )}
      </div>

      {activeMode === "edit" ? (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="min-w-0 rounded-md border bg-background/80 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-bold">
              {selectedChannelIds.length === channels.length && channels.length > 0 ? (
                <CheckSquare className="size-4 text-primary" />
              ) : (
                <Square className="size-4 text-muted-foreground" />
              )}
              Channels
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              {selectedChannelIds.length}/{channels.length} selected
            </span>
          </div>

          <div className="mt-3 grid gap-3">
            <div className="flex flex-wrap gap-2">
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

            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={channelSearch}
                onChange={(event) => setChannelSearch(event.target.value)}
                placeholder="Search channels"
                className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="max-h-80 overflow-auto rounded-md border">
              {filteredChannels.map((channel) => (
                <label
                  className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                  key={channel.channelId}
                >
                  <input
                    className="size-4 accent-primary"
                    type="checkbox"
                    checked={selectedChannelSet.has(channel.channelId)}
                    onChange={() => toggleChannel(channel.channelId)}
                  />
                  <span className="min-w-0 font-semibold text-foreground">{channel.title}</span>
                </label>
              ))}
              {filteredChannels.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No channels found.</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-md border bg-background/80 p-3">
          <div className="text-sm font-bold">Target Controls</div>
          <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
            {editableMetrics.map((metric) => (
              <div className="min-w-0 rounded-md border bg-muted/20 p-3" key={metric.key}>
                <div className="text-sm font-bold">{metric.label}</div>
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(4.75rem,auto)] gap-2">
                  <input
                    value={bulkValues[metric.key]}
                    onChange={(event) =>
                      setBulkValues((current) => ({ ...current, [metric.key]: event.target.value }))
                    }
                    placeholder="Manual value"
                    className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                    inputMode="decimal"
                  />
                  <button
                    className={buttonVariants({
                      variant: "secondary",
                      size: "sm",
                      className: "h-10 min-w-[4.75rem] rounded-md"
                    })}
                    disabled={!canUseLoadedRows}
                    type="button"
                    onClick={() => applyBulkValue(metric.key)}
                  >
                    Apply
                  </button>
                </div>
                <select
                  aria-label={`Set ${metric.label} by percent`}
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canUseLoadedRows || !hasAnyBaseline}
                  value=""
                  onChange={(event) => applyPercent(metric.key, event.target.value)}
                >
                  <option value="">Set +%</option>
                  {TARGET_PERCENT_PRESETS.map((percent) => (
                    <option key={percent} value={percent}>
                      +{percent}%
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
      ) : null}

      {activeMode === "edit" ? (
        <div className="min-w-0 rounded-md border bg-background/80">
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <div className="text-sm font-bold">Editable Channel Targets</div>
            <div className="text-xs font-semibold text-muted-foreground">
              {selectedChannelIds.length} selected · {rows.length} loaded
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-10 gap-2 rounded-md"
              disabled={!canDownload}
              onClick={downloadTargets}
              type="button"
              variant="secondary"
            >
              <Download className="size-4" />
              Download Excel
            </Button>
            <Button className="h-10 gap-2 rounded-md" disabled={!canSave} onClick={saveTargets} type="button">
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save Targets
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm font-semibold text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading targets
          </div>
        ) : hasRows ? (
          <div className="max-w-full overflow-x-auto">
            <table className="min-w-[82rem] text-left text-sm">
              <thead className="border-b bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-72 whitespace-normal px-3 py-2">Channel</th>
                  {editableMetrics.map((metric) => (
                    <th className="whitespace-normal break-words px-3 py-2" key={metric.key}>
                      {metric.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className="border-b last:border-b-0" key={row.channelId}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-bold text-foreground">{row.channelTitle}</div>
                      <div className="text-xs font-semibold text-muted-foreground">
                        Baseline - {formatBaselineSourceLabel(baselineSource, baselineMonth, row.baselineSourceMonths)}
                      </div>
                    </td>
                    {editableMetrics.map((metric) => (
                      <td className="px-3 py-2 align-top" key={metric.key}>
                        <input
                          value={row.target[metric.key]}
                          onChange={(event) => updateRowTarget(row.channelId, metric.key, event.target.value)}
                          className="h-9 w-full min-w-32 rounded-md border bg-background px-2 text-sm font-semibold outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                          inputMode="decimal"
                        />
                        <div className="mt-1 text-[11px] font-semibold text-muted-foreground">
                          Base {formatMetricValue(metric.key, row.baseline[metric.key])}
                          {baselineSource === "highest-in-year" && row.baselineSourceMonths[metric.key] ? (
                            <span> · {formatShortMonthLabel(row.baselineSourceMonths[metric.key])}</span>
                          ) : null}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Select one or more channels to edit targets.</div>
        )}
        </div>
      ) : (
        <TargetsStatusDashboard
          isLoading={isLoading}
          metrics={statusMetrics}
          month={month}
          rows={rows}
          selectedCount={selectedChannelIds.length}
        />
      )}

      {message ? <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {errorMessage ? <p className="text-sm font-semibold text-destructive">{errorMessage}</p> : null}
    </div>
  );
}

function formatChannelSelectionLabel(selectedCount: number, totalCount: number) {
  if (totalCount === 0) return "No channels";
  if (selectedCount === 0) return "No channels selected";
  if (selectedCount === totalCount) return `All channels (${totalCount})`;
  if (selectedCount === 1) return "1 channel selected";
  return `${selectedCount} channels selected`;
}

function toEditableRow(row: MonthlyTargetDashboardRow): EditableTargetRow {
  return {
    ...row,
    target: Object.fromEntries(
      MONTHLY_TARGET_METRICS.map((metric) => {
        const value = row.target[metric.key];
        return [metric.key, value === null ? "" : String(value)];
      })
    ) as Record<MonthlyTargetMetric, string>
  };
}

function TargetsStatusDashboard({
  isLoading,
  metrics,
  month,
  rows,
  selectedCount
}: {
  isLoading: boolean;
  metrics: readonly MonthlyTargetMetricDefinition[];
  month: string;
  rows: EditableTargetRow[];
  selectedCount: number;
}) {
  if (selectedCount === 0) {
    return (
      <div className="rounded-md border bg-background/80 p-4 text-sm font-semibold text-muted-foreground">
        Select one or more channels to view target status.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-background/80 p-4 text-sm font-semibold text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading target status
      </div>
    );
  }

  const actualRangeLabel = formatActualRangeLabel(month);
  const summaries = buildTargetStatusSummaries(rows, metrics);
  const channelProgress = buildChannelProgressSummaries(rows, metrics);
  const rowsWithTargets = rows.filter((row) =>
    metrics.some((metric) => normalizeTargetValueOrNull(metric.key, row.target[metric.key]) !== null)
  );

  if (summaries.length === 0) {
    return (
      <div className="rounded-md border bg-background/80 p-4 text-sm font-semibold text-muted-foreground">
        No targets are set for the selected channels in {formatMonthLabel(month)}.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-md border bg-background/80 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black">
              <BarChart3 className="size-4 text-primary" />
              Current Target Status (All channels)
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatMonthLabel(month)} · Actuals from {actualRangeLabel}
            </p>
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            {rowsWithTargets.length}/{selectedCount} channels have targets
          </p>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]">
          <ChannelProgressPieChart summaries={channelProgress} />
          <div className="grid gap-3 md:grid-cols-2">
            {summaries.map((summary) => (
              <TargetStatusMetricCard key={summary.metric.key} summary={summary} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="text-sm font-black">Channel Breakdown</div>
        {rows.map((row) => (
          <ChannelTargetStatusCard key={row.channelId} metrics={metrics} row={row} />
        ))}
      </div>
    </div>
  );
}

type TargetStatusSummary = {
  actual: number;
  channelsWithTarget: number;
  metric: MonthlyTargetMetricDefinition;
  percent: number | null;
  remaining: number;
  target: number;
};

type ChannelProgressSummary = {
  channelTitle: string;
  percent: number;
  targetCount: number;
};

type ChannelStatusMetricRow = {
  actual: number;
  metric: MonthlyTargetMetricDefinition;
  percent: number | null;
  sourceLabel?: string;
  target: number;
};

function buildTargetStatusSummaries(
  rows: EditableTargetRow[],
  metrics: readonly MonthlyTargetMetricDefinition[]
): TargetStatusSummary[] {
  return metrics.flatMap((metric) => {
    let actual = 0;
    let target = 0;
    let channelsWithTarget = 0;

    for (const row of rows) {
      const targetValue = normalizeTargetValueOrNull(metric.key, row.target[metric.key]);
      if (targetValue === null) continue;

      channelsWithTarget += 1;
      target += targetValue;
      actual += row.actual[metric.key];
    }

    if (channelsWithTarget === 0) return [];

    return [
      {
        actual,
        channelsWithTarget,
        metric,
        percent: calculateExportProgressPercent(actual, target),
        remaining: Math.max(0, target - actual),
        target
      }
    ];
  });
}

function buildChannelProgressSummaries(
  rows: EditableTargetRow[],
  metrics: readonly MonthlyTargetMetricDefinition[]
): ChannelProgressSummary[] {
  return rows.flatMap((row) => {
    let percentTotal = 0;
    let targetCount = 0;

    for (const metric of metrics) {
      const targetValue = normalizeTargetValueOrNull(metric.key, row.target[metric.key]);
      if (targetValue === null) continue;

      targetCount += 1;
      percentTotal += calculateExportProgressPercent(row.actual[metric.key], targetValue) ?? 0;
    }

    if (targetCount === 0) return [];

    return [
      {
        channelTitle: row.channelTitle,
        percent: Math.round((percentTotal / targetCount) * 10) / 10,
        targetCount
      }
    ];
  });
}

function ChannelProgressPieChart({ summaries }: { summaries: ChannelProgressSummary[] }) {
  const positiveSummaries = summaries.filter((summary) => summary.percent > 0);
  const totalPercent = positiveSummaries.reduce((total, summary) => total + summary.percent, 0);
  const averagePercent =
    summaries.length === 0
      ? 0
      : Math.round((summaries.reduce((total, summary) => total + summary.percent, 0) / summaries.length) * 10) / 10;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black">Achieved % by channel</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {summaries.length} channel{summaries.length === 1 ? "" : "s"} with targets
          </p>
        </div>
        <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-black text-primary">
          Avg {formatPercent(averagePercent)}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-center">
        <div className="relative mx-auto size-36">
          <svg className="size-36 -rotate-90" viewBox="0 0 140 140" role="img" aria-label="Achieved percent by channel">
            <circle cx="70" cy="70" fill="none" r={radius} stroke="currentColor" strokeWidth="18" className="text-muted" />
            {totalPercent > 0
              ? positiveSummaries.map((summary, index) => {
                  const segmentLength = (summary.percent / totalPercent) * circumference;
                  const segment = (
                    <circle
                      cx="70"
                      cy="70"
                      fill="none"
                      key={summary.channelTitle}
                      r={radius}
                      stroke={getChannelPieColor(index)}
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
              <p className="text-xs font-semibold text-muted-foreground">Average</p>
              <p className="text-lg font-black tabular-nums">{formatPercent(averagePercent)}</p>
            </div>
          </div>
        </div>

        <div className="max-h-60 overflow-auto rounded-md border bg-background/70">
          {summaries.map((summary, index) => (
            <div className="flex items-center gap-3 border-b px-3 py-2 text-xs last:border-b-0" key={summary.channelTitle}>
              <span
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: getChannelPieColor(index) }}
              />
              <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{summary.channelTitle}</span>
              <span className="font-black tabular-nums">{formatPercent(summary.percent)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TargetStatusMetricCard({ summary }: { summary: TargetStatusSummary }) {
  const percent = summary.percent ?? 0;

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black">{summary.metric.label}</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {summary.channelsWithTarget} channel{summary.channelsWithTarget === 1 ? "" : "s"}
          </p>
        </div>
        <span className={cn("rounded-md px-2 py-1 text-xs font-black", getProgressBadgeClass(percent))}>
          {formatPercent(percent)}
        </span>
      </div>

      <ProgressBar percent={percent} />

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <TargetStatusValue label="Achieved" value={formatMetricValue(summary.metric.key, summary.actual)} />
        <TargetStatusValue label="Target" value={formatMetricValue(summary.metric.key, summary.target)} />
        <TargetStatusValue label="Left" value={formatMetricValue(summary.metric.key, summary.remaining)} />
      </div>
    </div>
  );
}

function ChannelTargetStatusCard({
  metrics,
  row
}: {
  metrics: readonly MonthlyTargetMetricDefinition[];
  row: EditableTargetRow;
}) {
  const metricRows: ChannelStatusMetricRow[] = metrics.flatMap((metric) => {
    const target = normalizeTargetValueOrNull(metric.key, row.target[metric.key]);
    if (target === null) return [];

    const actual = row.actual[metric.key];
    return [
      {
        actual,
        metric,
        percent: calculateExportProgressPercent(actual, target),
        sourceLabel: row.targetSourceLabels?.[metric.key],
        target
      }
    ];
  });

  return (
    <div className="rounded-md border bg-background/80 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-black">{row.channelTitle}</p>
        <p className="text-xs font-semibold text-muted-foreground">
          {metricRows.length} target{metricRows.length === 1 ? "" : "s"} set
        </p>
      </div>

      {metricRows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No targets set for this channel.</p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {metricRows.map(({ actual, metric, percent, sourceLabel, target }) => (
            <div className="rounded-md border bg-muted/20 p-3" key={metric.key}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black">{metric.label}</p>
                  {sourceLabel ? (
                    <p className="mt-1 text-[11px] font-bold text-muted-foreground">{sourceLabel}</p>
                  ) : null}
                </div>
                <span className={cn("rounded-md px-2 py-1 text-[11px] font-black", getProgressBadgeClass(percent ?? 0))}>
                  {formatPercent(percent ?? 0)}
                </span>
              </div>
              <ProgressBar percent={percent ?? 0} />
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-muted-foreground">Achieved</span>
                <span className="font-black tabular-nums">{formatMetricValue(metric.key, actual)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-muted-foreground">Target</span>
                <span className="font-black tabular-nums">{formatMetricValue(metric.key, target)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const boundedPercent = Math.min(100, Math.max(0, percent));

  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", getProgressBarClass(percent))} style={{ width: `${boundedPercent}%` }} />
    </div>
  );
}

function TargetStatusValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function normalizeTargetValueOrNull(metric: MonthlyTargetMetric, value: string) {
  try {
    return normalizeTargetValue(metric, value);
  } catch {
    return null;
  }
}

function getProgressBadgeClass(percent: number) {
  if (percent >= 100) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  if (percent >= 60) return "bg-primary/15 text-primary";
  return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
}

function getProgressBarClass(percent: number) {
  if (percent >= 100) return "bg-emerald-500";
  if (percent >= 60) return "bg-primary";
  return "bg-amber-500";
}

function formatPercent(value: number) {
  return `${formatExportDecimal(value, 1)}%`;
}

function getChannelPieColor(index: number) {
  return CHANNEL_PIE_COLORS[index % CHANNEL_PIE_COLORS.length];
}

function buildTargetsExcelWorkbook({
  metrics,
  month,
  rows
}: {
  metrics: readonly MonthlyTargetMetricDefinition[];
  month: string;
  rows: EditableTargetRow[];
}) {
  const actualRangeLabel = formatActualRangeLabel(month);
  const metricsWithTargets = metrics.filter((metric) =>
    rows.some((row) => normalizeTargetValue(metric.key, row.target[metric.key]) !== null)
  );
  const headers = ["Month", "Channel"];
  for (const metric of metricsWithTargets) {
    headers.push(
      `${metric.label} Target`,
      `${metric.label}(${actualRangeLabel})`,
      `${metric.label} Progress %`
    );
  }

  const sheetRows: Array<Array<string | number | null>> = rows.map((row) => {
    const values: Array<string | number | null> = [formatMonthLabel(month), row.channelTitle];

    for (const metric of metricsWithTargets) {
      const targetValue = normalizeTargetValue(metric.key, row.target[metric.key]);
      if (targetValue === null) {
        values.push(null, null, null);
        continue;
      }

      const actualValue = row.actual[metric.key];
      const progressPercent = calculateExportProgressPercent(actualValue, targetValue);
      values.push(
        formatExportMetricValue(metric.key, targetValue),
        formatExportMetricValue(metric.key, actualValue),
        progressPercent === null ? null : formatExportDecimal(progressPercent, 1)
      );
    }

    return values;
  });

  return buildExcelXml([headers, ...sheetRows]);
}

function buildExcelXml(rows: Array<Array<string | number | null>>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Header">
      <Alignment ss:Vertical="Top" ss:WrapText="1" />
      <Font ss:Bold="1" />
      <Interior ss:Color="#EAF0FF" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="Wrapped">
      <Alignment ss:Vertical="Top" ss:WrapText="1" />
    </Style>
  </Styles>
  <Worksheet ss:Name="Targets">
    <Table>
      ${excelColumns(rows[0]?.length ?? 0)}
      ${rows.map((row, index) => excelRow(row, index === 0)).join("\n      ")}
    </Table>
  </Worksheet>
</Workbook>`;
}

function excelColumns(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const width = index === 0 ? 120 : index === 1 ? 210 : 110;
    return `<Column ss:Width="${width}"/>`;
  }).join("\n      ");
}

function excelRow(row: Array<string | number | null>, isHeader: boolean) {
  const rowAttributes = isHeader ? ' ss:AutoFitHeight="1" ss:Height="48"' : ' ss:AutoFitHeight="1"';
  return `<Row${rowAttributes}>${row.map((value) => excelCell(value, isHeader)).join("")}</Row>`;
}

function excelCell(value: string | number | null, isHeader: boolean) {
  const style = isHeader ? ' ss:StyleID="Header"' : ' ss:StyleID="Wrapped"';
  if (value === null || value === "") return `<Cell${style}/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell${style}><Data ss:Type="Number">${value}</Data></Cell>`;
  }

  return `<Cell${style}><Data ss:Type="String">${escapeXml(String(value))}</Data></Cell>`;
}

function downloadExcelFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function calculateExportProgressPercent(actual: number, target: number | null) {
  if (target === null) return null;
  if (target <= 0) return actual >= target ? 100 : 0;
  return Math.round((actual / target) * 1000) / 10;
}

function formatExportMetricValue(metric: MonthlyTargetMetric, value: number) {
  if (metric === "estimatedRevenue") return formatExportDecimal(value, 2);
  return metric === "watchHours" ? formatExportDecimal(value, 1) : Math.round(value);
}

function formatExportDecimal(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function formatActualRangeLabel(month: string) {
  const range = getMonthDateRange(month);
  const start = parseUtcDate(range.startDate);
  const end = parseUtcDate(range.analyticsEndDate);
  const startMonth = formatShortMonth(start);
  const endMonth = formatShortMonth(end);

  if (startMonth === endMonth) {
    return `${startMonth}${start.getUTCDate()}-${end.getUTCDate()}`;
  }

  return `${startMonth}${start.getUTCDate()}-${endMonth}${end.getUTCDate()}`;
}

function parseUtcDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatShortMonth(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC"
  }).format(date);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function requestCustomPercent() {
  const value = window.prompt("Enter percent increase");
  if (value === null) return null;

  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 0 ? percent : null;
}

function getMetricLabel(metric: MonthlyTargetMetric) {
  return MONTHLY_TARGET_METRICS.find((definition) => definition.key === metric)?.label ?? metric;
}

function formatMetricValue(metric: MonthlyTargetMetric, value: number) {
  if (metric === "estimatedRevenue") return formatCompactCurrency(value);
  if (metric === "watchHours") return `${formatCompactNumber(value)} hrs`;
  if (metric === "netSubscribers") return formatSignedNumber(value);

  return formatCompactNumber(value);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    style: "currency"
  }).format(value);
}

function formatBaselineSourceLabel(
  source: MonthlyTargetBaselineSource,
  baselineMonth: string,
  sourceMonths?: Partial<Record<MonthlyTargetMetric, string | null>>
) {
  if (source === "last-three-months-average") return "Last 3 months average";
  if (source === "highest-in-year") {
    const monthSummary = formatBaselineMonthSummary(sourceMonths);
    return monthSummary ? `Highest in last year (${monthSummary})` : "Highest in last year";
  }
  if (isMonthlyTargetBaselineMonthSource(source)) return formatMonthLabel(source);

  return baselineMonth ? `Latest complete month (${formatMonthLabel(baselineMonth)})` : "Latest complete month";
}

function formatBaselineMonthSummary(sourceMonths?: Partial<Record<MonthlyTargetMetric, string | null>>) {
  if (!sourceMonths) return "";

  const uniqueMonths = Array.from(
    new Set(MONTHLY_TARGET_METRICS.map((metric) => sourceMonths[metric.key]).filter(Boolean))
  ) as string[];
  if (uniqueMonths.length === 0) return "";
  if (uniqueMonths.length <= 3) return uniqueMonths.map(formatShortMonthLabel).join(", ");

  return `${uniqueMonths.slice(0, 3).map(formatShortMonthLabel).join(", ")} +${uniqueMonths.length - 3}`;
}

function formatShortMonthLabel(month: string | null | undefined) {
  if (!month) return "";

  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard"
  }).format(value);
}

function formatSignedNumber(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatCompactNumber(value)}`;
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}
