"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authClient, authConfig } from "@/lib/host/auth";
import { originMismatchDetails, safeAuthErrorDetails, validEmail, type IssueResult } from "@/lib/host/core";
import { service } from "@/lib/host/service";

async function sameOrigin() {
  const origin = (await headers()).get("origin");
  return origin !== null && origin === authConfig().origin;
}

export type FormState = { message?: string; result?: IssueResult; link?: string };

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
