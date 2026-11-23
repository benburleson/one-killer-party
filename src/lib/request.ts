import "server-only";
import { headers } from "next/headers";
import { authConfig } from "@/lib/host/auth";

/** Server actions accept only requests whose Origin exactly matches APP_URL. */
export async function sameOrigin(): Promise<boolean> {
  const origin = (await headers()).get("origin");
  return origin !== null && origin === authConfig().origin;
}
