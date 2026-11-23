"use server";

import { headers } from "next/headers";
import { authClient } from "@/lib/host/auth";
import { validPartyId } from "@/lib/host/core";
import { forwardedClientAddress, normalizeDisplayName, validRecoveryToken } from "@/lib/lobby/core";
import { normalizeInvitationCode } from "@/lib/lobby/invite-code";
import { lobbyService, rateBucketHash, signedInUser, type GuestMembership } from "@/lib/lobby/service";
import { sameOrigin } from "@/lib/request";
import { captchaTokenFromForm } from "@/lib/turnstile-token";

export type GuestFormState = { message?: string; membership?: GuestMembership };

type PrincipalResult =
  | { kind: "guest"; id: string }
  | { kind: "account_conflict" }
  | { kind: "anonymous_sign_in_failed" };

async function guestPrincipal(captchaToken: string): Promise<PrincipalResult> {
  const user = await signedInUser();
  if (user) {
    return user.isAnonymous
      ? { kind: "guest", id: user.id }
      : { kind: "account_conflict" };
  }
  const client = await authClient();
  const { data, error } = await client.auth.signInAnonymously({ options: { captchaToken } });
  if (error) {
    // Categorize failures without logging captcha tokens, email, invite codes or provider detail.
    console.warn("guest_anonymous_auth", { stage: "provider_rejected" });
    return { kind: "anonymous_sign_in_failed" };
  }
  if (!data.user || !validPartyId(data.user.id) || data.user.is_anonymous !== true) {
    console.warn("guest_anonymous_auth", { stage: "unexpected_identity" });
    return { kind: "anonymous_sign_in_failed" };
  }
  return { kind: "guest", id: data.user.id };
}

export async function joinParty(_state: GuestFormState, form: FormData): Promise<GuestFormState> {
  try {
    if (!(await sameOrigin())) return { message: "Request unavailable. Please try again." };
    const code = normalizeInvitationCode(form.get("code"));
    const displayName = normalizeDisplayName(form.get("displayName"));
    if (!code || !displayName) {
      return { message: "Enter the eight-character code and a display name." };
    }

    const captchaToken = captchaTokenFromForm(form);
    if (!captchaToken) return { message: "Complete human verification and try again." };
    const principal = await guestPrincipal(captchaToken);
    if (principal.kind === "account_conflict") {
      return { message: "This browser has another signed-in account. Open the invitation in a separate browser context to keep that account unchanged." };
    }
    if (principal.kind === "anonymous_sign_in_failed") {
      return { message: "Guest sign-in was unavailable. Please refresh and retry. If this continues, contact the host." };
    }
    const membership = await lobbyService().join(
      principal.id,
      code,
      displayName,
      rateBucketHash("join", principal.id, forwardedClientAddress(await headers())),
    );
    if (membership && "partyId" in membership) return { membership };
    if (membership?.outcome === "full") {
      return { message: "This party is full. Ask the host for help." };
    }
  } catch {
    // Credential values and provider errors are intentionally never logged or returned.
  }
  return { message: "That invitation could not be used. Check the code or ask the host for help." };
}

export async function redeemRecovery(_state: GuestFormState, form: FormData): Promise<GuestFormState> {
  try {
    if (!(await sameOrigin())) return { message: "Recovery could not be completed. Ask the host for help." };
    const rawToken = form.get("recoveryToken");
    if (!validRecoveryToken(rawToken)) {
      return { message: "Recovery could not be completed. Ask the host for help." };
    }
    const captchaToken = captchaTokenFromForm(form);
    if (!captchaToken) return { message: "Complete human verification and try again." };
    const principal = await guestPrincipal(captchaToken);
    if (principal.kind === "account_conflict") {
      return { message: "This browser has another signed-in account. Open recovery in a separate browser context to keep that account unchanged." };
    }
    if (principal.kind === "anonymous_sign_in_failed") {
      return { message: "Guest sign-in was unavailable. Please refresh and retry. If this continues, contact the host." };
    }
    const membership = await lobbyService().redeemRecovery(
      principal.id,
      rawToken,
      rateBucketHash("recovery", principal.id, forwardedClientAddress(await headers())),
    );
    if (membership) return { membership };
  } catch {
    // Keep expired, forged, consumed, cross-party and provider failures indistinguishable.
  }
  return { message: "Recovery could not be completed. Ask the host to verify your identity and issue a new credential." };
}
