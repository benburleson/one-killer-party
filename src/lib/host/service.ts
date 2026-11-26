import "server-only";
import { serviceRoleClient } from "@/lib/supabase/service-client";
import { currentUserId } from "./auth";
import { hostService } from "./core";
import { loadPublishedPublicMystery } from "@/lib/mystery-content/trusted-loader";

export function service() {
  return hostService({
    user: currentUserId,
    rpc: async (name, args) => serviceRoleClient().rpc(name, args),
    loadPublic: loadPublishedPublicMystery,
  });
}
