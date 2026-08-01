import assert from "node:assert/strict";
import test from "node:test";

import { filterFocusedYouTubeChannels } from "../lib/youtube-channel-allowlist.ts";
import {
  getDirectYoutubeChannelIds,
  getYouTubeDirectConfig,
  isDirectYoutubeChannel,
  isYouTubeDirectConfigured
} from "../lib/youtube-channel-sources.ts";

test("parses and deduplicates the fixed direct-channel allowlist", () => {
  withDirectEnvironment(() => {
    process.env.YOUTUBE_DIRECT_CHANNEL_IDS = " UC_DIRECT_1,UC_DIRECT_2,UC_DIRECT_1 ";

    assert.deepEqual(getDirectYoutubeChannelIds(), ["UC_DIRECT_1", "UC_DIRECT_2"]);
    assert.equal(isDirectYoutubeChannel("UC_DIRECT_2"), true);
    assert.equal(isDirectYoutubeChannel("UC_OTHER"), false);
  });
});

test("builds channel-level analytics configuration from one direct OAuth identity", () => {
  withDirectEnvironment(() => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.YOUTUBE_DIRECT_REFRESH_TOKEN = "refresh-token";
    process.env.YOUTUBE_DIRECT_CHANNEL_IDS = "UC_DIRECT_1,UC_DIRECT_2";

    assert.equal(isYouTubeDirectConfigured(), true);
    assert.deepEqual(getYouTubeDirectConfig("UC_DIRECT_2"), {
      analyticsFilters: "",
      analyticsIds: "channel==UC_DIRECT_2",
      clientId: "client-id",
      clientSecret: "client-secret",
      contentOwnerIds: [],
      refreshToken: "refresh-token",
      sourceType: "direct"
    });
    assert.throws(() => getYouTubeDirectConfig("UC_OTHER"), /not in YOUTUBE_DIRECT_CHANNEL_IDS/);
  });
});

test("reuses the existing OAuth refresh token for direct channels", () => {
  withDirectEnvironment(() => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "shared-refresh-token";
    process.env.YOUTUBE_DIRECT_CHANNEL_IDS = "UC_DIRECT_1";

    assert.equal(isYouTubeDirectConfigured(), true);
    assert.equal(getYouTubeDirectConfig("UC_DIRECT_1").refreshToken, "shared-refresh-token");
  });
});

test("uses a channel-specific refresh token before the shared token", () => {
  withDirectEnvironment(() => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "shared-refresh-token";
    process.env.YOUTUBE_DIRECT_CHANNEL_IDS = "UC_DIRECT_1,UC_DIRECT_2";
    process.env.YOUTUBE_DIRECT_CHANNEL_REFRESH_TOKENS = JSON.stringify({
      UC_DIRECT_1: "channel-one-token",
      UC_DIRECT_2: "channel-two-token"
    });

    assert.equal(getYouTubeDirectConfig("UC_DIRECT_1").refreshToken, "channel-one-token");
    assert.equal(getYouTubeDirectConfig("UC_DIRECT_2").refreshToken, "channel-two-token");
  });
});

test("includes configured direct channels after the focused CMS channels", () => {
  withDirectEnvironment(() => {
    process.env.YOUTUBE_DIRECT_CHANNEL_IDS = "UC_DIRECT_2,UC_DIRECT_1";
    const channels = [
      { channelId: "UC_DIRECT_1", title: "Direct One" },
      { channelId: "UCXjhJbviBl0M4JAC3cxDXqA", title: "TeluguOne" },
      { channelId: "UC_DIRECT_2", title: "Direct Two" },
      { channelId: "UC_OTHER", title: "Other" }
    ];

    assert.deepEqual(
      filterFocusedYouTubeChannels(channels).map((channel) => channel.channelId),
      ["UCXjhJbviBl0M4JAC3cxDXqA", "UC_DIRECT_2", "UC_DIRECT_1"]
    );
  });
});

function withDirectEnvironment(callback: () => void) {
  const names = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "YOUTUBE_DIRECT_CHANNEL_IDS",
    "YOUTUBE_DIRECT_CHANNEL_REFRESH_TOKENS",
    "YOUTUBE_DIRECT_REFRESH_TOKEN",
    "YOUTUBE_OAUTH_REFRESH_TOKEN"
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  try {
    for (const name of names) delete process.env[name];
    callback();
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
