import { Home } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppLogo } from "@/components/app-logo";
import { LogoutButton } from "@/components/logout-button";
import { ReportDownloadPicker } from "@/components/report-download-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { canAccountManageDashboard, canAccountViewRevenue, getAccountChannelAccess } from "@/lib/auth";
import { requireCurrentAccount } from "@/lib/server-auth";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { getDefaultReportMonth, getMonthDateRange, getPreviousMonth } from "@/lib/youtube-performance-utils";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams: Promise<{
    month?: string;
    channel?: string;
    contentType?: string;
  }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const account = await requireCurrentAccount("/reports");

  if (!canAccountManageDashboard(account)) {
    redirect("/");
  }

  const access = getAccountChannelAccess(account);
  const storedChannels = await listStoredYoutubeManagedChannels();
  const channels =
    access.channelIds === null
      ? storedChannels
      : storedChannels.filter((channel) => access.channelIds?.includes(channel.channelId));
  const selectedMonth = isValidReportMonth(params.month) ? params.month : getDefaultReportMonth();
  const defaultDateRange = getMonthDateRange(selectedMonth);
  const defaultComparisonDateRange = getMonthDateRange(getPreviousMonth(selectedMonth));

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-6xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Report Downloads</h1>
                <Badge variant="secondary" className="rounded-md">
                  Admin
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Custom Excel exports for management reviews and channel-level reporting.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/" className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}>
              <Home className="size-4" />
              Home
            </Link>
            <LogoutButton />
            <ThemeToggle />
          </div>
        </header>

        <ReportDownloadPicker
          canViewRevenue={canAccountViewRevenue(account)}
          channels={channels}
          defaultComparisonEndDate={defaultComparisonDateRange.analyticsEndDate}
          defaultComparisonStartDate={defaultComparisonDateRange.startDate}
          defaultRangeEndDate={defaultDateRange.analyticsEndDate}
          defaultRangeStartDate={defaultDateRange.startDate}
          schemaReady
        />
      </div>
    </main>
  );
}

function isValidReportMonth(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}
