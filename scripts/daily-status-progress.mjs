import { Agent, setGlobalDispatcher } from "undici";
setGlobalDispatcher(new Agent({ connect: { timeout: 60_000 } }));
import { createClient } from '@libsql/client/http';
const sql = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  const runs = await sql.execute("select run_id,started_at,finished_at,start_date,end_date,channel_count,status,stored_days,pending_days,failed_days from youtube_daily_status_refresh_runs order by started_at desc limit 3");
  console.log(JSON.stringify(runs.rows, null, 2));
} finally { sql.close(); }
