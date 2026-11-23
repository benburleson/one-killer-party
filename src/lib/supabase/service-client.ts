import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * The only place that reads the service-role key for database access. This
 * client bypasses RLS: callers must verify the current user first and call
 * only the narrow service-role RPCs, never browser-reachable code.
 */
export function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service is not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
