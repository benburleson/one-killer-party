import { createHash, randomInt } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validPartyId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
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
  rpc: (name: string, args: Record<string, string | number>) => Promise<RpcResult>;
  code?: () => string;
};
export type Party = { partyId: string; status: string; version: number };
export type IssueResult = { kind: "issued"; partyId: string; code: string } |
  { kind: "existing"; partyId: string } | { kind: "unavailable" };

function party(row: unknown): Party | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!validPartyId(r.party_id) || r.status !== "LOBBY" ||
      typeof r.version !== "number" || !Number.isSafeInteger(r.version) || r.version < 0) return null;
  return { partyId: r.party_id, status: r.status, version: r.version };
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
      const rows = data.map(party);
      if (rows.some((row) => row === null)) throw new Error("Unavailable");
      return rows as Party[];
    },
    async get(id: unknown): Promise<Party | null> {
      const host = await verifiedUser();
      if (!validPartyId(id)) return null;
      const { data, error } = await deps.rpc("get_host_party", { p_host: host, p_party_id: id });
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("Unavailable");
      if (!data.length) return null;
      const result = party(data[0]);
      if (!result || result.partyId !== id) throw new Error("Unavailable");
      return result;
    },
    async create(id: unknown): Promise<IssueResult> {
      const host = await verifiedUser();
      if (!validPartyId(id)) return { kind: "unavailable" };
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = (deps.code ?? generateCode)();
        const { data, error } = await deps.rpc("create_host_party", {
          p_host: host, p_party_id: id, p_verifier_hash: verifier(code),
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
