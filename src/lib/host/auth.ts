import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { appOrigin, verifiedEmailHost } from "./core";

export function authConfig() {
  const origin = appOrigin(process.env.APP_URL);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Auth is not configured");
  return { origin, url, key, secure: origin.startsWith("https:") };
}

export function secureCookie(options: CookieOptions, secure: boolean): CookieOptions {
  return { ...options, httpOnly: true, secure, sameSite: "lax", path: "/" };
}

export async function hasAuthenticatedSession(): Promise<boolean> {
  const client = await authClient(true);
  const { data, error } = await client.auth.getUser();
  return !error && data.user !== null;
}

export async function authClient(readOnly = false) {
  const config = authConfig();
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: secureCookie({}, config.secure),
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, secureCookie(options, config.secure)));
        } catch (error) {
          // Server component reads cannot write; the proxy refreshes first.
          if (!readOnly) throw error;
        }
      },
    },
  });
}

export async function currentUserId(): Promise<string | null> {
  const client = await authClient(true);
  const { data, error } = await client.auth.getUser();
  return error ? null : verifiedEmailHost(data.user);
}
