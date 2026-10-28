import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import type { RecentVideoCacheRow } from "../lib/daily-status-cache.ts";

// Load the real route, service and Google adapters; replace only database/catalog boundaries.
const state = {
  tables: [] as string[], selections: [] as string[], date: "2026-10-19", failCatalog: false,
  failAnalytics: false, missingMetadata: false, missingDay: false, reportRequests: [] as URL[],
  playlistPages: [] as string[], oauthCalls: 0, catalogFailure: false,
  cacheRows: [] as RecentVideoCacheRow[], cacheReadFailure: false, cacheWriteFailure: false
};
(globalThis as any).__dailyStatusFixture = {
  channels: [{ channelId: "UCa", title: "A" }, { channelId: "UCb", title: "B" }],
  database: () => ({ from(table: string) {
    state.tables.push(table);
    assert.ok(["youtube_channel_daily_metrics", "youtube_daily_video_cohort_metrics"].includes(table), "period-based video tables must not be read");
    let ids: string[] = []; let day = ""; let selection = "";
    const filters = new Map<string, unknown>();
    const query: any = {
      select(value: string) { selection = value; state.selections.push(value); return query; },
      in(_column: string, value: string[]) { ids = value; return query; },
      eq(column: string, value: string) { filters.set(column, value); if (column === "day") day = value; return query; },
      order() { return query; },
      upsert(rows: RecentVideoCacheRow[], options: { onConflict: string }) {
        assert.ok(Array.isArray(rows));
        assert.equal(typeof options.onConflict, "string");
        const row = rows[0];
        if (state.cacheWriteFailure) return Promise.resolve({ error: new Error("cache write failed") });
        const keys = options.onConflict.split(",") as Array<keyof RecentVideoCacheRow>;
        state.cacheRows = state.cacheRows.filter((saved) => !keys.every((key) => saved[key] === row[key]));
        state.cacheRows.push({ ...row });
        return Promise.resolve({ error: null });
      },
      range() {
        if (table === "youtube_daily_video_cohort_metrics") return Promise.resolve({
          data: state.cacheRows.filter((row) => ids.includes(row.channel_id) && [...filters].every(([key, value]) => row[key as keyof RecentVideoCacheRow] === value)),
          error: state.cacheReadFailure ? new Error("cache read failed") : null
        });
        return Promise.resolve({ data: ids.map((id) => ({ channel_id: id, day, views: 120, estimated_minutes_watched: 90,
        subscribers_gained: 2, subscribers_lost: 3, ...(selection.includes("estimated_revenue") ? { estimated_revenue: 3.25 } : {}) })), error: null }); }
    };
    return query;
  } }),
  catalogFailed: () => state.catalogFailure
};
const databaseUrl = `data:text/javascript,${encodeURIComponent("export const createDatabaseAdminClient = () => globalThis.__dailyStatusFixture.database();")}`;
const catalogUrl = `data:text/javascript,${encodeURIComponent("export async function listStoredYoutubeManagedChannels() { if (globalThis.__dailyStatusFixture.catalogFailed()) throw new Error('catalog unavailable'); return globalThis.__dailyStatusFixture.channels; }")}`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/database") return { url: databaseUrl, shortCircuit: true };
  if (specifier === "@/lib/youtube-managed-channels") return { url: catalogUrl, shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
} });

const { NextRequest } = await import("next/server.js");
const { GET } = await import("../app/api/daily-status/route.ts");
const { createSessionToken } = await import("../lib/auth.ts");
const { getDailyStatusData } = await import("../lib/daily-status-data.ts");
const { createDailyStatusYoutubeFetcher } = await import("../lib/daily-status-data.ts");
const { getDailyStatusWindow } = await import("../lib/daily-status.ts");
const { fetchChannelVideosPublishedBetween } = await import("../lib/youtube-cms-api.ts");

function reset() {
  state.tables = []; state.selections = []; state.failCatalog = false; state.failAnalytics = false;
  state.missingMetadata = false; state.missingDay = false; state.reportRequests = []; state.playlistPages = []; state.oauthCalls = 0; state.catalogFailure = false;
  state.cacheRows = []; state.cacheReadFailure = false; state.cacheWriteFailure = false;
}

test("real route and service enforce auth, access, exact-day queries, pagination and revenue rules", async (t) => {
  const previousEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.DASHBOARD_BASIC_USER = "admin";
  process.env.DASHBOARD_BASIC_PASSWORD = "test-admin-password";
  process.env.CHANNEL_PULSE_SESSION_SECRET = "test-session-secret";
  process.env.CHANNEL_PULSE_ACCOUNTS = JSON.stringify([
    { username: "viewer", password: "viewer-password", role: "user", channels: ["UCa"] },
    { username: "restricted", password: "restricted-password", role: "admin_no_revenue", channels: "all" }
  ]);
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.YOUTUBE_DIRECT_CHANNEL_IDS = "UCa,UCb";
  process.env.YOUTUBE_DIRECT_REFRESH_TOKEN = "test-refresh";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.hostname === "oauth2.googleapis.com") { state.oauthCalls++; return json({ access_token: "test-access" }); }
    if (url.pathname.endsWith("/channels")) {
      if (url.searchParams.has("onBehalfOfContentOwner")) return json({ items: [{ id: url.searchParams.get("onBehalfOfContentOwner") === "owner-two" ? "UCa" : "UCother", snippet: { title: "CMS channel" } }] });
      return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "uploads" } } }] });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      if (state.failCatalog) return json({ error: "quota" }, 403);
      const page = url.searchParams.get("pageToken") ?? "first";
      state.playlistPages.push(page);
      // An old upload precedes a later page containing a qualifying scheduled publication.
      return json(page === "first" ? { nextPageToken: "second", items: [
        { contentDetails: { videoId: "start", videoPublishedAt: "2026-08-18T18:30:00Z" } },
        { contentDetails: { videoId: "old", videoPublishedAt: "2026-01-01T00:00:00Z" } }
      ] } : { items: [
        { contentDetails: { videoId: "last", videoPublishedAt: "2026-10-19T18:29:59Z" } },
        { contentDetails: { videoId: "future", videoPublishedAt: "2026-10-19T18:30:00Z" } }
      ] });
    }
    if (url.pathname.endsWith("/videos")) return json({ items: (url.searchParams.get("id") ?? "").split(",").filter((id) => !state.missingMetadata || id !== "last").map((id) => ({
      id, snippet: { channelId: "UCa", title: id, publishedAt: id === "start" ? "2026-08-18T18:30:00Z" : "2026-10-19T18:29:59Z" }, contentDetails: { duration: "PT5M" }, statistics: { viewCount: "999999" }, status: { privacyStatus: "public" }
    })) });
    if (url.hostname === "youtubeanalytics.googleapis.com") {
      state.reportRequests.push(url);
      if (state.failAnalytics) return json({ error: "quota" }, 403);
      const day = url.searchParams.get("startDate");
      if (url.searchParams.get("metrics") === "estimatedRevenue") return json({ columnHeaders: [{ name: "day" }, { name: "estimatedRevenue" }], rows: state.missingDay ? [] : [[day, 1.75]] });
      return json({ columnHeaders: [{ name: "day" }, { name: "views" }, { name: "estimatedMinutesWatched" }], rows: state.missingDay ? [] : [[day, 12, 90]] });
    }
    throw new Error(`Unexpected request: ${url.hostname}${url.pathname}`);
  };
  const request = async (username?: string, query = `date=${state.date}&channel=UCa&refresh=1`) => {
    const token = username ? await createSessionToken(username) : undefined;
    return GET(new NextRequest(`http://localhost/api/daily-status?${query}`, { headers: token ? { cookie: `channel_pulse_session=${token}` } : {} }));
  };
  try {
    await t.test("normal dashboard requests return stored or missing results without Google calls", async () => {
      reset();
      const missing = await (await request("admin", `date=${state.date}&channel=UCa`)).json();
      assert.equal(missing.rows[0].recentVideos.status, "missing");
      assert.equal(state.oauthCalls, 0);
      await request("admin");
      const fetchedCalls = state.oauthCalls;
      state.cacheRows[0].fetched_at = "2026-01-01T00:00:00.000Z";
      const stored = await (await request("admin", `date=${state.date}&channel=UCa`)).json();
      assert.equal(stored.rows[0].recentVideos.values.estimatedRevenue, 1.75);
      assert.equal(state.oauthCalls, fetchedCalls);
    });
    await t.test("a ten-day worker context reuses channel tokens and one complete upload scan across dates", async () => {
      reset();
      const oldest = getDailyStatusWindow("2026-10-18");
      const newest = getDailyStatusWindow("2026-10-19");
      const recentFetcher = createDailyStatusYoutubeFetcher({ ...oldest, endDate: newest.endDate, endDateTime: newest.endDateTime });
      for (const date of ["2026-10-18", "2026-10-19"]) {
        const data = await getDailyStatusData({ date, channels: [{ channelId: "UCa", title: "A" }], canViewRevenue: true, forceRefresh: true, recentFetcher });
        assert.equal(data.rows[0].recentVideos.values?.estimatedRevenue, 1.75);
      }
      assert.equal(state.oauthCalls, 1);
      assert.deepEqual(state.playlistPages, ["first", "second"]);
      assert.equal(state.cacheRows.length, 2);
    });
    await t.test("range refresh requests share an upload scan across separate HTTP requests", async () => {
      reset();
      for (const date of ["2026-10-18", "2026-10-19"]) {
        const response = await request("admin", `date=${date}&channel=UCa&refresh=1&rangeStart=2026-10-18&rangeEnd=2026-10-19`);
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.rows[0].recentVideos.values.estimatedRevenue, 1.75);
      }
      assert.equal(state.oauthCalls, 1);
      assert.deepEqual(state.playlistPages, ["first", "second"]);
      assert.equal(state.cacheRows.length, 2);
      assert.equal((await request("admin", `date=${state.date}&channel=UCa&rangeStart=bad&rangeEnd=2026-10-19`)).status, 400);
      assert.equal((await request("admin", `date=${state.date}&channel=UCa&rangeStart=2026-10-20&rangeEnd=2026-10-21`)).status, 400);
    });
    await t.test("unauthenticated and invalid requests are rejected before loading analytics", async () => {
      reset();
      assert.equal((await request()).status, 401);
      assert.equal((await request("viewer", `date=${state.date}&channel=UCb`)).status, 400);
      assert.equal((await request("admin", "date=2026-02-30&channel=UCa")).status, 400);
      assert.equal((await request("admin", "date=2099-01-01&channel=UCa")).status, 400);
      assert.equal((await request("admin", `date=${state.date}`)).status, 400);
      assert.equal((await request("admin", `date=${state.date}&channel=UCa&refresh=bad`)).status, 400);
      assert.equal(state.oauthCalls, 0);
      assert.equal(state.tables.length, 0);
    });
    await t.test("daily results use exact boundaries and read no monthly video rows", async () => {
      reset();
      const response = await request("admin", `date=${state.date}&channel=UCa&channel=UCa&refresh=1`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const data = await response.json();
      assert.equal(data.rows.length, 1);
      assert.deepEqual(data.totals.allVideos.values, { views: 120, watchHours: 1.5, netSubscribers: -1, estimatedRevenue: 3.25 });
      assert.deepEqual(data.totals.recentVideos.values, { views: 12, watchHours: 1.5, videoCount: 2, estimatedRevenue: 1.75 });
      assert.deepEqual(state.playlistPages, ["first", "second"]);
      assert.equal(state.reportRequests.length, 4);
      for (const url of state.reportRequests) {
        assert.equal(url.searchParams.get("startDate"), state.date);
        assert.equal(url.searchParams.get("endDate"), state.date);
        assert.equal(url.searchParams.get("dimensions"), "day");
      }
      assert.equal(state.reportRequests[1].searchParams.get("filters"), "video==start,last");
    });
    await t.test("viewer and restricted admin payloads and DB projections exclude revenue", async () => {
      for (const account of ["viewer", "restricted"]) {
        reset();
        const response = await request(account);
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /estimatedRevenue|estimated_revenue/);
        assert.ok(state.selections.filter((selection) => selection.includes("subscribers_gained")).every((selection) => !selection.includes("revenue")));
      }
    });
    await t.test("catalog and upstream failures leave channel totals usable", async () => {
      for (const failure of ["failCatalog", "failAnalytics", "missingMetadata", "missingDay"] as const) {
        reset(); state[failure] = true;
        const data = await (await request("admin")).json();
        assert.equal(data.totals.allVideos.values.views, 120);
        assert.equal(data.totals.recentVideos.values, null);
        assert.notEqual(data.rows[0].recentVideos.status, "available");
        assert.doesNotMatch(JSON.stringify(data), /test-access|test-refresh|quota/);
      }
    });
    await t.test("duplicate in-flight requests share work, later visits read persisted results, and explicit refresh fetches anew", async () => {
      reset();
      const input = { date: state.date, channels: [{ channelId: "UCa", title: "A" }], canViewRevenue: false, forceRefresh: true };
      const first = getDailyStatusData(input);
      const second = getDailyStatusData(input);
      assert.equal(first, second);
      await Promise.all([first, second]);
      assert.equal(state.oauthCalls, 1);
      assert.equal(state.cacheRows.length, 1);
      const saved = await getDailyStatusData({ ...input, forceRefresh: false });
      assert.equal(saved.rows[0].recentVideos.source, "cache");
      assert.equal(state.oauthCalls, 1);
      await getDailyStatusData({ ...input, forceRefresh: true });
      assert.equal(state.oauthCalls, 2);
    });
    await t.test("cache is reused across permitted accounts without exposing revenue or unauthorized channels", async () => {
      reset();
      await request("admin");
      assert.equal(state.oauthCalls, 1);
      const response = await request("viewer", `date=${state.date}&channel=UCa`);
      const data = await response.json();
      assert.equal(data.rows[0].recentVideos.source, "cache");
      assert.equal(data.rows.length, 1);
      assert.doesNotMatch(JSON.stringify(data), /revenue/i);
      assert.equal(state.oauthCalls, 1);
      assert.equal((await request("viewer", `date=${state.date}&channel=UCb`)).status, 400);
      await request("viewer", `date=${state.date}&channel=UCa&refresh=1`);
      assert.equal(state.oauthCalls, 2);
    });
    await t.test("expired results survive upstream failure and cache persistence errors are visible", async () => {
      reset();
      await request("admin");
      const row = state.cacheRows[0];
      row.fetched_at = "2026-01-01T00:00:00.000Z";
      state.failAnalytics = true;
      const data = await (await request("admin")).json();
      assert.equal(data.rows[0].recentVideos.source, "cache");
      assert.equal(data.rows[0].recentVideos.stale, true);
      assert.equal(data.totals.recentVideos.values.views, 12);
      assert.match(data.totals.recentVideos.message, /refresh failed/);
      assert.equal(state.cacheRows[0].fetched_at, "2026-01-01T00:00:00.000Z");
      reset(); state.cacheReadFailure = true; state.cacheWriteFailure = true;
      const unsaved = await (await request("admin")).json();
      assert.equal(unsaved.rows[0].recentVideos.values.views, 12);
      assert.match(unsaved.totals.recentVideos.cacheWarning, /Could not save/);
      assert.equal(state.cacheRows.length, 0);
    });
    await t.test("complete-catalog behavior is opt-in for existing callers", async () => {
      reset();
      await fetchChannelVideosPublishedBetween({ accessToken: "test-access", channelId: "UCa", startDate: "2026-08-19", endDate: "2026-10-20" });
      assert.deepEqual(state.playlistPages, ["first"]);
    });
    await t.test("CMS channels select the matching content owner and supported filter combinations", async () => {
      reset();
      process.env.YOUTUBE_DIRECT_CHANNEL_IDS = "UCb";
      process.env.YOUTUBE_CONTENT_OWNER_ID = "owner-one,owner-two";
      process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "test-cms-refresh";
      try {
        const data = await (await request("admin")).json();
        assert.equal(data.rows[0].recentVideos.status, "available");
        assert.equal(state.oauthCalls, 1);
        assert.equal(state.reportRequests.length, 4);
        for (const url of state.reportRequests) assert.equal(url.searchParams.get("ids"), "contentOwner==owner-two");
        assert.equal(state.reportRequests[0].searchParams.get("filters"), "channel==UCa");
        assert.equal(state.reportRequests[1].searchParams.get("filters"), "video==start,last");
      } finally { process.env.YOUTUBE_DIRECT_CHANNEL_IDS = "UCa,UCb"; }
    });
    await t.test("channel-catalog failure gives a retryable API error", async () => {
      reset(); state.catalogFailure = true;
      assert.equal((await request("admin")).status, 502);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    delete (globalThis as any).__dailyStatusFixture;
  }
});
