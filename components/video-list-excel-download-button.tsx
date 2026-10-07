"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildStyledReportWorkbook, type XlsxCellValue } from "@/lib/xlsx-export";

type VideoListExcelDownloadButtonProps = {
  ariaLabel?: string;
  disabled?: boolean;
  filename: string;
  iconOnly?: boolean;
  label?: string | null;
  rows: XlsxCellValue[][];
  sheetName?: string;
  reportTitle?: string;
};

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function VideoListExcelDownloadButton({
  ariaLabel,
  disabled = false,
  filename,
  iconOnly = false,
  label = "Download Excel",
  rows,
  sheetName = "Videos",
  reportTitle = sheetName
}: VideoListExcelDownloadButtonProps) {
  const accessibleLabel = ariaLabel ?? label ?? "Download Excel";
  const className = iconOnly
    ? "youtube-print-hidden h-10 w-10 rounded-md p-0"
    : "youtube-print-hidden h-9 gap-2 rounded-md";

  return (
    <Button
      aria-label={accessibleLabel}
      className={className}
      disabled={disabled}
      onClick={() => {
        const workbook = buildStyledReportWorkbook({
          title: reportTitle,
          columnWidth: 24,
          rows,
          sheetName
        });
        const blob = new Blob([workbook], { type: EXCEL_MIME_TYPE });
        downloadBlob(blob, ensureXlsxFilename(filename));
      }}
      size="sm"
      title={accessibleLabel}
      type="button"
      variant="secondary"
    >
      <Download className="size-4" />
      {iconOnly ? null : label}
    </Button>
  );
}

function ensureXlsxFilename(value: string) {
  const safeName =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 96) || "video-list";

  return safeName.endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
