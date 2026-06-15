#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@libsql/client/web";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

if (!process.env.TURSO_DATABASE_URL) {
  console.error("Missing environment variable: TURSO_DATABASE_URL");
  process.exit(1);
}

const turso = createClient({
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: "number",
  url: process.env.TURSO_DATABASE_URL
});

try {
  const schemaPath = join(ROOT_DIR, "database", "turso-channel-pulse-schema.sql");
  const schema = await readFile(schemaPath, "utf8");
  await turso.executeMultiple(schema);
  console.log("Turso schema applied.");
} finally {
  turso.close();
}
