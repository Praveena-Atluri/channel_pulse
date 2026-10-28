import { Home } from "lucide-react";
import Link from "next/link";
import { AppLogo } from "@/components/app-logo";
import { DailyStatusDashboard } from "@/components/daily-status-dashboard";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { canAccountViewRevenue } from "@/lib/auth";
import { getDailyStatusToday, shiftDailyStatusDay, type DailyStatusChannel } from "@/lib/daily-status";
import { requireCurrentAccount } from "@/lib/server-auth";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export default async function DailyStatusPage() {
  const account = await requireCurrentAccount("/daily-status");
  let channels: DailyStatusChannel[] = [];
  let catalogError = false;
  try {
    channels = (await listStoredYoutubeManagedChannels()).filter((channel) => account.channelIds === null || account.channelIds.includes(channel.channelId))
      .map(({ channelId, title }) => ({ channelId, title }));
  } catch { catalogError = true; }
  const today = getDailyStatusToday();
  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3"><div className="shrink-0"><AppLogo /></div><div><h1 className="text-2xl font-black">Daily Status</h1>
            <p className="text-sm text-muted-foreground">Day-wise channel performance and contributions from recently published videos.</p></div></div>
          <div className="flex items-center gap-2"><Link href="/" className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}><Home className="size-4" />Home</Link><LogoutButton /><ThemeToggle /></div>
        </header>
        {catalogError ? <div role="alert" className="rounded-lg border bg-card p-4">Unable to load channels. Refresh this page to try again.</div> : (
          <DailyStatusDashboard channels={channels} canViewRevenue={canAccountViewRevenue(account)} today={today} defaultDate={shiftDailyStatusDay(today, -1)} />
        )}
      </div>
    </main>
  );
}
