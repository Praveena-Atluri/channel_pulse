"use client";

import { ArrowRight, BarChart3, CalendarDays, FileDown, GitCompareArrows, LoaderCircle, Target } from "lucide-react";
import Link from "next/link";
import { useState, type MouseEvent } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const dashboardLinks = [
  {
    href: "/monthly",
    title: "Monthly Dashboard",
    description: "Views, watch time, subscribers, long vs short split, and video rankings.",
    Icon: CalendarDays,
    adminOnly: false
  },
  {
    href: "/compare",
    title: "Comparison Dashboard",
    description: "Compare two custom date ranges for views, watch time, subscribers, formats, and video gains.",
    Icon: GitCompareArrows,
    adminOnly: false
  },
  {
    href: "/weekly",
    title: "Weekly Performance",
    description: "Review weekly channel performance, comparisons, strengths, and weaknesses.",
    Icon: BarChart3,
    adminOnly: true
  },
  {
    href: "/reports",
    title: "Report Downloads",
    description: "Generate Excel reports for range summaries and comparison metrics.",
    Icon: FileDown,
    adminOnly: true
  },
  {
    href: "/targets",
    title: "Monthly Targets",
    description: "Set channel targets for format views, watch hours, and net subscribers.",
    Icon: Target,
    adminOnly: true
  }
] as const;

type DashboardHref = (typeof dashboardLinks)[number]["href"];

export function YoutubeDashboardLinks({ canViewReports = false }: { canViewReports?: boolean }) {
  const [pendingHref, setPendingHref] = useState<DashboardHref | null>(null);
  const visibleLinks = dashboardLinks.filter((link) => !link.adminOnly || canViewReports);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>, href: DashboardHref) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    setPendingHref(href);
  };

  return (
    <section
      className={
        visibleLinks.length > 2
          ? "grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4"
          : "grid items-stretch gap-4 md:grid-cols-2"
      }
      aria-busy={pendingHref ? "true" : "false"}
    >
      {visibleLinks.map(({ href, title, description, Icon }) => {
        const isPending = pendingHref === href;

        return (
          <Link
            key={href}
            href={href}
            onClick={(event) => handleClick(event, href)}
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={isPending ? `Opening ${title}` : title}
          >
            <Card
              className={
                isPending
                  ? "flex h-full min-h-40 flex-col border-primary shadow-sm transition"
                  : "flex h-full min-h-40 flex-col shadow-sm transition hover:border-primary"
              }
            >
              <CardHeader className="pb-3">
                <CardTitle className="grid grid-cols-[1fr_auto] items-start gap-3 text-base">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="size-4 text-primary" />
                    <span className="truncate">{title}</span>
                  </span>
                  {isPending ? (
                    <span className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground">
                      <LoaderCircle className="size-3 animate-spin" />
                      Opening
                    </span>
                  ) : (
                    <ArrowRight className="size-4 text-muted-foreground" />
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 items-start pt-0 text-sm leading-relaxed text-muted-foreground">
                <span>{description}</span>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </section>
  );
}
