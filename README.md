# Channel Pulse

Channel Pulse is a standalone Next.js dashboard for YouTube CMS performance. It tracks monthly channel performance, compares custom date ranges, syncs YouTube Analytics data on demand, and exports management-ready reports.

## Stack

- Next.js 15 App Router
- Turso/libSQL storage
- YouTube Analytics and Data APIs
- Shadcn-style UI components
- Node test runner for utility coverage

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env.local
```

3. Fill in the required values:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `YOUTUBE_OAUTH_REFRESH_TOKEN`
- `YOUTUBE_CONTENT_OWNER_ID`
- `DASHBOARD_BASIC_PASSWORD`
- `CHANNEL_PULSE_SESSION_SECRET`

4. Apply the dashboard schema in Turso:

```bash
npm run db:schema:turso
```

5. Start the app:

```bash
npm run dev
```

Open `/` for the dashboard hub. The monthly dashboard lives at `/monthly`, and the comparison dashboard lives at `/compare`.

### Monthly growth

Open **Monthly Growth** from Home or visit `/monthly-growth`. Select a start/end month, one or more channels, and the metrics to display. Filters update automatically. The combined charts include only selected channels, followed by an individual section for each selected channel. Months run horizontally; each metric has its own scale, total, numeric change, and growth/loss badge.

Every selected month compares with its previous calendar month, including the first month. For an April–September range, April compares with March; March is used only for comparison and is not displayed or exported as a separate month. Current-month totals are labeled month to date through the latest stored day and compared with the full previous month. Missing days are flagged, and comparisons requiring incomplete data are unavailable. Percentages are unavailable for zero or negative previous values; numeric changes remain visible when coverage is complete.

**Download Excel** exports the loaded selection as an `.xlsx` workbook with horizontal month columns and Total, Change, and Change (%) subcolumns for the combined and individual channel sections. Channel access and revenue visibility follow the logged-in account's permissions. Ranges support 1–36 months, including the current month, with no future months.

### Daily status

Open **Daily Status** from Home or visit `/daily-status`. Select one or more accessible channels and a date (yesterday by default). Summary cards and the channel table show that day's total views, watch hours, and net subscribers (gained minus lost). Revenue-enabled admins also see estimated revenue in USD.

The recent-video section shows views, watch hours, and (for revenue-enabled accounts) estimated revenue earned on that same reporting day by videos published in the preceding two calendar months through the selected date, inclusive. For 20 October, the publication window is 20 August–20 October; month ends are clamped where necessary. Publication boundaries use India time (IST), while analytics retain YouTube's reporting dates. Recent-video revenue is selectable and included in Excel when selected. Pending monetary reports stay unavailable; they do not block views or watch hours or count as zero.

All-video metrics come from stored channel daily analytics. Recent-video results are permanently stored in Turso's `youtube_daily_video_cohort_metrics`, keyed by channel, reporting date, publication window, and calculation version. Rows contain views, watch hours, video count, nullable estimated revenue, and separate activity/revenue fetch timestamps. They survive app restarts and are not deleted when old. The migration preserves successful rows from the earlier `youtube_daily_recent_video_cache` table. Normal dashboard loads read the stored dataset immediately and do not wait for live YouTube calls. Missing dates are identified explicitly.

**Refresh data** explicitly fetches and saves a new result for the selected channels/date. This can take time on large upload catalogs. If YouTube fails, the last saved result remains visible with its original fetch time and a warning. Failed or incomplete activity responses never replace successful activity results. Pending revenue retains previously reported revenue with its original revenue timestamp. These requests do not use the period-based video metrics table. Existing CMS and direct-channel credentials apply.

For an existing installation, run `npm run db:schema:daily-status-cache` to add the durable dataset and background job tables and preserve earlier cache rows. Full schema setup (`npm run db:schema:turso`) includes them automatically. This migration does not change existing channel or period-based video analytics.

### Automatic Daily Status refresh

Run the worker as a separate service alongside the web app (Node **22.15+**):

```bash
npm run daily-status:worker
```

It refreshes all configured channels for the last **10 completed India-time calendar days** immediately when due and every **6 hours** by default. Set `DAILY_STATUS_REFRESH_INTERVAL_HOURS` to a value from 1–24 to change the interval. For example, on 20 October it refreshes 10–19 October. It updates stored daily channel metrics, recent-video views/watch hours, and recent-video revenue. Each channel's complete upload list is fetched once per run and reused across the ten dates.

The worker runs independently of browser visits, uses a renewable Turso lease to prevent concurrent runs across hosts, records per-run progress in `youtube_daily_status_refresh_runs`, and stores scheduling/lease state in `youtube_daily_status_refresh_state`. Pending revenue and missing API data are recorded as partial results and retried on subsequent runs. Failed refreshes preserve prior reporting values. Stop the worker with SIGTERM or Ctrl+C; the next start resumes normal scheduling, and interrupted runs become eligible for retry. `.daily-status-worker/worker.pid` identifies the local worker.

For a one-time refresh or a runtime/configuration check:

```bash
npm run daily-status:refresh
npm run daily-status:worker -- --dry-run
```

On a hosted deployment, run the worker under the host's service supervisor so it restarts after crashes/reboots. A serverless web deployment alone does not host this long-running worker; an always-on worker host is required. While running locally, this machine must remain awake. No dashboard tab needs to stay open.

The authenticated endpoint is `GET /api/daily-status?date=YYYY-MM-DD&channel=CHANNEL_ID`, with repeated `channel` parameters for multiple channels. Add `refresh=1` to bypass saved recent-video results. Future dates and inaccessible channels are rejected. Revenue values are excluded server-side for accounts without revenue access. The existing Daily Publishing dashboard remains available separately.

The **Metrics** checkboxes control the summary cards, channel table, and Excel columns. All permitted metrics are selected by default; use **All metrics** or **Clear metrics** to adjust them together. Revenue is offered only to revenue-enabled accounts. Metric selection updates the loaded view immediately without another analytics request.

**Download Excel** exports the currently loaded date and selected channels to an `.xlsx` workbook, with one row per channel and only the selected metrics. It includes availability details for the selected metric groups. Reporting date and, when recent-video metrics are selected, the two-month publication window appear above the table. Missing metrics remain marked **Unavailable**. Downloads are disabled while the selected date/channels are loading or invalid, or no metrics are selected, so an earlier selection cannot be exported accidentally.

## Syncing Data

Use the channel refresh button in the dashboard to pull the CMS-managed channel catalog, select one channel, then sync the month or date range you want to report on.

### Fixed direct channels outside the CMS

If one Google account has YouTube API access to a fixed set of non-CMS channels, add an explicit channel allowlist:

```bash
YOUTUBE_DIRECT_CHANNEL_IDS=UC_CHANNEL_1,UC_CHANNEL_2,UC_CHANNEL_3
```

Channel Pulse reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `YOUTUBE_OAUTH_REFRESH_TOKEN`. If the fixed channels need a different OAuth grant, set `YOUTUBE_DIRECT_REFRESH_TOKEN` to override the shared token. The grant needs `youtube.readonly`, `yt-analytics.readonly`, and—when revenue is required—`yt-analytics-monetary.readonly`.

When Google authorizes each Brand channel as a separate YouTube identity, provide a token per channel as a JSON object. A channel-specific token takes precedence over the shared token:

```bash
YOUTUBE_DIRECT_CHANNEL_REFRESH_TOKENS='{"UC_CHANNEL_1":"refresh-token-1","UC_CHANNEL_2":"refresh-token-2"}'
```

Channel Pulse only imports IDs in `YOUTUBE_DIRECT_CHANNEL_IDS`. Direct channels use `ids=channel==CHANNEL_ID`; CMS channels continue using the content-owner query path.

After updating the environment, restart Channel Pulse and use **Refresh Channels** once. The configured channels then appear in the same dashboards, targets, comparisons, daily publishing views, and exports as CMS channels.

The sync API is also available directly:

```bash
curl -X POST http://localhost:3000/api/youtube/sync \
  -H "content-type: application/json" \
  -d '{"channelId":"UCXjhJbviBl0M4JAC3cxDXqA","startDate":"2026-05-01","endDate":"2026-05-31"}'
```

Revenue values are YouTube API-reported estimates. `creatorContentType` is used for Shorts and long-form splits where the Analytics API allows it; otherwise Channel Pulse falls back to video duration.

To backfill all focused CMS and configured direct channels from YouTube into the database, run:

```bash
npm run youtube:backfill
```

By default this force-syncs the last six completed calendar months. To run the previous six-month block after that:

```bash
npm run youtube:backfill -- --offset-months=6
```

Useful options:

- `--dry-run` lists the channels and date range without syncing.
- `--skip-complete` skips channels whose daily metrics are already complete.
- `--channel=UC...` limits the run to one channel; repeat it or comma-separate IDs for multiple channels.
- `--start=YYYY-MM-DD --end=YYYY-MM-DD` syncs a custom range.
- `--concurrency=2` controls how many channels sync at once.
- `--include-current` extends the range through yesterday instead of stopping at the last completed month.

After applying the August 2026 engaged-view schema update, backfill the rolling baseline window plus the current month:

```bash
npm run youtube:backfill-engaged
```

This force-refreshes 13 calendar months so `engagedViews` is available for the 12-month target baseline and current-month reporting.

## Database

Channel Pulse uses standard SQL tables for dashboard data. For Turso/libSQL, run:

- `database/turso-channel-pulse-schema.sql`

To copy only the schema into Turso, run:

```bash
npm run db:schema:turso
```

The schema creates the private analytics tables used by the dashboards:

- `youtube_managed_channels`
- `youtube_video_catalog`
- `youtube_channel_daily_metrics`
- `youtube_video_daily_metrics`
- `youtube_daily_recent_video_cache`
- `youtube_daily_video_cohort_metrics`
- `youtube_daily_status_refresh_state`
- `youtube_daily_status_refresh_runs`
- `youtube_content_type_daily_metrics`
- `youtube_country_daily_metrics`
- `youtube_analytics_sync_runs`

## Auth

The dashboard and YouTube API routes are protected by the Channel Pulse login page.

`DASHBOARD_BASIC_USER` and `DASHBOARD_BASIC_PASSWORD` create the admin account. Admins can view revenue details and refresh the channel catalog.

Create a second admin with every management capability except revenue access:

```bash
DASHBOARD_RESTRICTED_ADMIN_USER=admin
DASHBOARD_RESTRICTED_ADMIN_PASSWORD=strong-password
```

This account can manage targets, refresh channels, and download reports, but revenue metrics and revenue target fields are removed from dashboards and report choices. Revenue report columns are also rejected by the API.

Add other accounts with `CHANNEL_PULSE_ACCOUNTS`:

```bash
CHANNEL_PULSE_ACCOUNTS='[
  {"username":"viewer","password":"strong-password","role":"user","channels":"all"},
  {"username":"admin","password":"strong-password","role":"admin_no_revenue","channels":"all"},
  {"username":"channel-example","password":"strong-password","role":"user","channels":["UCXjhJbviBl0M4JAC3cxDXqA"]}
]'
```

Accounts with `role: "user"` cannot see revenue cards, revenue tables, country revenue, CPM, ad impressions, or revenue video leaderboards. Use `channels: "all"` for a non-revenue user who can see all channels, or provide a channel ID array to create one login per channel.

## Tests

```bash
npm test
```

### Date-range analytics and historical backfills

Date-range analytics reads the database only. Opening the page or generating graphs does not fetch YouTube data. Cards and channel rows show labeled partial sums and coverage; incomplete CSV totals remain unavailable.

Run the background worker with `npm run daily-status:worker` (default interval: six hours). It refreshes the latest ten completed dates, limits concurrency to two channels, shares upload scans, and uses a database lease to prevent overlapping workers. Quota errors stop the run; failed runs wait for the configured interval before retrying. Completed historical recent-video results are reused, and recent complete results are reused until their refresh interval expires.

To backfill an inclusive historical range for all configured channels:

```sh
npm run daily-status:refresh -- --start=2026-10-01 --end=2026-10-24
```

To retry that historical range on the worker schedule until YouTube has reported delayed metrics, pass the same date arguments to `npm run daily-status:worker`. A worker with a historical range processes that range first and then the rolling ten-day window each cycle. Historical ranges outside the rolling ten-day window must be explicitly scheduled this way or rerun; the default worker does not automatically discover them. Read progress with:

```sh
node --env-file=.env.local scripts/daily-status-progress.mjs
```

Saved results remain visible if the worker is stopped. Keep the worker process running on an always-on host for continuing updates.
