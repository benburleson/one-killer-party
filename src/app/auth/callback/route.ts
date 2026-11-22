import { NextResponse } from "next/server";
import { authClient, authConfig } from "@/lib/host/auth";

export async function GET(request: Request) {
  let origin: string;
  try {
    origin = authConfig().origin;
  } catch {
    return new Response("Authentication unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  let success = false;
  const code = new URL(request.url).searchParams.get("code");
  if (code && code.length <= 2048) {
    try {
      const client = await authClient();
      const { data: current, error: currentError } = await client.auth.getUser();
      if (currentError || !current.user) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        success = !error;
      }
    } catch {
      // Do not expose provider errors or callback credentials.
    }
  }
  const response = NextResponse.redirect(`${origin}/host${success ? "" : "?auth=error"}`, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
