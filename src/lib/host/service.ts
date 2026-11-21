import "server-only";
import { createClient } from "@supabase/supabase-js";
import { currentUserId } from "./auth";
import { hostService } from "./core";

export function service() {
  return hostService({
    user: currentUserId,
    rpc: async (name, args) => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("Service is not configured");
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
      });
      return client.rpc(name, args);
    },
  });
}
