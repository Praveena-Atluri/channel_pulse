import { createClient } from "@supabase/supabase-js";

import { createTursoAdminClient } from "@/lib/turso-admin-client";
import { getEnv } from "@/lib/env";

export function createSupabaseAdminClient(): any {
  const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL;
  if (tursoDatabaseUrl) {
    return createTursoAdminClient(tursoDatabaseUrl, process.env.TURSO_AUTH_TOKEN);
  }

  const env = getEnv();

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      fetch: (url, options) => fetch(url, { ...options, cache: "no-store" })
    }
  });
}
