import { createHash, randomBytes } from "node:crypto";

const recoveryTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return [...name].length >= 1 && [...name].length <= 50 ? name : null;
}

export function generateRecoveryToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Shape check only; possession is proven by the stored verifier, never by format. */
export function validRecoveryToken(value: unknown): value is string {
  return typeof value === "string" && recoveryTokenPattern.test(value);
}

export function recoveryTokenVerifier(token: string): string {
  return `\\x${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export function coherentGuestRevision(before: unknown, after: unknown, membership: unknown, principal: string,
  pin: { schemaVersion: number | null; digestSha256: string | null }): number | null {
  if (!Array.isArray(before) || before.length !== 1 || !Array.isArray(after) || after.length !== 1 ||
      !before[0] || typeof before[0] !== "object" || !after[0] || typeof after[0] !== "object" ||
      !membership || typeof membership !== "object") return null;
  const first = before[0] as Record<string, unknown>;
  const last = after[0] as Record<string, unknown>;
  const member = membership as Record<string, unknown>;
  const fields = ["party_id", "principal_id", "participant_id", "assigned_character_id", "status",
    "party_version", "mystery_id", "mystery_version", "schema_version", "digest_sha256"];
  if (fields.some((field) => first[field] !== last[field]) ||
      first.principal_id !== principal || first.party_id !== member.party_id ||
      first.participant_id !== member.participant_id || first.assigned_character_id !== member.assigned_character_id ||
      first.status !== "LOBBY" || first.status !== member.status ||
      first.mystery_id !== member.mystery_id || first.mystery_version !== member.mystery_version ||
      first.schema_version !== pin.schemaVersion || first.digest_sha256 !== pin.digestSha256 ||
      !Number.isSafeInteger(first.party_version) || (first.party_version as number) < 0) return null;
  return first.party_version as number;
}

/**
 * Selects the header used as the rate-limit source address. Vercel overwrites
 * `x-vercel-forwarded-for`; `x-forwarded-for` is only trustworthy behind a
 * proxy that overwrites it. Callers must fall back to the authenticated
 * principal when the value is not a valid address.
 */
export function forwardedClientAddress(headers: { get(name: string): string | null }): string | null {
  return headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
}
