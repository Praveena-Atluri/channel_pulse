export type ChannelSummaryColumnId =
  | "channel"
  | "channel_id"
  | "period"
  | "views"
  | "engaged_views"
  | "engagement_rate"
  | "watch_hours"
  | "subscribers_gained"
  | "subscribers_lost"
  | "net_subscribers"
  | "revenue"
  | "estimated_ad_revenue"
  | "gross_revenue"
  | "rpm"
  | "playback_cpm"
  | "monetized_playbacks"
  | "ad_impressions"
  | "short_views"
  | "long_views"
  | "live_views"
  | "unknown_views"
  | "short_percent"
  | "long_percent"
  | "views_rank"
  | "revenue_rank"
  | "net_subscriber_rank"
  | "rpm_rank";

export type ChannelSummaryColumn = {
  id: ChannelSummaryColumnId;
  label: string;
};

export const CHANNEL_SUMMARY_COLUMNS: ChannelSummaryColumn[] = [
  { id: "channel", label: "Channel" },
  { id: "channel_id", label: "Channel ID" },
  { id: "period", label: "Period" },
  { id: "views", label: "Public Views" },
  { id: "engaged_views", label: "Engaged Views" },
  { id: "engagement_rate", label: "Engagement Rate (%)" },
  { id: "watch_hours", label: "Watch Hours" },
  { id: "subscribers_gained", label: "Subscribers Gained" },
  { id: "subscribers_lost", label: "Subscribers Lost" },
  { id: "net_subscribers", label: "Net Subscribers" },
  { id: "revenue", label: "Estimated Revenue" },
  { id: "estimated_ad_revenue", label: "Estimated Ad Revenue" },
  { id: "gross_revenue", label: "Gross Revenue" },
  { id: "rpm", label: "RPM" },
  { id: "playback_cpm", label: "Playback CPM" },
  { id: "monetized_playbacks", label: "Monetized Playbacks" },
  { id: "ad_impressions", label: "Ad Impressions" },
  { id: "short_views", label: "Short Public Views" },
  { id: "long_views", label: "Long Public Views" },
  { id: "live_views", label: "Live Public Views" },
  { id: "unknown_views", label: "Unknown Public Views" },
  { id: "short_percent", label: "Short %" },
  { id: "long_percent", label: "Long %" },
  { id: "views_rank", label: "Public Views Rank" },
  { id: "revenue_rank", label: "Revenue Rank" },
  { id: "net_subscriber_rank", label: "Net Subscriber Rank" },
  { id: "rpm_rank", label: "RPM Rank" }
];

export const CHANNEL_SUMMARY_COLUMN_IDS = CHANNEL_SUMMARY_COLUMNS.map((column) => column.id);
export const CHANNEL_SUMMARY_REVENUE_COLUMN_IDS: ChannelSummaryColumnId[] = [
  "revenue",
  "estimated_ad_revenue",
  "gross_revenue",
  "rpm",
  "playback_cpm",
  "monetized_playbacks",
  "ad_impressions",
  "revenue_rank",
  "rpm_rank"
];

export function isChannelSummaryColumnId(value: string): value is ChannelSummaryColumnId {
  return CHANNEL_SUMMARY_COLUMN_IDS.includes(value as ChannelSummaryColumnId);
}

export function isChannelSummaryRevenueColumnId(value: ChannelSummaryColumnId) {
  return CHANNEL_SUMMARY_REVENUE_COLUMN_IDS.includes(value);
}
