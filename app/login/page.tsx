import { Activity, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { AppLogo } from "@/components/app-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  CHANNEL_PULSE_SESSION_COOKIE,
  getLoginDefaultUsername,
  isAuthConfigured,
  isSessionTokenValid,
  sanitizeNextPath
} from "@/lib/auth";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(params.next);
  const cookieStore = await cookies();
  const isLoggedIn = await isSessionTokenValid(cookieStore.get(CHANNEL_PULSE_SESSION_COOKIE)?.value);

  if (isLoggedIn) {
    redirect(nextPath);
  }

  const configured = isAuthConfigured();
  const errorMessage = getErrorMessage(params.error, configured);
  const defaultUsername = getLoginDefaultUsername();

  return (
    <main className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AppLogo />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Channel Pulse</h1>
                <Badge variant="secondary" className="rounded-md">
                  Secure Access
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">Sign in to open the dashboard.</p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <section className="grid flex-1 items-center py-10">
          <div className="mx-auto grid w-full max-w-md gap-4 rounded-lg border bg-card/95 p-5 shadow-sm">
            <div className="grid gap-2">
              <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <LockKeyhole className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-black">Log in</h2>
                <p className="text-sm text-muted-foreground">Use your Channel Pulse dashboard credentials.</p>
              </div>
            </div>

            {errorMessage ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {errorMessage}
              </div>
            ) : null}

            <form action="/api/auth/login" method="post" className="grid gap-4">
              <input type="hidden" name="next" value={nextPath} />

              <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
                Username
                <input
                  autoComplete="username"
                  className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  defaultValue={defaultUsername}
                  name="username"
                  required
                />
              </label>

              <label className="grid gap-1 text-sm font-semibold text-muted-foreground">
                Password
                <input
                  autoComplete="current-password"
                  className="h-11 rounded-md border bg-background px-3 text-sm font-semibold text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  name="password"
                  required
                  type="password"
                />
              </label>

              <button
                className={buttonVariants({ className: "h-11 rounded-md" })}
                disabled={!configured}
                type="submit"
              >
                <Activity className="mr-2 size-4" />
                Open Dashboard
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

function getErrorMessage(error: string | undefined, configured: boolean) {
  if (!configured || error === "config") {
    return "Configure at least one Channel Pulse account before logging in.";
  }

  if (error === "invalid") {
    return "The username or password is incorrect.";
  }

  return "";
}
