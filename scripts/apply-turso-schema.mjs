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
  const schemaPath = join(ROOT_DIR, "database", "turso-channel-pulse-schema.sql");
  const schema = await readFile(schemaPath, "utf8");
  await turso.executeMultiple(schema);
  await ensureMonthlyTargetColumns();
  console.log("Turso schema applied.");
} finally {
  turso.close();
}

async function ensureMonthlyTargetColumns() {
  const result = await turso.execute("pragma table_info(youtube_monthly_channel_targets)");
  const columns = new Set(result.rows.map((row) => String(row.name)));
  const additions = [
    {
      table: "youtube_channel_daily_metrics",
      name: "impressions_click_through_rate",
      sql: "alter table youtube_channel_daily_metrics add column impressions_click_through_rate real"
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
    }
  ];

  for (const addition of additions) {
    const tableColumns =
      addition.table === "youtube_monthly_channel_targets"
        ? columns
        : new Set((await turso.execute(`pragma table_info(${addition.table})`)).rows.map((row) => String(row.name)));

    if (!tableColumns.has(addition.name)) {
      await turso.execute(addition.sql);
    }
  }
}
