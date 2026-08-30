import assert from "node:assert/strict";
import test from "node:test";

import {
  FOCUSED_YOUTUBE_CHANNELS,
  filterFocusedYouTubeChannels,
  isFocusedYouTubeChannelId,
  isFocusedYouTubeChannelTitle,
  normalizeYouTubeChannelTitle
} from "../lib/youtube-channel-allowlist.ts";

test("normalizes focused YouTube channel titles", () => {
  assert.equal(normalizeYouTubeChannelTitle("TOne News"), normalizeYouTubeChannelTitle("Tone News"));
  assert.equal(isFocusedYouTubeChannelTitle("TeluguOne Music"), true);
  assert.equal(isFocusedYouTubeChannelTitle("KidsOne Hindi"), true);
  assert.equal(isFocusedYouTubeChannelId("UC2J1Ytfh69Tca-4-Ur1bjaw"), true);
  assert.equal(isFocusedYouTubeChannelId("UCXjhJbviBl0M4JAC3cxDXqA"), true);
  assert.equal(isFocusedYouTubeChannelTitle("Unrelated CMS Channel"), false);
  assert.equal(isFocusedYouTubeChannelId("UC-unrelated"), false);
});

test("filters CMS channels by stored channel IDs and uses management labels", () => {
  const channels = [
    { channelId: "UCzVPlhwpWSrvTuGJ9-BP8vA", title: "NavvulaTV - Telugu Comedy Scenes" },
    { channelId: "UCXjhJbviBl0M4JAC3cxDXqA", title: "TeluguOne" },
    { channelId: "3", title: "24 / 7 News TV" },
    { channelId: "UCEII-OnIwBOdyTpvYcAjEIA", title: "Old Telugu Songs" }
  ];

  assert.deepEqual(filterFocusedYouTubeChannels(channels).map((channel) => channel.title), [
    "TeluguOne",
    "Old Songs Telugu",
    "Navvula TV"
  ]);
  assert.equal(FOCUSED_YOUTUBE_CHANNELS.length, 23);
});

test("keeps the requested primary channel order before the unchanged KidsOne channels", () => {
  assert.deepEqual(
    FOCUSED_YOUTUBE_CHANNELS.map((channel) => channel.title),
    [
      "TeluguOne",
      "Old Songs Telugu",
      "Navvula TV",
      "TeluguOne Music",
      "Tone News",
      "BhaktiOne",
      "TeluguOne Cinema",
      "Tone Academy",
      "TeluguOne Health",
      "Tone Agri",
      "TeluguOne Originals",
      "TeluguOne Food",
      "Tone Fashion",
      "Naveena Column",
      "KidsOne",
      "KidsOne Hindi",
      "KidsOne Telugu",
      "KidsOne Odia",
      "KidsOne Tamil",
      "KidsOne Kannada",
      "KidsOne Malayalam",
      "KidsOne Gujarati",
      "KidsOne Bhojpuri"
    ]
  );
});
