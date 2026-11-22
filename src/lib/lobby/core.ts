import { createHash, randomBytes } from "node:crypto";

const inviteCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export function invitationCodeFromFragment(fragment: string): string | null {
  const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  if (params.getAll("code").length !== 1 || [...params.keys()].some((key) => key !== "code")) {
    return null;
  }
  const code = params.get("code");
  return code && inviteCodePattern.test(code.toUpperCase()) ? code.toUpperCase() : null;
}

export function normalizeInvitationCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return inviteCodePattern.test(code) ? code : null;
}

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return [...name].length >= 1 && [...name].length <= 50 ? name : null;
}

export function generateRecoveryToken(): string {
  return randomBytes(32).toString("base64url");
}

export function recoveryTokenVerifier(token: string): string {
  return `\\x${createHash("sha256").update(token, "utf8").digest("hex")}`;
}
