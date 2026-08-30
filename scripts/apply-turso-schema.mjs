#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@libsql/client/web";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

if (!process.env.TURSO_DATABASE_URL) {
  console.error("Missing environment variable: TURSO_DATABASE_URL");
  process.exit(1);
}

const turso = createClient({
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: "number",
  url: process.env.TURSO_DATABASE_URL
});

try {
  await ensureCompatibilityColumns();
  const schemaPath = join(ROOT_DIR, "database", "turso-channel-pulse-schema.sql");
  const schema = await readFile(schemaPath, "utf8");
  await turso.executeMultiple(schema);
  await ensureCompatibilityColumns();
  console.log("Turso schema applied.");
} finally {
  turso.close();
}

async function ensureCompatibilityColumns() {
  const additions = [
    ...[
      "youtube_channel_daily_metrics",
      "youtube_video_daily_metrics",
      "youtube_content_type_daily_metrics",
      "youtube_country_daily_metrics"
    ].map((table) => ({
      table,
      name: "engaged_views",
      sql: `alter table ${table} add column engaged_views integer`
    })),
    {
      table: "youtube_content_type_daily_metrics",
      name: "average_view_percentage",
      sql: "alter table youtube_content_type_daily_metrics add column average_view_percentage real"
    },
    {
      table: "youtube_channel_daily_metrics",
      name: "impressions_click_through_rate",
      sql: "alter table youtube_channel_daily_metrics add column impressions_click_through_rate real"
    },
    {
      table: "youtube_video_catalog",
      name: "privacy_status",
      sql: "alter table youtube_video_catalog add column privacy_status text not null default 'unknown' check (privacy_status in ('public', 'unlisted', 'private', 'unknown'))"
    },
    {
      table: "youtube_monthly_channel_targets",
      name: "short_engaged_views_target",
      sql: "alter table youtube_monthly_channel_targets add column short_engaged_views_target integer check (short_engaged_views_target is null or short_engaged_views_target >= 0)"
    },
    {
      table: "youtube_monthly_channel_targets",
      name: "long_engaged_views_target",
      sql: "alter table youtube_monthly_channel_targets add column long_engaged_views_target integer check (long_engaged_views_target is null or long_engaged_views_target >= 0)"
    },
    {
      table: "youtube_monthly_channel_targets",
      name: "short_videos_target",
      sql: "alter table youtube_monthly_channel_targets add column short_videos_target integer check (short_videos_target is null or short_videos_target >= 0)"
    },
    {
      table: "youtube_monthly_channel_targets",
      name: "long_videos_target",
      sql: "alter table youtube_monthly_channel_targets add column long_videos_target integer check (long_videos_target is null or long_videos_target >= 0)"
    },
    {
      table: "youtube_monthly_channel_targets",
      name: "estimated_revenue_target",
      sql: "alter table youtube_monthly_channel_targets add column estimated_revenue_target real check (estimated_revenue_target is null or estimated_revenue_target >= 0)"
    },
    {
      table: "youtube_monthly_channel_targets",
      name: "long_average_view_percentage_target",
      sql: "alter table youtube_monthly_channel_targets add column long_average_view_percentage_target real check (long_average_view_percentage_target is null or long_average_view_percentage_target >= 0)"
    },
    {
      table: "youtube_daily_channel_targets",
      name: "short_videos_target_period",
      sql: "alter table youtube_daily_channel_targets add column short_videos_target_period text not null default 'daily' check (short_videos_target_period in ('daily', 'weekly'))"
    },
    {
      table: "youtube_daily_channel_targets",
      name: "long_videos_target_period",
      sql: "alter table youtube_daily_channel_targets add column long_videos_target_period text not null default 'daily' check (long_videos_target_period in ('daily', 'weekly'))"
    }
  ];

  for (const addition of additions) {
    const tableColumns = await getTableColumns(addition.table);

    if (tableColumns.size === 0) continue;
    if (!tableColumns.has(addition.name)) {
      await turso.execute(addition.sql);
    }
  }
}

async function getTableColumns(table) {
  const result = await turso.execute(`pragma table_info(${table})`);
  return new Set(result.rows.map((row) => String(row.name)));
}
