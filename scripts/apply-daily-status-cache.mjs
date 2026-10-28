import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client/web";

if (!process.env.TURSO_DATABASE_URL) throw new Error("Missing environment variable: TURSO_DATABASE_URL");
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  const schema = await readFile(new URL("../database/turso-daily-status-cache.sql", import.meta.url), "utf8");
  await db.executeMultiple(schema);
  console.log("Daily Status reporting dataset and background job tables are ready. Existing successful cache rows were preserved.");
} catch {
  console.error("Could not initialize Daily Status cache table. Check database connectivity and schema permissions.");
  process.exitCode = 1;
} finally { db.close(); }
