import { Home, Target } from "lucide-react";
import Link from "next/link";

import { AppLogo } from "@/components/app-logo";
import { MonthlyTargetsDashboard } from "@/components/monthly-targets-dashboard";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { canAccountViewRevenue } from "@/lib/auth";
import { getEditableTargetMonths } from "@/lib/monthly-target-metrics";
import { requireCurrentAccount } from "@/lib/server-auth";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  const account = await requireCurrentAccount("/targets");
  const canEditTargets = canAccountViewRevenue(account);

  const channels = filterChannelsForAccount(await listStoredYoutubeManagedChannels(), account);
  const availableMonths = getEditableTargetMonths();

  return (
    <main className="youtube-report-page min-h-screen overflow-x-hidden p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex min-w-0 flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <AppLogo />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Monthly Targets</h1>
                <Badge variant="secondary" className="rounded-md">
                  {canEditTargets ? "Admin" : "Viewer"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {canEditTargets
                  ? "Set monthly targets and track achieved performance so far."
                  : "View monthly target status for your assigned channels."}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href="/" className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}>
              <Home className="size-4" />
              Home
            </Link>
            <LogoutButton />
            <ThemeToggle />
          </div>
        </header>

        <section className="min-w-0 rounded-lg border bg-card/95 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-base font-black">
            <Target className="size-4 text-primary" />
            Target Workspace
          </div>
          <MonthlyTargetsDashboard
            availableMonths={availableMonths}
            canEditTargets={canEditTargets}
            channels={channels}
            defaultMonth={availableMonths[0]}
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
