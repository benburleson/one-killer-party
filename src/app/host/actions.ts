"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authClient, authConfig } from "@/lib/host/auth";
import { validEmail, type IssueResult } from "@/lib/host/core";
import { service } from "@/lib/host/service";

async function sameOrigin() {
  const origin = (await headers()).get("origin");
  return origin !== null && origin === authConfig().origin;
}

export type FormState = { message?: string; result?: IssueResult; link?: string };

export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const email = form.get("email");
    if (await sameOrigin() && validEmail(email)) {
      const client = await authClient();
      await client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${authConfig().origin}/auth/callback` },
      });
    }
  } catch {
    // Deliberately use the same response for invalid emails and provider errors.
  }
  return { message: "If sign-in is available, check your email for a link." };
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
