export const FOCUSED_YOUTUBE_CHANNELS = [
  { title: "TeluguOne", channelId: "UCXjhJbviBl0M4JAC3cxDXqA" },
  { title: "Old Songs Telugu", channelId: "UCEII-OnIwBOdyTpvYcAjEIA" },
  { title: "Navvula TV", channelId: "UCzVPlhwpWSrvTuGJ9-BP8vA" },
  { title: "TeluguOne Music", channelId: "UCbaXz-cMRa1Kx6gNmEQgJoQ" },
  { title: "Tone News", channelId: "UCEOx1MOSAw9k0vix1Ay4Ehw" },
  { title: "BhaktiOne", channelId: "UChOHAoVKJ3coNFomdN-evBA" },
  { title: "TeluguOne Cinema", channelId: "UClil81xNKxtTCdRmLs5qB_g" },
  { title: "Tone Academy", channelId: "UCHtsA_T0_R9TW9oFI3I6qBA" },
  { title: "TeluguOne Health", channelId: "UCVFfR4eOjEdcj1ic1N21CDw" },
  { title: "Tone Agri", channelId: "UCPu0e0aMOqFSHQ94abhpUfw" },
  { title: "TeluguOne Originals", channelId: "UC3G6CyzDjtFofutzyjpRCew" },
  { title: "TeluguOne Food", channelId: "UCkld6KqjsC8mkfoP15sZCvw" },
  { title: "Tone Fashion", channelId: "UCv6uNOhfhOa9agcrcJppB2Q" },
  { title: "Naveena Column", channelId: "UC55glYJiK5lhOKC_xnlkSnQ" },
  { title: "KidsOne", channelId: "UCLWMXtD_61d2dpwkNUeVtgw" },
  { title: "KidsOne Hindi", channelId: "UC2J1Ytfh69Tca-4-Ur1bjaw" },
  { title: "KidsOne Telugu", channelId: "UCjCHw0Np-xswtfxQac2yiYA" },
  { title: "KidsOne Odia", channelId: "UCKG1uiWSENKa_TtCsCb75ZA" },
  { title: "KidsOne Tamil", channelId: "UCi7ahrGeHggv2izvah_CJ8g" },
  { title: "KidsOne Kannada", channelId: "UCX2lCVMxlzVrewpqOW6WNwA" },
  { title: "KidsOne Malayalam", channelId: "UCcUl07tKsYNEZn-5k491SLA" },
  { title: "KidsOne Gujarati", channelId: "UClDXFRMmqAjzuyAdcUZGcgA" },
  { title: "KidsOne Bhojpuri", channelId: "UCPAhQakmpFFbv9XgJW0rtjQ" }
] as const;

const FOCUSED_CHANNELS_BY_ID = new Map<string, { title: string; channelId: string; index: number }>(
  FOCUSED_YOUTUBE_CHANNELS.map((channel, index) => [channel.channelId, { ...channel, index }])
);

const FOCUSED_CHANNEL_TITLE_KEYS = new Set(FOCUSED_YOUTUBE_CHANNELS.map((channel) => normalizeYouTubeChannelTitle(channel.title)));

export function filterFocusedYouTubeChannels<T extends { channelId: string; title: string }>(channels: T[]) {
  const directChannelIds = getConfiguredDirectChannelIds();
  const directChannelOrder = new Map(directChannelIds.map((channelId, index) => [channelId, index]));
  return channels
    .filter((channel) => FOCUSED_CHANNELS_BY_ID.has(channel.channelId) || directChannelOrder.has(channel.channelId))
    .map((channel) => ({
      ...channel,
      title: FOCUSED_CHANNELS_BY_ID.get(channel.channelId)?.title ?? channel.title
    }))
    .sort(
      (first, second) =>
        getChannelOrder(first.channelId, directChannelOrder) - getChannelOrder(second.channelId, directChannelOrder)
    );
}

export function isFocusedYouTubeChannelId(channelId: string) {
  return FOCUSED_CHANNELS_BY_ID.has(channelId) || getConfiguredDirectChannelIds().includes(channelId);
}

export function isFocusedYouTubeChannelTitle(title: string) {
  return FOCUSED_CHANNEL_TITLE_KEYS.has(normalizeYouTubeChannelTitle(title));
}

export function normalizeYouTubeChannelTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getFocusedChannelOrder(channelId: string) {
  return FOCUSED_CHANNELS_BY_ID.get(channelId)?.index ?? Number.MAX_SAFE_INTEGER;
}

function getChannelOrder(channelId: string, directChannelOrder: Map<string, number>) {
  const focusedOrder = getFocusedChannelOrder(channelId);
  if (focusedOrder !== Number.MAX_SAFE_INTEGER) return focusedOrder;

  return FOCUSED_YOUTUBE_CHANNELS.length + (directChannelOrder.get(channelId) ?? Number.MAX_SAFE_INTEGER);
}

function getConfiguredDirectChannelIds() {
  return Array.from(
    new Set(
      (process.env.YOUTUBE_DIRECT_CHANNEL_IDS ?? "")
        .split(",")
        .map((channelId) => channelId.trim())
        .filter(Boolean)
    )
  );
}
