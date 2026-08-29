"use client";

import { FileDown } from "lucide-react";
import { useState } from "react";

import { ChannelCompareReportDownload } from "@/components/channel-compare-report-download";
import { ChannelSummaryReportDownload } from "@/components/channel-summary-report-download";
import { TargetAchievementReportDownload } from "@/components/target-achievement-report-download";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ManagedChannel } from "@/lib/youtube-performance";

type ReportDownloadPickerProps = {
  canViewRevenue: boolean;
  channels: ManagedChannel[];
  defaultRangeEndDate: string;
  defaultRangeStartDate: string;
  defaultComparisonEndDate: string;
  defaultComparisonStartDate: string;
  defaultMonth: string;
  schemaReady: boolean;
};

type ReportKind = "range" | "compare" | "target-achievement";

export function ReportDownloadPicker({
  canViewRevenue,
  channels,
  defaultRangeEndDate,
  defaultRangeStartDate,
  defaultComparisonEndDate,
  defaultComparisonStartDate,
  defaultMonth,
  schemaReady
}: ReportDownloadPickerProps) {
  const [reportKind, setReportKind] = useState<ReportKind>("range");

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileDown className="size-4 text-primary" />
          Excel Report
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
          Report Type
          <select
            value={reportKind}
            onChange={(event) => setReportKind(event.target.value as ReportKind)}
            className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          >
            <option value="range">Range report</option>
            <option value="compare">Compare report</option>
            <option value="target-achievement">Target vs Achievement</option>
          </select>
        </label>

        {reportKind === "range" ? (
          <ChannelSummaryReportDownload
            canViewRevenue={canViewRevenue}
            channels={channels}
            defaultEndDate={defaultRangeEndDate}
            defaultStartDate={defaultRangeStartDate}
            schemaReady={schemaReady}
          />
        ) : reportKind === "compare" ? (
          <ChannelCompareReportDownload
            canViewRevenue={canViewRevenue}
            channels={channels}
            defaultComparisonEndDate={defaultComparisonEndDate}
            defaultComparisonStartDate={defaultComparisonStartDate}
            defaultPrimaryEndDate={defaultRangeEndDate}
            defaultPrimaryStartDate={defaultRangeStartDate}
            schemaReady={schemaReady}
          />
        ) : (
          <TargetAchievementReportDownload
            channels={channels}
            defaultMonth={defaultMonth}
            schemaReady={schemaReady}
          />
        )}
      </CardContent>
    </Card>
  );
}
