import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { authClient } from "@/lib/host/auth";
import { validPartyId, verifier } from "@/lib/host/core";
import { generateRecoveryToken, recoveryTokenVerifier } from "./core";

type Row = Record<string, unknown>;
export type GuestMembership = {
  partyId: string;
  participantId: string;
  displayName: string;
  status: string;
  participantCount: number;
};

function rpcClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Lobby service is not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}

function membership(row: unknown): GuestMembership | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Row;
  if (!validPartyId(value.party_id) || !validPartyId(value.participant_id) ||
      typeof value.display_name !== "string" || value.status !== "LOBBY" ||
      typeof value.participant_count !== "number") return null;
  return {
    partyId: value.party_id,
    participantId: value.participant_id,
    displayName: value.display_name,
    status: value.status,
    participantCount: value.participant_count,
  };
}

export async function signedInUser() {
  const client = await authClient(true);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !validPartyId(data.user.id)) return null;
  return { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
}

export function rateBucketHash(scope: string, principal: string, forwardedFor: string | null) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Lobby service is not configured");
  const address = forwardedFor?.split(",")[0]?.trim() ?? "";
  const source = isIP(address) ? address : `principal:${principal}`;
  return `\\x${createHmac("sha256", serviceKey).update(`${scope}:${source}`).digest("hex")}`;
}

export function lobbyService() {
  const client = rpcClient();
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error("Lobby command unavailable");
    return data;
  }

  return {
    async join(principal: string, code: string, displayName: string, bucketHash: string) {
      const data = await call("join_party", {
        p_principal: principal,
        p_verifier_hash: verifier(code),
        p_display_name: displayName,
        p_rate_bucket_hash: bucketHash,
      });
      if (!Array.isArray(data) || data.length !== 1) return null;
      const row = data[0] as Row;
      return row.outcome === "joined" ? membership({
        party_id: row.party_id,
        participant_id: row.participant_id,
        display_name: row.display_name,
        status: row.status,
        participant_count: row.participant_count,
      }) : { outcome: row.outcome === "full" ? "full" : "unavailable" } as const;
    },
    async myMemberships(principal: string): Promise<GuestMembership[]> {
      const data = await call("get_guest_membership", { p_principal: principal });
      if (!Array.isArray(data)) throw new Error("Lobby command unavailable");
      const memberships = data.map(membership);
      if (memberships.some((item) => item === null)) throw new Error("Lobby command unavailable");
      return memberships as GuestMembership[];
    },
    async hostRoster(host: string, partyId: string) {
      const data = await call("list_host_participants", { p_host: host, p_party_id: partyId });
      if (!Array.isArray(data)) throw new Error("Lobby command unavailable");
      return data.map((item: unknown) => {
        if (!item || typeof item !== "object") throw new Error("Lobby command unavailable");
        const row = item as Row;
        if (!validPartyId(row.participant_id) || typeof row.display_name !== "string") {
          throw new Error("Lobby command unavailable");
        }
        return {
          participantId: row.participant_id,
          displayName: row.display_name,
          isHost: row.principal_id === host,
        };
      });
    },
    async enrollHost(host: string, partyId: string, displayName: string) {
      const data = await call("enroll_host_participant", {
        p_host: host, p_party_id: partyId, p_display_name: displayName,
      });
      if (!Array.isArray(data) || data.length !== 1) return false;
      const row = data[0] as Row;
      return row.outcome === "joined";
    },
    async remove(host: string, partyId: string, participantId: string) {
      if (!validPartyId(participantId)) return false;
      return await call("remove_host_participant", {
        p_host: host, p_party_id: partyId, p_participant_id: participantId,
      }) === true;
    },
    async initiateRecovery(host: string, partyId: string, participantId: string, bucketHash: string) {
      if (!validPartyId(participantId)) return null;
      const token = generateRecoveryToken();
      const issued = await call("initiate_participant_recovery", {
        p_host: host,
        p_party_id: partyId,
        p_participant_id: participantId,
        p_verifier_hash: recoveryTokenVerifier(token),
        p_rate_bucket_hash: bucketHash,
      });
      return issued === true ? token : null;
    },
    async redeemRecovery(principal: string, token: string, bucketHash: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const data = await call("redeem_participant_recovery", {
        p_new_principal: principal,
        p_verifier_hash: recoveryTokenVerifier(token),
        p_rate_bucket_hash: bucketHash,
      });
      if (!Array.isArray(data) || data.length !== 1) return null;
      const row = data[0] as Row;
      return row.outcome === "recovered" ? membership({
        party_id: row.party_id,
        participant_id: row.participant_id,
        display_name: row.display_name,
        status: row.status,
        participant_count: row.participant_count,
      }) : null;
    },
  };
}
