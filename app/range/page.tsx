import { CalendarRange, Home } from "lucide-react";
import Link from "next/link";

import { AppLogo } from "@/components/app-logo";
import { RangeAnalyticsDashboard } from "@/components/range-analytics-dashboard";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { canAccountViewRevenue } from "@/lib/auth";
import { requireCurrentAccount } from "@/lib/server-auth";
import { getDefaultWeeklyRange } from "@/lib/weekly-performance";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export default async function RangeDashboardPage() {
  const account = await requireCurrentAccount("/range");
  const channels = (await listStoredYoutubeManagedChannels()).filter(
    (channel) => account.channelIds === null || account.channelIds.includes(channel.channelId)
  );
  const { endDate } = getDefaultWeeklyRange();
  const startDate = addDays(endDate, -29);

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Date Range Analytics</h1>
                <Badge variant="secondary" className="rounded-md">
                  <CalendarRange className="mr-1 size-3.5" /> Graph dashboard
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Compare selected channels across any stored date range using daily metric graphs.
              </p>
            </div>
          </div>
          <div className="youtube-print-hidden flex items-center gap-2">
            <Link href="/" className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}>
              <Home className="size-4" /> Home
            </Link>
            <LogoutButton />
            <ThemeToggle />
          </div>
        </header>

        <RangeAnalyticsDashboard
          canViewRevenue={canAccountViewRevenue(account)}
          channels={channels}
          defaultEndDate={endDate}
          defaultStartDate={startDate}
        />
      </div>
    </main>
  );
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
