import "server-only";
import { authClient } from "@/lib/host/auth";
import { serviceRoleClient } from "@/lib/supabase/service-client";
import { getOwnDossier } from "./dossier-core";
import { loadPublishedMysteryDefinition } from "./trusted-loader";

export async function getMyStartingDossier(partyId: unknown) {
  return getOwnDossier(partyId, {
    async identity() {
      const client = await authClient(true);
      const session = await client.auth.getSession();
      const token = session.data.session?.access_token;
      if (session.error || !token) return null;
      const user = await client.auth.getUser(token);
      if (user.error || !user.data.user) return null;
      const claims = await client.auth.getClaims(token);
      if (claims.error || !claims.data || claims.data.claims.sub !== user.data.user.id ||
          typeof claims.data.claims.session_id !== "string") return null;
      return { principalId: user.data.user.id, sessionId: claims.data.claims.session_id };
    },
    async snapshot(id, principalId) {
      const { data, error } = await serviceRoleClient().rpc("get_dossier_authorization_snapshot", {
        p_party_id: id, p_principal_id: principalId,
      });
      if (error) throw new Error("unavailable");
      return data;
    },
    load: loadPublishedMysteryDefinition,
  });
}
