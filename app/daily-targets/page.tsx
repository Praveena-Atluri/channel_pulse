import { Home, Target } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppLogo } from "@/components/app-logo";
import { DailyPublishingTargetsDashboard } from "@/components/daily-publishing-targets-dashboard";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { canAccountManageDashboard } from "@/lib/auth";
import { getDailyPublishingTargetDashboardDataSafe } from "@/lib/daily-targets";
import { requireCurrentAccount } from "@/lib/server-auth";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export default async function DailyTargetsPage() {
  const account = await requireCurrentAccount("/daily-targets");

  if (!canAccountManageDashboard(account)) {
    redirect("/");
  }

  const channels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const dailyTargets = await getDailyPublishingTargetDashboardDataSafe({ channels });

  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Daily Targets</h1>
                <Badge variant="secondary" className="rounded-md">
                  Admin
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Set daily long and short video publishing targets per channel.
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

        <section className="rounded-lg border bg-card/95 p-4 shadow-sm">
          <DailyPublishingTargetsDashboard
            errorMessage={dailyTargets.errorMessage}
            rows={dailyTargets.rows}
            schemaReady={dailyTargets.schemaReady}
          />
        </section>
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
