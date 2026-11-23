import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../src/lib/mystery-content/validate.ts";
import { publishMysteryDefinition } from "../src/lib/mystery-content/publication.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

function argumentsFor(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--confirm-approval") {
      if (values.has(key)) throw new Error("INVALID_ARGUMENTS");
      values.set(key, true);
    } else if (["--target", "--input", "--provenance", "--approved-by", "--approval-reference"].includes(key)) {
      if (values.has(key) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
        throw new Error("INVALID_ARGUMENTS");
      }
      values.set(key, argv[++index]);
    } else {
      throw new Error("INVALID_ARGUMENTS");
    }
  }
  if (values.get("--target") !== "local" || values.get("--confirm-approval") !== true ||
      !values.has("--input") || !values.has("--provenance") ||
      !values.has("--approved-by") || !values.has("--approval-reference")) {
    throw new Error("INVALID_ARGUMENTS");
  }
  return values;
}

function localApiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      url.port === "54321" &&
      url.username === "" && url.password === "" && url.pathname === "/" &&
      url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

function operatorToken(secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "authenticated",
    exp: now + 300,
    iat: now,
    iss: "supabase",
    role: "mystery_operator",
    sub: "00000000-0000-4000-8000-000000000001",
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

async function main() {
  const args = argumentsFor(process.argv.slice(2));
  const filename = args.get("--input");
  if (!isAbsolute(filename)) throw new Error("INPUT_INVALID");
  const inputPath = resolve(filename);
  const pathFromRoot = relative(root, inputPath);
  if (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..") {
    throw new Error("INPUT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!localApiUrl(url) || !anonKey || /[\r\n]/.test(anonKey) ||
      !jwtSecret || /[\r\n]/.test(jwtSecret)) throw new Error("LOCAL_TARGET_REQUIRED");

  let input;
  try {
    input = JSON.parse(await readFile(inputPath, "utf8"));
  } catch {
    throw new Error("INPUT_INVALID");
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + operatorToken(jwtSecret) } },
  });
  const approvalMetadata = {
    provenance: args.get("--provenance"),
    approvedBy: args.get("--approved-by"),
    approvalReference: args.get("--approval-reference"),
  };
  const authorization = {
    target: "local",
    artifact: approvalMetadata,
    async verify(artifact, binding) {
      if (binding.target !== "local" || artifact !== approvalMetadata) return null;
      const now = new Date();
      return {
        ...approvalMetadata,
        binding,
        approvedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      };
    },
  };
  const result = await publishMysteryDefinition(input, EIGHT_ROLE_PROTOTYPE_RULES, authorization, {
    async upload(path, bytes) {
      const { error } = await client.storage.from("private-mystery-packages").upload(path, bytes, {
        contentType: "application/json",
        upsert: false,
      });
      if (error) throw new Error("OBJECT_WRITE_FAILED");
    },
    async download(path) {
      const { data, error } = await client.storage.from("private-mystery-packages").download(path);
      if (error || !data) throw new Error("OBJECT_READ_FAILED");
      return new Uint8Array(await data.arrayBuffer());
    },
    async register(ref, path, rulesId, metadata) {
      const { data, error } = await client.rpc("publish_mystery_version", {
        p_mystery_id: ref.mysteryId,
        p_version: ref.version,
        p_schema_version: ref.schemaVersion,
        p_digest_sha256: ref.digestSha256,
        p_object_path: path,
        p_rule_set_id: rulesId,
        p_provenance: metadata.provenance,
        p_approved_by: metadata.approvedBy,
        p_approval_reference: metadata.approvalReference,
      });
      if (error || (data !== "published" && data !== "already_published")) {
        throw new Error("REGISTRATION_FAILED");
      }
      return data;
    },
  });
  if (!result.ok) throw new Error(result.code);
  console.log(`${result.status}: ${result.ref.mysteryId}/${result.ref.version} schema=${result.ref.schemaVersion} sha256=${result.ref.digestSha256}`);
}

main().catch((error) => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PUBLICATION_FAILED";
  console.error(code);
  process.exitCode = 1;
});
