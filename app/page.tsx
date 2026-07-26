import { redirect } from "next/navigation";

import { AppLogo } from "@/components/app-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { YoutubeDashboardLinks } from "@/components/youtube-dashboard-links";
import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";
import { canAccountManageDashboard } from "@/lib/auth";
import { requireCurrentAccount } from "@/lib/server-auth";

type HomePageProps = {
  searchParams: Promise<{
    month?: string;
    channel?: string;
    contentType?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const account = await requireCurrentAccount("/");
  const query = new URLSearchParams();

  for (const key of ["month", "channel", "contentType"] as const) {
    if (params[key]) {
      query.set(key, params[key]);
    }
  }

  if (query.size > 0) {
    redirect(`/monthly?${query.toString()}`);
  }

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex flex-col gap-4 rounded-lg border bg-card/95 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Channel Pulse</h1>
                <Badge variant="secondary" className="rounded-md">
                  CMS Analytics
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">Management dashboards for CMS channel performance.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <LogoutButton />
            <ThemeToggle />
          </div>
        </header>

        <YoutubeDashboardLinks canViewReports={canAccountManageDashboard(account)} />
      </div>
    </main>
  );
}
