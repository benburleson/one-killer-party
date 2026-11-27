import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { publishedVersionRefSchema } from "../src/lib/mystery-content/schema.ts";
import { loadTrustedPublishedMystery, PRIVATE_BUCKET } from "../src/lib/mystery-content/trusted-loader-core.ts";

async function main() {
  const [target, mysteryId, version, schema, digestSha256, confirm, ...extra] = process.argv.slice(2);
  if (target !== "--local" || confirm !== "--confirm-local-activation" || extra.length ||
      !/^[1-9][0-9]*$/.test(schema ?? "")) throw new Error("INVALID_ARGUMENTS");
  const parsed = publishedVersionRefSchema.safeParse({
    mysteryId, version, schemaVersion: Number(schema), digestSha256,
  });
  if (!parsed.success) throw new Error("INVALID_REFERENCE");
  const ref = parsed.data;
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }));
  if (status.API_URL !== "http://127.0.0.1:54321" || !status.SERVICE_ROLE_KEY ||
      !/^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(status.DB_URL)) {
    throw new Error("LOCAL_TARGET_REQUIRED");
  }
  const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await loadTrustedPublishedMystery(ref, {
    async lookup(expected) {
      const { data, error } = await client.rpc("get_published_mystery", {
        p_mystery_id: expected.mysteryId, p_version: expected.version,
        p_schema_version: expected.schemaVersion, p_digest_sha256: expected.digestSha256,
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
  if (!verified.ok) throw new Error("CONTENT_UNAVAILABLE");
  // Canonical reference fields contain only lowercase ASCII, digits and separators.
  const statement = `UPDATE private_mystery.active_version SET mystery_id = '${ref.mysteryId}', version = '${ref.version}', schema_version = ${ref.schemaVersion}, digest_sha256 = '${ref.digestSha256}' WHERE singleton`;
  execFileSync("docker", ["exec", "supabase_db_one-killer-party", "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", "postgres", "-c", statement], { stdio: ["ignore", "ignore", "ignore"] });
  console.log(`activated local ${ref.mysteryId}/${ref.version} schema=${ref.schemaVersion} sha256=${ref.digestSha256}`);
}

main().catch((error) => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "ACTIVATION_UNAVAILABLE";
  console.error(code);
  process.exitCode = 1;
});
