-- ============================================================
-- YouTube CMS Performance Dashboard Schema
-- ============================================================

create table if not exists public.youtube_managed_channels (
  channel_id       text primary key,
  title            text not null,
  custom_url       text,
  thumbnail_url    text,
  subscriber_count bigint,
  view_count       bigint,
  video_count      bigint,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.youtube_video_catalog (
  video_id         text primary key,
  channel_id       text not null references public.youtube_managed_channels(channel_id) on delete cascade,
  title            text not null,
  description      text,
  thumbnail_url    text,
  published_at     timestamptz,
  duration_seconds integer,
  content_type     text not null default 'unknown'
    check (content_type in ('short', 'long', 'live', 'unknown')),
  view_count       bigint,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.youtube_channel_daily_metrics (
  day                       date not null,
  channel_id                text not null references public.youtube_managed_channels(channel_id) on delete cascade,
  views                     bigint not null default 0,
  estimated_minutes_watched numeric(16,2) not null default 0,
  subscribers_gained        bigint not null default 0,
  subscribers_lost          bigint not null default 0,
  subscribers_net           bigint generated always as (subscribers_gained - subscribers_lost) stored,
  estimated_revenue         numeric(16,4) not null default 0,
  estimated_ad_revenue      numeric(16,4) not null default 0,
  gross_revenue             numeric(16,4) not null default 0,
  monetized_playbacks       bigint not null default 0,
  ad_impressions            bigint not null default 0,
  playback_based_cpm        numeric(16,4) not null default 0,
  impressions_click_through_rate numeric(10,6),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  primary key (day, channel_id)
);

create table if not exists public.youtube_video_daily_metrics (
  day                       date not null,
  channel_id                text not null references public.youtube_managed_channels(channel_id) on delete cascade,
  video_id                  text not null references public.youtube_video_catalog(video_id) on delete cascade,
  views                     bigint not null default 0,
  estimated_minutes_watched numeric(16,2) not null default 0,
  estimated_revenue         numeric(16,4) not null default 0,
  estimated_ad_revenue      numeric(16,4) not null default 0,
  gross_revenue             numeric(16,4) not null default 0,
  monetized_playbacks       bigint not null default 0,
  ad_impressions            bigint not null default 0,
  playback_based_cpm        numeric(16,4) not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  primary key (day, video_id)
);

create table if not exists public.youtube_content_type_daily_metrics (
  day                       date not null,
  channel_id                text not null references public.youtube_managed_channels(channel_id) on delete cascade,
  content_type              text not null
    check (content_type in ('short', 'long', 'live', 'unknown')),
  views                     bigint not null default 0,
  estimated_minutes_watched numeric(16,2) not null default 0,
  estimated_revenue         numeric(16,4) not null default 0,
  estimated_ad_revenue      numeric(16,4) not null default 0,
  gross_revenue             numeric(16,4) not null default 0,
  monetized_playbacks       bigint not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  primary key (day, channel_id, content_type)
);

create table if not exists public.youtube_country_daily_metrics (
  day                       date not null,
  channel_id                text not null references public.youtube_managed_channels(channel_id) on delete cascade,
  country_code              text not null,
  views                     bigint not null default 0,
  estimated_minutes_watched numeric(16,2) not null default 0,
  estimated_revenue         numeric(16,4) not null default 0,
  estimated_ad_revenue      numeric(16,4) not null default 0,
  gross_revenue             numeric(16,4) not null default 0,
  monetized_playbacks       bigint not null default 0,
  ad_impressions            bigint not null default 0,
  playback_based_cpm        numeric(16,4) not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  primary key (day, channel_id, country_code)
);

create table if not exists public.youtube_analytics_sync_runs (
  id                  uuid primary key default gen_random_uuid(),
  sync_type           text not null default 'daily'
    check (sync_type in ('daily', 'backfill', 'manual')),
  status              text not null
    check (status in ('running', 'success', 'failed')),
  start_date          date not null,
  end_date            date not null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  channels_synced     integer not null default 0,
  videos_synced       integer not null default 0,
  metrics_rows_synced integer not null default 0,
  error_message       text,
  metadata            jsonb not null default '{}'::jsonb
);

create table if not exists public.youtube_monthly_channel_targets (
  month                  text not null check (month ~ '^\d{4}-\d{2}$'),
  channel_id             text not null references public.youtube_managed_channels(channel_id) on delete cascade,
  short_views_target     bigint check (short_views_target is null or short_views_target >= 0),
  long_views_target      bigint check (long_views_target is null or long_views_target >= 0),
  short_videos_target    bigint check (short_videos_target is null or short_videos_target >= 0),
  long_videos_target     bigint check (long_videos_target is null or long_videos_target >= 0),
  watch_hours_target     numeric(16,1) check (watch_hours_target is null or watch_hours_target >= 0),
  net_subscribers_target bigint check (net_subscribers_target is null or net_subscribers_target >= 0),
  created_by             text,
  updated_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (month, channel_id)
);

create index if not exists youtube_video_catalog_channel_idx
  on public.youtube_video_catalog (channel_id, published_at desc);
create index if not exists youtube_video_catalog_content_type_idx
  on public.youtube_video_catalog (content_type);
create index if not exists youtube_channel_daily_metrics_day_idx
  on public.youtube_channel_daily_metrics (day desc);
create index if not exists youtube_channel_daily_metrics_channel_day_idx
  on public.youtube_channel_daily_metrics (channel_id, day desc);
create index if not exists youtube_video_daily_metrics_day_idx
  on public.youtube_video_daily_metrics (day desc);
create index if not exists youtube_video_daily_metrics_channel_day_idx
  on public.youtube_video_daily_metrics (channel_id, day desc);
create index if not exists youtube_video_daily_metrics_video_day_idx
  on public.youtube_video_daily_metrics (video_id, day desc);
create index if not exists youtube_content_type_daily_metrics_day_idx
  on public.youtube_content_type_daily_metrics (day desc);
create index if not exists youtube_country_daily_metrics_day_idx
  on public.youtube_country_daily_metrics (day desc);
create index if not exists youtube_country_daily_metrics_channel_day_idx
  on public.youtube_country_daily_metrics (channel_id, day desc);
create index if not exists youtube_country_daily_metrics_revenue_idx
  on public.youtube_country_daily_metrics (channel_id, estimated_revenue desc);
create index if not exists youtube_analytics_sync_runs_started_idx
  on public.youtube_analytics_sync_runs (started_at desc);
create index if not exists youtube_monthly_channel_targets_channel_idx
  on public.youtube_monthly_channel_targets (channel_id, month desc);

alter table public.youtube_managed_channels             enable row level security;
alter table public.youtube_video_catalog                enable row level security;
alter table public.youtube_channel_daily_metrics        enable row level security;
alter table public.youtube_video_daily_metrics          enable row level security;
alter table public.youtube_content_type_daily_metrics   enable row level security;
alter table public.youtube_country_daily_metrics        enable row level security;
alter table public.youtube_analytics_sync_runs          enable row level security;
alter table public.youtube_monthly_channel_targets      enable row level security;
