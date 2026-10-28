import { Agent, setGlobalDispatcher } from "undici";
setGlobalDispatcher(new Agent({ connect: { timeout: 60_000 } }));
import { createClient } from '@libsql/client/http';
const sql = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const timer = setTimeout(() => { console.error('Database coverage query timed out.'); process.exit(1); }, 90000);
try {
  const args = ['2026-10-01', '2026-10-24'];
  const results = await sql.batch([
    { sql: 'select day,count(distinct channel_id) as channels,count(estimated_revenue) as channels_with_revenue from youtube_daily_video_cohort_metrics where day>=? and day<=? and algorithm_version=1 group by day order by day', args },
    { sql: 'select c.title,count(distinct m.day) as saved_days,count(m.estimated_revenue) as days_with_revenue,min(m.day) as first_day,max(m.day) as last_day from youtube_managed_channels c left join youtube_daily_video_cohort_metrics m on c.channel_id=m.channel_id and m.day>=? and m.day<=? and m.algorithm_version=1 group by c.channel_id,c.title having count(m.day)>0 order by c.title', args },
    { sql: 'select day,count(distinct channel_id) as channels,count(estimated_revenue) as channels_with_revenue from youtube_channel_daily_metrics where day>=? and day<=? group by day order by day', args },
    { sql: 'select started_at,finished_at,status,stored_days,pending_days,failed_days from youtube_daily_status_refresh_runs where start_date=? and end_date=? order by started_at desc limit 1', args }
  ], 'read');
  console.log(JSON.stringify({ totals: { activity: results[0].rows.reduce((n,r)=>n+Number(r.channels),0), revenue: results[0].rows.reduce((n,r)=>n+Number(r.channels_with_revenue),0) }, recentVideoDates: results[0].rows, recentVideoChannels: results[1].rows, allVideoDates: results[2].rows, latestRun: results[3].rows }, null, 2));
} finally { clearTimeout(timer); sql.close(); }
