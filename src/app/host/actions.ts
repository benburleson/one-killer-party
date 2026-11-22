"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authClient, authConfig, currentUserId, hasAuthenticatedSession } from "@/lib/host/auth";
import { originMismatchDetails, safeAuthErrorDetails, validEmail, type IssueResult } from "@/lib/host/core";
import { service } from "@/lib/host/service";
import { lobbyService } from "@/lib/lobby/service";
import { rateBucketHash } from "@/lib/lobby/service";

async function sameOrigin() {
  const origin = (await headers()).get("origin");
  return origin !== null && origin === authConfig().origin;
}

export type FormState = { message?: string; result?: IssueResult; link?: string };
export type LobbyActionState = { message?: string; token?: string };

export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const neutralResponse = { message: "If sign-in is available, check your email for a link." };
  // Keep the response identical for all outcomes; diagnostic fields are fixed and non-identifying.
  try {
    const requestOrigin = (await headers()).get("origin");
    const configuredOrigin = authConfig().origin;
    if (requestOrigin !== configuredOrigin) {
      console.warn("host_magic_link", {
        stage: "origin_rejected",
        ...originMismatchDetails(requestOrigin, configuredOrigin),
      });
      return neutralResponse;
    }
    if (await hasAuthenticatedSession()) return neutralResponse;
    const email = form.get("email");
    if (!validEmail(email)) {
      console.warn("host_magic_link", { stage: "invalid_email_format" });
      return neutralResponse;
    }
    const client = await authClient();
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${authConfig().origin}/auth/callback` },
    });
    if (error) {
      console.warn("host_magic_link", {
        stage: "provider_rejected",
        ...safeAuthErrorDetails(error),
      });
    } else {
      // A successful API response does not guarantee delivery to the inbox.
      console.info("host_magic_link", { stage: "provider_accepted" });
    }
  } catch {
    // Intentionally omit exception details: SDK errors can contain identifiers or request data.
    console.error("host_magic_link", { stage: "unexpected_server_error" });
  }
  return neutralResponse;
}

export async function signOut() {
  try {
    if (!(await sameOrigin())) return;
    const client = await authClient();
    await client.auth.signOut({ scope: "local" });
  } catch {
    return;
  }
  redirect("/host");
}

export async function createParty(_state: FormState, form: FormData): Promise<FormState> {
  try {
    if (!(await sameOrigin())) return { message: "Request unavailable." };
    const result = await service().create(form.get("partyId"));
    if (result.kind === "issued") {
      revalidatePath("/host");
      return { result, link: `${authConfig().origin}/join#code=${result.code}` };
    }
    if (result.kind === "existing") return { result };
  } catch {
    // Never return database or provider errors.
  }
  return { message: "Could not create party. Please try again." };
}

export async function rotateInvite(_state: FormState, form: FormData): Promise<FormState> {
  try {
    if (!(await sameOrigin()) || form.get("confirm") !== "yes") {
      return { message: "Confirm that the previous code will stop working." };
    }
    const rawVersion = form.get("version");
    const version = typeof rawVersion === "string" && /^(0|[1-9]\d*)$/.test(rawVersion)
      ? Number(rawVersion) : NaN;
    const result = await service().rotate(form.get("partyId"), version);
    if (result.kind === "issued") {
      return { result, link: `${authConfig().origin}/join#code=${result.code}` };
    }
  } catch {
    // Never return database or provider errors.
  }
  return { message: "Could not rotate invite. The party may have changed; reload it before trying again." };
}

export async function enrollAsPlayer(_state: LobbyActionState, form: FormData): Promise<LobbyActionState> {
  try {
    if (!(await sameOrigin())) return { message: "Request unavailable." };
    const partyId = form.get("partyId");
    const displayName = form.get("displayName");
    const host = await currentUserId();
    if (!host || typeof partyId !== "string" || typeof displayName !== "string" ||
        !await lobbyService().enrollHost(host, partyId, displayName)) {
      return { message: "Could not join this party as a player. It may be full or unavailable." };
    }
    revalidatePath(`/host/${partyId}`);
    return { message: "You joined as a player." };
  } catch {
    return { message: "Could not join this party as a player." };
  }
}

export async function removeParticipant(_state: LobbyActionState, form: FormData): Promise<LobbyActionState> {
  try {
    if (!(await sameOrigin()) || form.get("confirm") !== "yes") {
      return { message: "Confirm the participant removal before continuing." };
    }
    const partyId = form.get("partyId");
    const participantId = form.get("participantId");
    const host = await currentUserId();
    if (!host || typeof partyId !== "string" || typeof participantId !== "string" ||
        !await lobbyService().remove(host, partyId, participantId)) {
      return { message: "Could not remove this participant. The party may have changed." };
    }
    revalidatePath(`/host/${partyId}`);
    return { message: "Participant removed. They must use a new identity to join again." };
  } catch {
    return { message: "Could not remove this participant." };
  }
}

export async function initiateRecovery(_state: LobbyActionState, form: FormData): Promise<LobbyActionState> {
  try {
    if (!(await sameOrigin()) || form.get("confirmIdentity") !== "yes") {
      return { message: "Confirm that you verified this participant in person or out of band." };
    }
    const partyId = form.get("partyId");
    const participantId = form.get("participantId");
    const host = await currentUserId();
    if (!host || typeof partyId !== "string" || typeof participantId !== "string") {
      return { message: "Could not start recovery." };
    }
    const requestHeaders = await headers();
    const forwardedFor = requestHeaders.get("x-vercel-forwarded-for") ??
      requestHeaders.get("x-forwarded-for");
    const token = await lobbyService().initiateRecovery(
      host,
      partyId,
      participantId,
      rateBucketHash("recovery-issue", host, forwardedFor),
    );
    if (!token) return { message: "Could not start recovery. The party may have changed." };
    return { token };
  } catch {
    return { message: "Could not start recovery." };
  }
}
