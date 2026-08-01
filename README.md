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
