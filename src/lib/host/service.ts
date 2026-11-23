import "server-only";
import { serviceRoleClient } from "@/lib/supabase/service-client";
import { currentUserId } from "./auth";
import { hostService } from "./core";

export function service() {
  return hostService({
    user: currentUserId,
    rpc: async (name, args) => serviceRoleClient().rpc(name, args),
  });
}
