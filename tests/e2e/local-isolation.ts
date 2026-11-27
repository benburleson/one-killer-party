import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

function localDatabase(sql: string) {
  if (process.env.PLAYWRIGHT_LOCAL_SUPABASE !== "1" ||
      process.env.APP_URL !== "http://127.0.0.1:3000" ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321") {
    throw new Error("Disposable local integration environment required");
  }
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }));
  if (status.API_URL !== "http://127.0.0.1:54321" ||
      !/^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(status.DB_URL)) {
    throw new Error("Disposable local integration environment required");
  }
  return execFileSync("docker", [
    "exec", "supabase_db_one-killer-party", "psql", "-X", "-At",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// Both projects run serially. Reset shared loopback buckets only between tests,
// never between the concurrent admissions; Production limits remain unchanged.
export async function isolateLocalRateLimits() {
  localDatabase("DELETE FROM public.lobby_rate_limits");
  // GoTrue's anonymous sign-in buckets are in memory, not lobby_rate_limits.
  execFileSync("docker", ["restart", "supabase_auth_one-killer-party"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  await expect.poll(async () => {
    try {
      return (await fetch("http://127.0.0.1:54321/auth/v1/health", {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
        signal: AbortSignal.timeout(2000),
      })).ok;
    } catch {
      return false;
    }
  }, { timeout: 30_000 }).toBe(true);
}

export function localJoinRateLimited() {
  // Return only a category, never bucket hashes, principals or credentials.
  return localDatabase(
    "SELECT EXISTS (SELECT 1 FROM public.lobby_rate_limits WHERE request_count > 20 AND window_started_at > now() - interval '900 seconds')",
  ) === "t";
}
