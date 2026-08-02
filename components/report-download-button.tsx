"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type ReportDownloadButtonProps = {
  disabled?: boolean;
  href: string;
  idleLabel: string;
  loadingLabel?: string;
};

export function ReportDownloadButton({
  disabled = false,
  href,
  idleLabel,
  loadingLabel = "Syncing data from YouTube..."
}: ReportDownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [warningMessage, setWarningMessage] = useState("");

  useEffect(() => {
    setErrorMessage("");
    setWarningMessage("");
    setIsDownloading(false);
  }, [href]);

  const isDisabled = disabled || isDownloading;

  return (
    <div className="grid gap-2">
      <Button
        className="h-11 gap-2 rounded-md"
        disabled={isDisabled}
        onClick={async () => {
          if (isDisabled) return;

          setErrorMessage("");
          setWarningMessage("");
          setIsDownloading(true);

          try {
            const response = await fetch(href, { cache: "no-store" });
            if (!response.ok) {
              throw new Error(await readDownloadError(response));
            }

            const blob = await response.blob();
            downloadBlob(blob, getDownloadFilename(response) ?? "channel-pulse-report.xlsx");
            setWarningMessage(response.headers.get("X-Channel-Pulse-Warning") ?? "");
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Report download failed.");
          } finally {
            setIsDownloading(false);
          }
        }}
        type="button"
      >
        {isDownloading ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
        {isDownloading ? loadingLabel : idleLabel}
      </Button>
      {isDownloading ? (
        <p className="text-xs font-semibold text-muted-foreground">
          More selected channels can take a bit longer. The download will start automatically.
        </p>
      ) : null}
      {errorMessage ? <p className="text-xs font-semibold text-destructive">{errorMessage}</p> : null}
      {warningMessage ? (
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">{warningMessage}</p>
      ) : null}
    </div>
  );
}

async function readDownloadError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return payload?.error ?? "Report download failed.";
  }

  const text = await response.text().catch(() => "");
  return text || "Report download failed.";
}

function getDownloadFilename(response: Response) {
  const contentDisposition = response.headers.get("content-disposition");
  if (!contentDisposition) return null;

  const utfFilename = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utfFilename) {
    return decodeURIComponent(utfFilename.replace(/["']/g, ""));
  }

  const filename = contentDisposition.match(/filename="?([^"]+)"?/i)?.[1];
  return filename ?? null;
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
