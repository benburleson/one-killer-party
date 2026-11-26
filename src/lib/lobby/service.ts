import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { authClient, currentUserId } from "@/lib/host/auth";
import { validPartyId, verifiedEmailHost, verifier } from "@/lib/host/core";
import { serviceRoleClient } from "@/lib/supabase/service-client";
import { publishedVersionRefSchema } from "@/lib/mystery-content/schema";
import { loadPublishedPublicMystery } from "@/lib/mystery-content/trusted-loader";
import { generateRecoveryToken, recoveryTokenVerifier, validRecoveryToken } from "./core";
import {
  BLACKWOOD_PUBLIC_CHARACTERS,
  isBlackwoodPackage,
  type PublicCharacter,
  type PublicCharacterId,
} from "./public-characters";

type Row = Record<string, unknown>;
export type PublicCharacterCard = Pick<PublicCharacter, "id" | "publicName" | "archetype" | "description">;
export type GuestMembership = {
  partyId: string;
  participantId: string;
  displayName: string;
  status: string;
  participantCount: number;
  assignedCharacterId: PublicCharacterId | null;
  assignedCharacter: PublicCharacterCard | null;
};
export type HostParticipant = {
  participantId: string;
  displayName: string;
  isHost: boolean;
  assignedCharacterId: PublicCharacterId | null;
  assignedCharacter: PublicCharacterCard | null;
};

function membership(row: unknown, characters: readonly PublicCharacter[]): GuestMembership | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Row;
  if (!validPartyId(value.party_id) || !validPartyId(value.participant_id) ||
      typeof value.display_name !== "string" || value.status !== "LOBBY" ||
      typeof value.participant_count !== "number") return null;
  const assignedCharacterId = value.assigned_character_id;
  const assignedCharacter = assignedCharacterId === null
    ? null
    : characters.find((character) => character.id === assignedCharacterId);
  if (assignedCharacterId !== null && !assignedCharacter) return null;
  return {
    partyId: value.party_id,
    participantId: value.participant_id,
    displayName: value.display_name,
    status: value.status,
    participantCount: value.participant_count,
    assignedCharacterId: assignedCharacter?.id ?? null,
    assignedCharacter: assignedCharacter ?? null,
  };
}

export async function signedInUser() {
  const client = await authClient(true);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !validPartyId(data.user.id)) return null;
  return { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
}

export async function syncUser() {
  const client = await authClient(true);
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (isAuthSessionMissingError(error) ||
        (isAuthApiError(error) && (error.status === 401 || error.status === 403))) return null;
    throw new Error("Authentication unavailable");
  }
  if (!data.user || !validPartyId(data.user.id)) return null;
  return { id: data.user.id, isHost: verifiedEmailHost(data.user) !== null };
}

export function rateBucketHash(scope: string, principal: string, forwardedFor: string | null) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Lobby service is not configured");
  const address = forwardedFor?.split(",")[0]?.trim() ?? "";
  const source = isIP(address) ? address : `principal:${principal}`;
  return `\\x${createHmac("sha256", serviceKey).update(`${scope}:${source}`).digest("hex")}`;
}

export function lobbyService() {
  const client = serviceRoleClient();
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error("Lobby command unavailable");
    return data;
  }
  async function publicCatalog(principal: string, partyId: string, expected?: Row) {
    const data = await call("get_lobby_party_pin", { p_party_id: partyId, p_principal: principal });
    if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") {
      throw new Error("Lobby command unavailable");
    }
    const pin = data[0] as Row;
    if (expected && (expected.mystery_id !== pin.mystery_id || expected.mystery_version !== pin.mystery_version)) {
      throw new Error("Lobby command unavailable");
    }
    if (isBlackwoodPackage(pin.mystery_id, pin.mystery_version) &&
        pin.schema_version === null && pin.digest_sha256 === null) {
      return { title: "Blackwood Affair", characters: BLACKWOOD_PUBLIC_CHARACTERS };
    }
    const ref = publishedVersionRefSchema.safeParse({
      mysteryId: pin.mystery_id, version: pin.mystery_version,
      schemaVersion: pin.schema_version, digestSha256: pin.digest_sha256,
    });
    if (!ref.success) throw new Error("Lobby command unavailable");
    const loaded = await loadPublishedPublicMystery(ref.data);
    if (!loaded.ok) throw new Error("Lobby command unavailable");
    return loaded.projection;
  }
  async function projectMembership(row: unknown, principal: string) {
    if (!row || typeof row !== "object" || !validPartyId((row as Row).party_id)) {
      throw new Error("Lobby command unavailable");
    }
    const value = row as Row;
    const catalog = await publicCatalog(principal, value.party_id as string, value);
    const result = membership(row, catalog.characters);
    if (!result) throw new Error("Lobby command unavailable");
    return result;
  }
  async function guestMemberships(principal: string): Promise<GuestMembership[]> {
    const data = await call("get_guest_membership", { p_principal: principal });
    if (!Array.isArray(data)) throw new Error("Lobby command unavailable");
    return Promise.all(data.map((row) => projectMembership(row, principal)));
  }

  return {
    async join(principal: string, code: string, displayName: string, bucketHash: string) {
      if ((await signedInUser())?.id !== principal) return null;
      const data = await call("join_party", {
        p_principal: principal,
        p_verifier_hash: verifier(code),
        p_display_name: displayName,
        p_rate_bucket_hash: bucketHash,
      });
      if (!Array.isArray(data) || data.length !== 1) return null;
      const row = data[0] as Row;
      return row.outcome === "joined" ? projectMembership({
        party_id: row.party_id,
        participant_id: row.participant_id,
        display_name: row.display_name,
        status: row.status,
        participant_count: row.participant_count,
        assigned_character_id: null,
        mystery_id: row.mystery_id,
        mystery_version: row.mystery_version,
      }, principal) : { outcome: row.outcome === "full" ? "full" : "unavailable" } as const;
    },
    async myMemberships(principal: string): Promise<GuestMembership[]> {
      if ((await signedInUser())?.id !== principal) throw new Error("Lobby command unavailable");
      return guestMemberships(principal);
    },
    /** One authorized read of the party and its roster for the verified host. */
    async hostRoster(host: string, partyId: string): Promise<{
      partyId: string;
      status: "LOBBY";
      mysteryId: string;
      title: string;
      characters: readonly PublicCharacter[];
      participants: HostParticipant[];
      version: number;
    }> {
      if (!validPartyId(partyId) || await currentUserId() !== host) throw new Error("Lobby command unavailable");
      const partyData = await call("get_host_party", { p_host: host, p_party_id: partyId });
      if (!Array.isArray(partyData) || partyData.length !== 1) throw new Error("Lobby command unavailable");
      const party = partyData[0] as Row;
      if (party.party_id !== partyId || party.status !== "LOBBY" ||
          !Number.isSafeInteger(party.version)) {
        throw new Error("Lobby command unavailable");
      }
      const catalog = await publicCatalog(host, partyId, party);
      const data = await call("list_host_participants", { p_host: host, p_party_id: partyId });
      if (!Array.isArray(data)) throw new Error("Lobby command unavailable");
      let rosterVersion = party.version as number;
      const participants = data.map((item: unknown, index: number) => {
        if (!item || typeof item !== "object") throw new Error("Lobby command unavailable");
        const row = item as Row;
        const characterId = row.assigned_character_id;
        const assignedCharacter = characterId === null ? null : catalog.characters.find((character) => character.id === characterId);
        if (!validPartyId(row.participant_id) || typeof row.display_name !== "string" ||
            (characterId !== null && !assignedCharacter) ||
            !Number.isSafeInteger(row.party_version) ||
            (index > 0 && row.party_version !== rosterVersion)) {
          throw new Error("Lobby command unavailable");
        }
        rosterVersion = row.party_version as number;
        return {
          participantId: row.participant_id as string,
          displayName: row.display_name,
          isHost: row.principal_id === host,
          assignedCharacterId: assignedCharacter?.id ?? null,
          assignedCharacter: assignedCharacter ?? null,
        };
      });
      return {
        partyId,
        status: "LOBBY",
        mysteryId: party.mystery_id as string,
        title: catalog.title,
        characters: catalog.characters,
        participants,
        version: rosterVersion,
      };
    },
    async assignCharacter(
      host: string,
      partyId: string,
      participantId: string,
      characterId: string | null,
      expectedVersion: number,
      confirmChange: boolean,
    ) {
      if (await currentUserId() !== host) return "unavailable" as const;
      if (!validPartyId(partyId) || !validPartyId(participantId) ||
          !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        return "unavailable" as const;
      }
      const roster = await this.hostRoster(host, partyId);
      if (characterId !== null && !roster.characters.some((character) => character.id === characterId)) {
        return "unavailable" as const;
      }
      const data = await call("assign_public_character", {
        p_host: host,
        p_party_id: partyId,
        p_participant_id: participantId,
        p_character_id: characterId,
        p_expected_version: expectedVersion,
        p_confirm_change: confirmChange,
      });
      if (!Array.isArray(data) || data.length !== 1) return "unavailable" as const;
      const result = (data[0] as Row).outcome;
      return result === "changed" || result === "unchanged" || result === "conflict" ||
        result === "confirmation_required" || result === "occupied" || result === "unavailable"
        ? result : "unavailable";
    },
    async enrollHost(host: string, partyId: string, displayName: string) {
      if (await currentUserId() !== host) return false;
      const data = await call("enroll_host_participant", {
        p_host: host, p_party_id: partyId, p_display_name: displayName,
      });
      if (!Array.isArray(data) || data.length !== 1) return false;
      const row = data[0] as Row;
      return row.outcome === "joined";
    },
    async remove(host: string, partyId: string, participantId: string) {
      if (await currentUserId() !== host) return false;
      if (!validPartyId(participantId)) return false;
      return await call("remove_host_participant", {
        p_host: host, p_party_id: partyId, p_participant_id: participantId,
      }) === true;
    },
    async initiateRecovery(host: string, partyId: string, participantId: string, bucketHash: string) {
      if (await currentUserId() !== host) return null;
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
      if ((await signedInUser())?.id !== principal) return null;
      if (!validRecoveryToken(token)) return null;
      const data = await call("redeem_participant_recovery", {
        p_new_principal: principal,
        p_verifier_hash: recoveryTokenVerifier(token),
        p_rate_bucket_hash: bucketHash,
      });
      if (!Array.isArray(data) || data.length !== 1) return null;
      const row = data[0] as Row;
      if (row.outcome !== "recovered" || !validPartyId(row.party_id) ||
          !validPartyId(row.participant_id)) return null;
      return (await guestMemberships(principal)).find((item) =>
        item.partyId === row.party_id && item.participantId === row.participant_id) ?? null;
    },
  };
}
