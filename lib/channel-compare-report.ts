export type ChannelCompareColumnId =
  | "channel"
  | "channel_id"
  | "date_ranges"
  | "views"
  | "engaged_views"
  | "engagement_rate"
  | "watch_hours"
  | "net_subscribers"
  | "estimated_revenue"
  | "rpm"
  | "playback_cpm"
  | "monetized_playbacks"
  | "ad_impressions"
  | "short_views"
  | "long_views"
  | "live_views"
  | "unknown_views";

export type ChannelCompareColumn = {
  id: ChannelCompareColumnId;
  label: string;
};

export const CHANNEL_COMPARE_COLUMNS: ChannelCompareColumn[] = [
  { id: "channel", label: "Channel" },
  { id: "channel_id", label: "Channel ID" },
  { id: "date_ranges", label: "Date Ranges" },
  { id: "views", label: "Public Views" },
  { id: "engaged_views", label: "Engaged Views" },
  { id: "engagement_rate", label: "Engagement Rate (%)" },
  { id: "watch_hours", label: "Watch Hours" },
  { id: "net_subscribers", label: "Net Subscribers" },
  { id: "estimated_revenue", label: "Estimated Revenue" },
  { id: "rpm", label: "RPM" },
  { id: "playback_cpm", label: "Playback CPM" },
  { id: "monetized_playbacks", label: "Monetized Playbacks" },
  { id: "ad_impressions", label: "Ad Impressions" },
  { id: "short_views", label: "Short Public Views" },
  { id: "long_views", label: "Long Public Views" },
  { id: "live_views", label: "Live Public Views" },
  { id: "unknown_views", label: "Unknown Public Views" }
];

export const CHANNEL_COMPARE_COLUMN_IDS = CHANNEL_COMPARE_COLUMNS.map((column) => column.id);
export const CHANNEL_COMPARE_REVENUE_COLUMN_IDS: ChannelCompareColumnId[] = [
  "estimated_revenue",
  "rpm",
  "playback_cpm",
  "monetized_playbacks",
  "ad_impressions"
];

export function isChannelCompareColumnId(value: string): value is ChannelCompareColumnId {
  return CHANNEL_COMPARE_COLUMN_IDS.includes(value as ChannelCompareColumnId);
}

export function isChannelCompareRevenueColumnId(value: ChannelCompareColumnId) {
  return CHANNEL_COMPARE_REVENUE_COLUMN_IDS.includes(value);
}
