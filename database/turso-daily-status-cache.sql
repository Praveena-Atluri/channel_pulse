-- Successful single-day analytics for the rolling two-month publication cohort.
-- Separate from youtube_video_daily_metrics, which contains period aggregates.
create table if not exists youtube_daily_recent_video_cache (
  channel_id             text not null references youtube_managed_channels(channel_id) on delete cascade,
  day                    text not null,
  publication_start_date text not null,
  publication_end_date   text not null,
  algorithm_version      integer not null,
  views                  integer not null check (views >= 0),
  watch_hours            real not null check (watch_hours >= 0),
  video_count            integer not null check (video_count >= 0),
  fetched_at             text not null,
  primary key (channel_id, day, publication_start_date, publication_end_date, algorithm_version)
);

create index if not exists youtube_daily_recent_video_cache_day_idx
  on youtube_daily_recent_video_cache (day, algorithm_version, channel_id);

-- Durable reporting dataset. Existing successful cache rows are retained below.
create table if not exists youtube_daily_video_cohort_metrics (
  channel_id             text not null references youtube_managed_channels(channel_id) on delete cascade,
  day                    text not null,
  publication_start_date text not null,
  publication_end_date   text not null,
  algorithm_version      integer not null,
  views                  integer not null check (views >= 0),
  watch_hours            real not null check (watch_hours >= 0),
  video_count            integer not null check (video_count >= 0),
  fetched_at             text not null,
  estimated_revenue      real,
  revenue_fetched_at     text,
  primary key (channel_id, day, publication_start_date, publication_end_date, algorithm_version)
);
create index if not exists youtube_daily_video_cohort_metrics_day_idx
  on youtube_daily_video_cohort_metrics (day, algorithm_version, channel_id);
insert or ignore into youtube_daily_video_cohort_metrics
  (channel_id,day,publication_start_date,publication_end_date,algorithm_version,views,watch_hours,video_count,fetched_at)
select channel_id,day,publication_start_date,publication_end_date,algorithm_version,views,watch_hours,video_count,fetched_at
from youtube_daily_recent_video_cache;

create table if not exists youtube_daily_status_refresh_state (
  job_key text primary key,
  lease_owner text,
  lease_until text,
  next_run_at text,
  last_started_at text,
  last_finished_at text,
  last_status text
);
create table if not exists youtube_daily_status_refresh_runs (
  run_id text primary key,
  started_at text not null,
  finished_at text,
  start_date text not null,
  end_date text not null,
  channel_count integer not null,
  status text not null,
  stored_days integer not null default 0,
  pending_days integer not null default 0,
  failed_days integer not null default 0
);
