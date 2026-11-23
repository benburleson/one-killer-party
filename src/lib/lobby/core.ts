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

/**
 * Selects the header used as the rate-limit source address. Vercel overwrites
 * `x-vercel-forwarded-for`; `x-forwarded-for` is only trustworthy behind a
 * proxy that overwrites it. Callers must fall back to the authenticated
 * principal when the value is not a valid address.
 */
export function forwardedClientAddress(headers: { get(name: string): string | null }): string | null {
  return headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
}
