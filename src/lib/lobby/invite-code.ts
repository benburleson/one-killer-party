/**
 * Client-safe invitation code parsing. The join page imports this from a
 * client component, so it must stay free of Node and server-only imports.
 */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

const inviteCodePattern = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

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
