import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, secureCookie } from "@/lib/host/auth";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  try {
    const config = authConfig();
    const client = createServerClient(config.url, config.key, {
      cookieOptions: secureCookie({}, config.secure),
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values, headers) => {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, secureCookie(options, config.secure)));
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
          response.headers.set("Cache-Control", "private, no-store, max-age=0");
          response.headers.set("Referrer-Policy", "no-referrer");
        },
      },
    });
    await client.auth.getUser();
  } catch {
    // The page will safely report unavailable configuration or authentication.
  }
  return response;
}

export const config = { matcher: ["/host/:path*", "/auth/callback", "/join"] };
