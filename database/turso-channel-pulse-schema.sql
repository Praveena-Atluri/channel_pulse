-- ============================================================
-- Channel Pulse Turso/libSQL Schema
-- ============================================================
-- Run this with the Turso SQL shell, or let the migration script apply it.

pragma foreign_keys = on;

create table if not exists youtube_managed_channels (
  channel_id       text primary key,
  title            text not null,
  custom_url       text,
  thumbnail_url    text,
  subscriber_count integer,
  view_count       integer,
  video_count      integer,
  last_synced_at   text,
  created_at       text not null default (datetime('now')),
  updated_at       text not null default (datetime('now'))
);

create table if not exists youtube_video_catalog (
  video_id         text primary key,
  channel_id       text not null references youtube_managed_channels(channel_id) on delete cascade,
  title            text not null,
  description      text,
  thumbnail_url    text,
  published_at     text,
  duration_seconds integer,
  content_type     text not null default 'unknown'
    check (content_type in ('short', 'long', 'live', 'unknown')),
  view_count       integer,
  last_synced_at   text,
  created_at       text not null default (datetime('now')),
  updated_at       text not null default (datetime('now'))
);

create table if not exists youtube_channel_daily_metrics (
  day                       text not null,
  channel_id                text not null references youtube_managed_channels(channel_id) on delete cascade,
  views                     integer not null default 0,
  estimated_minutes_watched real not null default 0,
  subscribers_gained        integer not null default 0,
  subscribers_lost          integer not null default 0,
  subscribers_net           integer generated always as (subscribers_gained - subscribers_lost) stored,
  estimated_revenue         real not null default 0,
  estimated_ad_revenue      real not null default 0,
  gross_revenue             real not null default 0,
  monetized_playbacks       integer not null default 0,
  ad_impressions            integer not null default 0,
  playback_based_cpm        real not null default 0,
  impressions_click_through_rate real,
  created_at                text not null default (datetime('now')),
  updated_at                text not null default (datetime('now')),
  primary key (day, channel_id)
);

create table if not exists youtube_video_daily_metrics (
  day                       text not null,
  channel_id                text not null references youtube_managed_channels(channel_id) on delete cascade,
  video_id                  text not null references youtube_video_catalog(video_id) on delete cascade,
  views                     integer not null default 0,
  estimated_minutes_watched real not null default 0,
  estimated_revenue         real not null default 0,
  estimated_ad_revenue      real not null default 0,
  gross_revenue             real not null default 0,
  monetized_playbacks       integer not null default 0,
  ad_impressions            integer not null default 0,
  playback_based_cpm        real not null default 0,
  created_at                text not null default (datetime('now')),
  updated_at                text not null default (datetime('now')),
  primary key (day, video_id)
);

create table if not exists youtube_content_type_daily_metrics (
  day                       text not null,
  channel_id                text not null references youtube_managed_channels(channel_id) on delete cascade,
  content_type              text not null
    check (content_type in ('short', 'long', 'live', 'unknown')),
  views                     integer not null default 0,
  estimated_minutes_watched real not null default 0,
  estimated_revenue         real not null default 0,
  estimated_ad_revenue      real not null default 0,
  gross_revenue             real not null default 0,
  monetized_playbacks       integer not null default 0,
  created_at                text not null default (datetime('now')),
  updated_at                text not null default (datetime('now')),
  primary key (day, channel_id, content_type)
);

create table if not exists youtube_country_daily_metrics (
  day                       text not null,
  channel_id                text not null references youtube_managed_channels(channel_id) on delete cascade,
  country_code              text not null,
  views                     integer not null default 0,
  estimated_minutes_watched real not null default 0,
  estimated_revenue         real not null default 0,
  estimated_ad_revenue      real not null default 0,
  gross_revenue             real not null default 0,
  monetized_playbacks       integer not null default 0,
  ad_impressions            integer not null default 0,
  playback_based_cpm        real not null default 0,
  created_at                text not null default (datetime('now')),
  updated_at                text not null default (datetime('now')),
  primary key (day, channel_id, country_code)
);

create table if not exists youtube_analytics_sync_runs (
  id                  text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  sync_type           text not null default 'daily'
    check (sync_type in ('daily', 'backfill', 'manual')),
  status              text not null
    check (status in ('running', 'success', 'failed')),
  start_date          text not null,
  end_date            text not null,
  started_at          text not null default (datetime('now')),
  finished_at         text,
  channels_synced     integer not null default 0,
  videos_synced       integer not null default 0,
  metrics_rows_synced integer not null default 0,
  error_message       text,
  metadata            text not null default '{}'
);

create table if not exists youtube_monthly_channel_targets (
  month                  text not null check (length(month) = 7),
  channel_id             text not null references youtube_managed_channels(channel_id) on delete cascade,
  short_views_target     integer check (short_views_target is null or short_views_target >= 0),
  long_views_target      integer check (long_views_target is null or long_views_target >= 0),
  short_videos_target    integer check (short_videos_target is null or short_videos_target >= 0),
  long_videos_target     integer check (long_videos_target is null or long_videos_target >= 0),
  watch_hours_target     real check (watch_hours_target is null or watch_hours_target >= 0),
  net_subscribers_target integer check (net_subscribers_target is null or net_subscribers_target >= 0),
  created_by             text,
  updated_by             text,
  created_at             text not null default (datetime('now')),
  updated_at             text not null default (datetime('now')),
  primary key (month, channel_id)
);

create index if not exists youtube_video_catalog_channel_idx
  on youtube_video_catalog (channel_id, published_at desc);
create index if not exists youtube_video_catalog_content_type_idx
  on youtube_video_catalog (content_type);
create index if not exists youtube_channel_daily_metrics_day_idx
  on youtube_channel_daily_metrics (day desc);
create index if not exists youtube_channel_daily_metrics_channel_day_idx
  on youtube_channel_daily_metrics (channel_id, day desc);
create index if not exists youtube_video_daily_metrics_day_idx
  on youtube_video_daily_metrics (day desc);
create index if not exists youtube_video_daily_metrics_channel_day_idx
  on youtube_video_daily_metrics (channel_id, day desc);
create index if not exists youtube_video_daily_metrics_video_day_idx
  on youtube_video_daily_metrics (video_id, day desc);
create index if not exists youtube_content_type_daily_metrics_day_idx
  on youtube_content_type_daily_metrics (day desc);
create index if not exists youtube_country_daily_metrics_day_idx
  on youtube_country_daily_metrics (day desc);
create index if not exists youtube_country_daily_metrics_channel_day_idx
  on youtube_country_daily_metrics (channel_id, day desc);
create index if not exists youtube_country_daily_metrics_revenue_idx
  on youtube_country_daily_metrics (channel_id, estimated_revenue desc);
create index if not exists youtube_analytics_sync_runs_started_idx
  on youtube_analytics_sync_runs (started_at desc);
create index if not exists youtube_monthly_channel_targets_channel_idx
  on youtube_monthly_channel_targets (channel_id, month desc);
