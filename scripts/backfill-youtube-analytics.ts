import { getIncompleteYoutubeAnalyticsChannelIds } from "@/lib/youtube-auto-sync";
import {
  listStoredYoutubeManagedChannels,
  refreshYoutubeManagedChannelCatalog,
  type StoredYoutubeManagedChannel
} from "@/lib/youtube-managed-channels";
import { syncYoutubeCmsAnalytics } from "@/lib/youtube-performance-sync";

type BackfillOptions = {
  channelIds: string[];
  concurrency: number;
  dryRun: boolean;
  endDate?: string;
  force: boolean;
  months: number;
  offsetMonths: number;
  startDate?: string;
};

type BackfillResult = {
  channel: StoredYoutubeManagedChannel;
  durationMs: number;
  metricsRowsSynced: number;
  status: "synced" | "skipped" | "failed";
  videosSynced: number;
  warnings: string[];
  error?: string;
};

const DEFAULT_MONTHS = 6;
const DEFAULT_CONCURRENCY = 2;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const range = resolveBackfillRange(options);
  const channels = await getBackfillChannels(options);

  if (channels.length === 0) {
    throw new Error("No Channel Pulse channels were found. Refresh the channel catalog first, then run backfill again.");
  }

  console.log(`Channel Pulse YouTube backfill`);
  console.log(`Range: ${range.startDate} to ${range.endDate}`);
  console.log(`Channels: ${channels.length}`);
  console.log(`Concurrency: ${options.concurrency}`);
  console.log(`Mode: ${options.force ? "force sync" : "skip complete ranges"}`);

  if (options.dryRun) {
    console.log("");
    console.log("Dry run only. Channels that would be synced:");
    for (const channel of channels) {
      console.log(`- ${channel.title} (${channel.channelId})`);
    }
    return;
  }

  const startedAt = Date.now();
  const results = await mapWithConcurrency(channels, options.concurrency, async (channel, index) => {
    const position = `${index + 1}/${channels.length}`;
    const label = `${channel.title} (${channel.channelId})`;
    console.log(`[${position}] Syncing ${label}`);
    const result = await backfillChannel(channel, range.startDate, range.endDate, options.force);

    if (result.status === "synced") {
      console.log(
        `[${position}] Done ${label} - ${result.metricsRowsSynced} metric row(s), ${result.videosSynced} video(s), ${formatDuration(result.durationMs)}`
      );
    } else if (result.status === "skipped") {
      console.log(`[${position}] Skipped ${label} - complete data already exists`);
    } else {
      console.log(`[${position}] Failed ${label} - ${result.error}`);
    }

    const revenueWarning = getRevenueWarning(result.warnings);
    if (revenueWarning) {
      console.log(`[${position}] Revenue warning: ${revenueWarning}`);
    }

    return result;
  });

  const failed = results.filter((result) => result.status === "failed");
  const synced = results.filter((result) => result.status === "synced");
  const skipped = results.filter((result) => result.status === "skipped");
  const revenueWarnings = results.filter((result) => getRevenueWarning(result.warnings)).length;

  console.log("");
  console.log(`Backfill finished in ${formatDuration(Date.now() - startedAt)}`);
  console.log(`Synced: ${synced.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Channels with revenue warnings: ${revenueWarnings}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

async function backfillChannel(
  channel: StoredYoutubeManagedChannel,
  startDate: string,
  endDate: string,
  force: boolean
): Promise<BackfillResult> {
  const startedAt = Date.now();

  try {
    if (!force) {
      const missingChannelIds = await getIncompleteYoutubeAnalyticsChannelIds({
        channels: [{ channelId: channel.channelId }],
        startDate,
        endDate
      });

      if (missingChannelIds.length === 0) {
        return {
          channel,
          durationMs: Date.now() - startedAt,
          metricsRowsSynced: 0,
          status: "skipped",
          videosSynced: 0,
          warnings: []
        };
      }
    }

    const syncResult = await syncYoutubeCmsAnalytics({
      channelId: channel.channelId,
      startDate,
      endDate,
      syncType: "backfill"
    });
    const missingAfterSync = await getIncompleteYoutubeAnalyticsChannelIds({
      channels: [{ channelId: channel.channelId }],
      startDate,
      endDate
    });

    if (missingAfterSync.length > 0) {
      throw new Error(`Daily channel metrics are still incomplete for ${startDate} to ${endDate}.`);
    }

    return {
      channel,
      durationMs: Date.now() - startedAt,
      metricsRowsSynced: syncResult.metricsRowsSynced,
      status: "synced",
      videosSynced: syncResult.videosSynced,
      warnings: syncResult.warnings
    };
  } catch (error) {
    return {
      channel,
      durationMs: Date.now() - startedAt,
      metricsRowsSynced: 0,
      status: "failed",
      videosSynced: 0,
      warnings: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function getBackfillChannels(options: BackfillOptions) {
  const channels = options.dryRun ? await listStoredYoutubeManagedChannels() : await refreshYoutubeManagedChannelCatalog();
  if (options.channelIds.length === 0) return channels;

  const allowed = new Set(options.channelIds);
  return channels.filter((channel) => allowed.has(channel.channelId));
}

function resolveBackfillRange(options: BackfillOptions) {
  if (options.startDate || options.endDate) {
    if (!options.startDate || !options.endDate) {
      throw new Error("Provide both --start and --end, or neither.");
    }
    assertDate(options.startDate, "--start");
    assertDate(options.endDate, "--end");
    if (toUtcDate(options.startDate).getTime() > toUtcDate(options.endDate).getTime()) {
      throw new Error("--start must be before or equal to --end.");
    }
    return { startDate: options.startDate, endDate: options.endDate };
  }

  const now = new Date();
  const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - options.offsetMonths, 1));
  const endDate = new Date(endMonth.getTime() - 86_400_000);
  const startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - options.months + 1, 1));

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate)
  };
}

function parseArgs(args: string[]): BackfillOptions {
  const options: BackfillOptions = {
    channelIds: [],
    concurrency: Number(process.env.BACKFILL_CHANNEL_CONCURRENCY ?? DEFAULT_CONCURRENCY),
    dryRun: false,
    force: true,
    months: Number(process.env.BACKFILL_MONTHS ?? DEFAULT_MONTHS),
    offsetMonths: Number(process.env.BACKFILL_OFFSET_MONTHS ?? 0)
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-complete") {
      options.force = false;
    } else if (arg.startsWith("--start=")) {
      options.startDate = arg.slice("--start=".length);
    } else if (arg.startsWith("--end=")) {
      options.endDate = arg.slice("--end=".length);
    } else if (arg.startsWith("--months=")) {
      options.months = parsePositiveInteger(arg.slice("--months=".length), "--months");
    } else if (arg.startsWith("--offset-months=")) {
      options.offsetMonths = parseNonNegativeInteger(arg.slice("--offset-months=".length), "--offset-months");
    } else if (arg.startsWith("--concurrency=")) {
      options.concurrency = parsePositiveInteger(arg.slice("--concurrency=".length), "--concurrency");
    } else if (arg.startsWith("--channel=")) {
      options.channelIds.push(...arg.slice("--channel=".length).split(",").map((value) => value.trim()).filter(Boolean));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.months = parsePositiveInteger(String(options.months), "--months");
  options.concurrency = parsePositiveInteger(String(options.concurrency), "--concurrency");
  options.offsetMonths = parseNonNegativeInteger(String(options.offsetMonths), "--offset-months");

  return options;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function getRevenueWarning(warnings: string[]) {
  const warning = warnings.find((item) => item.toLowerCase().includes("revenue report skipped"));
  if (!warning) return "";
  if (warning.includes("Insufficient permission to access this report")) {
    return "YouTube rejected revenue metrics with insufficient permission. Regenerate the OAuth refresh token with monetary analytics access.";
  }
  return warning.split("\n")[0] ?? warning;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function assertDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || formatDate(toUtcDate(value)) !== value) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}
