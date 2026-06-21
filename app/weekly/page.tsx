import { Home } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppLogo } from "@/components/app-logo";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WeeklyPerformanceDashboard } from "@/components/weekly-performance-dashboard";
import { canAccountViewRevenue } from "@/lib/auth";
import { requireCurrentAccount } from "@/lib/server-auth";
import { getDefaultWeeklyRange } from "@/lib/weekly-performance";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export default async function WeeklyPerformancePage() {
  const account = await requireCurrentAccount("/weekly");

  if (!canAccountViewRevenue(account)) {
    redirect("/");
  }

  const channels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const defaultRange = getDefaultWeeklyRange();

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Weekly Performance</h1>
                <Badge variant="secondary" className="rounded-md">
                  Admin
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Channel-wise weekly view for revenue, watch time, subscribers, and peer movement.
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

        <WeeklyPerformanceDashboard
          channels={channels}
          defaultEndDate={defaultRange.endDate}
          defaultStartDate={defaultRange.startDate}
        />
      </div>
    </main>
  );
}

function filterChannelsForAccount<T extends { channelId: string }>(
  channels: T[],
  account: { channelIds: string[] | null }
) {
  if (account.channelIds === null) return channels;

  const allowedChannelIds = new Set(account.channelIds);
  return channels.filter((channel) => allowedChannelIds.has(channel.channelId));
}
