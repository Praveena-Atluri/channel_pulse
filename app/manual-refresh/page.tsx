import { Home } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppLogo } from "@/components/app-logo";
import { LogoutButton } from "@/components/logout-button";
import { ManualDataRefresh } from "@/components/manual-data-refresh";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { canAccountManageDashboard, getAccountChannelAccess } from "@/lib/auth";
import { requireCurrentAccount } from "@/lib/server-auth";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { getDefaultReportMonth, getMonthDateRange } from "@/lib/youtube-performance-utils";

export const dynamic = "force-dynamic";

export default async function ManualRefreshPage() {
  const account = await requireCurrentAccount("/manual-refresh");

  if (!canAccountManageDashboard(account)) {
    redirect("/");
  }

  const access = getAccountChannelAccess(account);
  const storedChannels = await listStoredYoutubeManagedChannels();
  const channels =
    access.channelIds === null
      ? storedChannels
      : storedChannels.filter((channel) => access.channelIds?.includes(channel.channelId));
  const defaultRefreshRange = getMonthDateRange(getDefaultReportMonth());

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-5xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Manual Data Refresh</h1>
                <Badge variant="secondary" className="rounded-md">
                  Admin
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Force-refresh stored YouTube analytics for selected channels and dates.
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

        <ManualDataRefresh
          channels={channels}
          defaultEndDate={defaultRefreshRange.analyticsEndDate}
          defaultStartDate={defaultRefreshRange.startDate}
        />
      </div>
    </main>
  );
}
