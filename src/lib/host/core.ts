import { createHash, randomInt } from "node:crypto";
import { publishedVersionRefSchema, type PublishedVersionRef } from "../mystery-content/schema.ts";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validPartyId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

/** Parses the canonical decimal party version posted by a form; null when not a Postgres integer. */
export function parsePartyVersion(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,9})$/.test(value)) return null;
  const version = Number(value);
  return version <= 2147483647 ? version : null;
}

export function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function verifiedEmailHost(user: {
  id?: string;
  email?: string;
  email_confirmed_at?: string;
  is_anonymous?: boolean;
} | null): string | null {
  return user && validPartyId(user.id) && user.is_anonymous === false &&
    validEmail(user.email) && typeof user.email_confirmed_at === "string" &&
    user.email_confirmed_at.length > 0 ? user.id : null;
}

export function appOrigin(value: string | undefined): string {
  if (!value) throw new Error("App URL is not configured");
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" &&
       !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Invalid app URL");
  }
  return url.origin;
}

/** Resolve the host CTA using the configured app origin, keeping local dev usable. */
export function hostPageUrl(configuredAppUrl: string | undefined): string {
  return configuredAppUrl ? `${appOrigin(configuredAppUrl)}/host` : "/host";
}

/** Logging allowlist: never serialize arbitrary Supabase error objects/messages. */
export function safeAuthErrorDetails(error: { status?: unknown; code?: unknown }): {
  status: number | null;
  code: string;
} {
  const status = typeof error.status === "number" && Number.isInteger(error.status) &&
    error.status >= 400 && error.status <= 599 ? error.status : null;
  const allowedCodes = new Set([
    "email_address_not_authorized",
    "over_email_send_rate_limit",
    "over_request_rate_limit",
    "smtp_server_error",
    "email_provider_disabled",
    "validation_failed",
    "signup_disabled",
  ]);
  return {
    status,
    code: typeof error.code === "string" && allowedCodes.has(error.code)
      ? error.code : "other",
  };
}

/** Fixed-value diagnostics for the canonical production host, never raw headers. */
export function originMismatchDetails(requestOrigin: string | null, configuredOrigin: string) {
  const canonicalAppOrigin = "https://app.onekillerparty.com";
  return {
    requestOriginPresent: requestOrigin !== null,
    requestOriginIsCanonicalApp: requestOrigin === canonicalAppOrigin,
    configuredOriginIsCanonicalApp: configuredOrigin === canonicalAppOrigin,
  };
}

export function generateCode(): string {
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export function verifier(code: string): string {
  return "\\x" + createHash("sha256").update(code, "utf8").digest("hex");
}

type RpcError = { code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
type Dependencies = {
  user: () => Promise<string | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  loadPublic?: (ref: PublishedVersionRef) => Promise<
    { ok: true; projection: { characters: readonly { id: string }[] } } | { ok: false }
  >;
  code?: () => string;
};
export type Party = { partyId: string; status: string; version: number; mysteryId?: string };
export type IssueResult = { kind: "issued"; partyId: string; code: string } |
  { kind: "existing"; partyId: string } | { kind: "unavailable" };

function party(row: unknown, includeMystery = false): Party | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!validPartyId(r.party_id) || r.status !== "LOBBY" ||
      typeof r.version !== "number" || !Number.isSafeInteger(r.version) || r.version < 0 ||
      (includeMystery && typeof r.mystery_id !== "string")) return null;
  return {
    partyId: r.party_id,
    status: r.status,
    version: r.version,
    ...(includeMystery ? { mysteryId: r.mystery_id as string } : {}),
  };
}

export function hostService(deps: Dependencies) {
  async function verifiedUser() {
    const user = await deps.user();
    if (!user || !validPartyId(user)) throw new Error("Unauthorized");
    return user;
  }
  return {
    async list(): Promise<Party[]> {
      const host = await verifiedUser();
      const { data, error } = await deps.rpc("list_host_parties", { p_host: host });
      if (error || !Array.isArray(data)) throw new Error("Unavailable");
      const rows = data.map((row) => party(row));
      if (rows.some((row) => row === null)) throw new Error("Unavailable");
      return rows as Party[];
    },
    async get(id: unknown): Promise<Party | null> {
      const host = await verifiedUser();
      if (!validPartyId(id)) return null;
      const { data, error } = await deps.rpc("get_host_party", { p_host: host, p_party_id: id });
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("Unavailable");
      if (!data.length) return null;
      const result = party(data[0], true);
      if (!result || result.partyId !== id) throw new Error("Unavailable");
      return result;
    },
    async create(id: unknown): Promise<IssueResult> {
      const host = await verifiedUser();
      if (!validPartyId(id)) return { kind: "unavailable" };
      const existing = await deps.rpc("get_host_party", { p_host: host, p_party_id: id });
      if (existing.error || !Array.isArray(existing.data) || existing.data.length > 1) return { kind: "unavailable" };
      if (existing.data.length === 1) {
        const found = party(existing.data[0], true);
        return found?.partyId === id ? { kind: "existing", partyId: id } : { kind: "unavailable" };
      }
      const active = await deps.rpc("get_active_mystery", {});
      if (active.error || !Array.isArray(active.data) || active.data.length !== 1 ||
          !active.data[0] || typeof active.data[0] !== "object") return { kind: "unavailable" };
      const row = active.data[0] as Record<string, unknown>;
      const absent = row.mystery_id === null && row.version === null &&
        row.schema_version === null && row.digest_sha256 === null;
      let ref: PublishedVersionRef | null = null;
      let characterIds: string[] | null = null;
      if (!absent) {
        const parsed = publishedVersionRefSchema.safeParse({
          mysteryId: row.mystery_id, version: row.version,
          schemaVersion: row.schema_version, digestSha256: row.digest_sha256,
        });
        if (!parsed.success || !deps.loadPublic) return { kind: "unavailable" };
        ref = parsed.data;
        const loaded = await deps.loadPublic(ref);
        if (!loaded.ok || loaded.projection.characters.length !== 8) return { kind: "unavailable" };
        characterIds = loaded.projection.characters.map(({ id }) => id);
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = (deps.code ?? generateCode)();
        const { data, error } = await deps.rpc("create_pinned_host_party", {
          p_host: host, p_party_id: id, p_verifier_hash: verifier(code),
          p_mystery_id: ref?.mysteryId ?? null, p_version: ref?.version ?? null,
          p_schema_version: ref?.schemaVersion ?? null, p_digest_sha256: ref?.digestSha256 ?? null,
          p_character_ids: characterIds,
        });
        if (error?.code === "23505") continue;
        if (error || !Array.isArray(data) || data.length !== 1 ||
            data[0]?.party_id !== id || typeof data[0]?.created !== "boolean") {
          return { kind: "unavailable" };
        }
        return data[0].created ? { kind: "issued", partyId: id, code } : { kind: "existing", partyId: id };
      }
      return { kind: "unavailable" };
    },
    async rotate(id: unknown, version: unknown): Promise<IssueResult> {
      const host = await verifiedUser();
      if (!validPartyId(id) || typeof version !== "number" ||
          !Number.isInteger(version) || version < 0 || version > 2147483647) {
        return { kind: "unavailable" };
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = (deps.code ?? generateCode)();
        const { data, error } = await deps.rpc("rotate_host_invite", {
          p_host: host, p_party_id: id, p_verifier_hash: verifier(code), p_expected_version: version,
        });
        if (error?.code === "23505") continue;
        if (error || typeof data !== "boolean" || !data) return { kind: "unavailable" };
        return { kind: "issued", partyId: id, code };
      }
      return { kind: "unavailable" };
    },
  };
}
