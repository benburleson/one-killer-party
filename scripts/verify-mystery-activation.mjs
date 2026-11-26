import { createClient } from "@supabase/supabase-js";
import { publishedVersionRefSchema } from "../src/lib/mystery-content/schema.ts";
import { loadTrustedPublishedMystery, PRIVATE_BUCKET } from "../src/lib/mystery-content/trusted-loader-core.ts";

function isProjectServiceKey(key, project) {
  if (typeof key !== "string" || /[\r\n]/.test(key)) return false;
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return false;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims.role === "service_role" && claims.ref === project && claims.iss === "supabase";
  } catch {
    return false;
  }
}

async function main() {
  const [target, project, mysteryId, version, schema, digestSha256, confirm, ...extra] = process.argv.slice(2);
  if (target !== "--production" || !/^[a-z0-9]{1,63}$/.test(project ?? "") ||
      confirm !== "--verify-only" || extra.length || !/^[1-9][0-9]*$/.test(schema ?? "")) {
    throw new Error("INVALID_ARGUMENTS");
  }
  const parsed = publishedVersionRefSchema.safeParse({ mysteryId, version, schemaVersion: Number(schema), digestSha256 });
  if (!parsed.success) throw new Error("INVALID_REFERENCE");
  const key = process.env.MYSTERY_VERIFICATION_SERVICE_ROLE_KEY;
  if (!isProjectServiceKey(key, project)) throw new Error("VERIFICATION_KEY_REQUIRED");
  const url = `https://${project}.supabase.co`;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await loadTrustedPublishedMystery(parsed.data, {
    async lookup(ref) {
      const { data, error } = await client.rpc("get_published_mystery", {
        p_mystery_id: ref.mysteryId, p_version: ref.version,
        p_schema_version: ref.schemaVersion, p_digest_sha256: ref.digestSha256,
      });
      if (error) throw new Error("unavailable");
      return data;
    },
    async download(path) {
      const { data, error } = await client.storage.from(PRIVATE_BUCKET).download(path);
      if (error || !data) throw new Error("unavailable");
      return new Uint8Array(await data.arrayBuffer());
    },
  });
  if (!result.ok) throw new Error("CONTENT_UNAVAILABLE");
  console.log(`verified only: target=${url} project=${project} mystery=${mysteryId} version=${version} schema=${schema} sha256=${digestSha256}`);
}

main().catch((error) => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "VERIFICATION_UNAVAILABLE";
  console.error(code);
  process.exitCode = 1;
});
