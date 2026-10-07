import { Home, TrendingUp } from "lucide-react";
import Link from "next/link";
import { AppLogo } from "@/components/app-logo";
import { LogoutButton } from "@/components/logout-button";
import { MonthlyGrowthDashboard } from "@/components/monthly-growth-dashboard";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { canAccountViewRevenue } from "@/lib/auth";
import { getMonthlyGrowthToday, shiftGrowthMonth } from "@/lib/monthly-growth";
import { requireCurrentAccount } from "@/lib/server-auth";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";

export const dynamic = "force-dynamic";

export default async function MonthlyGrowthPage() {
  const account = await requireCurrentAccount("/monthly-growth");
  let channels: Array<{ channelId: string; title: string }> = [];
  let catalogError = false;
  try {
    channels = (await listStoredYoutubeManagedChannels()).filter(
      (channel) => account.channelIds === null || account.channelIds.includes(channel.channelId)
    ).map(({ channelId, title }) => ({ channelId, title }));
  } catch { catalogError = true; }
  const currentMonth = getMonthlyGrowthToday().slice(0, 7);
  const defaultEndMonth = shiftGrowthMonth(currentMonth, -1);
  return (
    <main className="youtube-report-page min-h-screen p-4 md:p-6">
      <div className="youtube-report-shell mx-auto flex max-w-7xl flex-col gap-4">
        <header className="youtube-report-header flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-black"><TrendingUp className="size-6 text-primary" /> Monthly Growth</h1>
              <p className="text-sm text-muted-foreground">Track month-by-month growth and loss for your selected channels and metrics.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className={buttonVariants({ variant: "secondary", className: "h-10 rounded-md" })}><Home className="size-4" /> Home</Link>
            <LogoutButton /><ThemeToggle />
          </div>
        </header>
        {catalogError ? <div role="alert" className="rounded-lg border bg-card p-4">Unable to load channels. Refresh this page to try again.</div> : (
          <MonthlyGrowthDashboard channels={channels} canViewRevenue={canAccountViewRevenue(account)} currentMonth={currentMonth}
            defaultStartMonth={shiftGrowthMonth(defaultEndMonth, -5)} defaultEndMonth={defaultEndMonth} />
        )}
      </div>
    </main>
  );
}
