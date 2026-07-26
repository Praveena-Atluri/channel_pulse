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
import { getMonthDateRange, getPreviousMonth } from "@/lib/youtube-performance-utils";
import { getYoutubePerformanceDashboard, normalizeYoutubePerformanceFilters } from "@/lib/youtube-performance";

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

  const filters = normalizeYoutubePerformanceFilters({
    month: params.month,
    channel: params.channel,
    contentType: params.contentType
  });
  const dashboard = await getYoutubePerformanceDashboard(filters, getAccountChannelAccess(account));
  const defaultDateRange = getMonthDateRange(dashboard.selectedMonth);
  const defaultComparisonDateRange = getMonthDateRange(getPreviousMonth(dashboard.selectedMonth));

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
          channels={dashboard.channels}
          defaultComparisonEndDate={defaultComparisonDateRange.analyticsEndDate}
          defaultComparisonStartDate={defaultComparisonDateRange.startDate}
          defaultRangeEndDate={defaultDateRange.analyticsEndDate}
          defaultRangeStartDate={defaultDateRange.startDate}
          schemaReady={dashboard.schemaReady}
        />
      </div>
    </main>
  );
}
