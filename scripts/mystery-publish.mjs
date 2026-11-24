import { createClient } from "@supabase/supabase-js";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { sealMysteryDefinition } from "../src/lib/mystery-content/integrity.ts";
import { publishMysteryDefinition } from "../src/lib/mystery-content/publication.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../src/lib/mystery-content/validate.ts";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const rules = EIGHT_ROLE_PROTOTYPE_RULES;
const bucket = "private-mystery-packages";
const localUrl = "http://127.0.0.1:54321";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readPackage(filename) {
  if (typeof filename !== "string" || !isAbsolute(filename)) {
    throw new Error(filename?.startsWith("~") ? "EXPAND_TILDE_IN_SHELL" : "ABSOLUTE_INPUT_REQUIRED");
  }
  let actual;
  try {
    actual = await realpath(filename);
  } catch {
    throw new Error("INPUT_INVALID");
  }
  const fromRoot = relative(root, actual);
  if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))) {
    throw new Error("INPUT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  let input;
  try {
    input = JSON.parse(await readFile(actual, "utf8"));
  } catch {
    throw new Error("INPUT_INVALID");
  }
  const sealed = sealMysteryDefinition(input, rules);
  if (!sealed.ok) throw new Error("INVALID_PACKAGE");
  return { input, ref: sealed.ref };
}

export function localConfiguration(env) {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, MYSTERY_PUBLISHER_EMAIL: email,
    MYSTERY_PUBLISHER_USER_ID: userId } = env;
  if (url !== localUrl || !key || /[\r\n]/.test(key) || !email || /[\r\n]/.test(email) ||
      !userId || !uuid.test(userId)) throw new Error("LOCAL_CONFIGURATION_REQUIRED");
  return { url, key, email, userId: userId.toLowerCase() };
}

export function verifyIdentity(session, user, expectedId) {
  try {
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
    return user?.id?.toLowerCase() === expectedId && claims.sub?.toLowerCase() === expectedId &&
      claims.role === "mystery_operator" && claims.aud === "authenticated" &&
      Number.isFinite(claims.exp) && claims.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function approvalFor(ref, userId, now = Date.now()) {
  const binding = Object.freeze({ target: "local", projectRef: "local", ...ref, ruleSetId: rules.id });
  const approval = Object.freeze({
    binding,
    provenance: "owner:local",
    approvedBy: userId,
    approvalReference: `sha256:${ref.digestSha256}`,
    approvedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
  });
  return {
    target: "local",
    projectRef: "local",
    artifact: approval,
    async verify(artifact, requested) {
      return artifact === approval && Object.keys(binding).every((key) => binding[key] === requested[key])
        ? approval : null;
    },
  };
}

function passwordPrompt(input, output) {
  return new Promise((resolve) => {
    let password = "";
    output.write("Publisher password (not echoed): ");
    input.setRawMode(true);
    input.resume();
    const finish = (value) => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      resolve(value);
    };
    const onEnd = () => finish(null);
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003" || char === "\u0004") return finish(null);
        if (char === "\r" || char === "\n") return finish(password);
        if (char === "\u007f" || char === "\b") password = password.slice(0, -1);
        else if (char >= " ") password += char;
      }
    };
    input.on("data", onData);
    input.once("end", onEnd);
  });
}

function confirmPrompt(input, output) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    let answered = false;
    rl.once("close", () => { if (!answered) resolve(false); });
    rl.question("Type PUBLISH to approve this exact publication (anything else cancels): ", (answer) => {
      answered = true;
      rl.close();
      resolve(answer === "PUBLISH");
    });
  });
}

export function publicationStore(client, diagnostics) {
  return {
    async upload(path, bytes) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, {
        contentType: "application/json", upsert: false,
      });
      if (error) {
        diagnostics.phase = "upload";
        throw new Error("UPLOAD_FAILED");
      }
    },
    async download(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) {
        diagnostics.phase = "readback";
        throw new Error("READBACK_FAILED");
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async register(ref, path, rulesId, metadata) {
      const { data, error } = await client.rpc("publish_mystery_version", {
        p_mystery_id: ref.mysteryId, p_version: ref.version, p_schema_version: ref.schemaVersion,
        p_digest_sha256: ref.digestSha256, p_object_path: path, p_rule_set_id: rulesId,
        p_provenance: metadata.provenance, p_approved_by: metadata.approvedBy,
        p_approval_reference: metadata.approvalReference,
      });
      if (error || (data !== "published" && data !== "already_published")) {
        diagnostics.phase = "registration";
        const allowed = new Set(["22023", "23505", "23514", "42501", "PGRST301", "PGRST302"]);
        diagnostics.rpcCode = allowed.has(error?.code) ? error.code : "OTHER";
        throw new Error("REGISTRATION_FAILED");
      }
      return data;
    },
  };
}

export async function publish({ argv, env, input, output, makeClient = createClient,
  readPassword = passwordPrompt, confirm = confirmPrompt }) {
  if (argv.length !== 1) throw new Error("ABSOLUTE_INPUT_REQUIRED");
  const { input: definition, ref } = await readPackage(argv[0]);
  const config = localConfiguration(env);
  if (!input.isTTY || !output.isTTY) throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  const client = makeClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const password = await readPassword(input, output);
  if (!password) throw new Error("CANCELLED");
  const { data, error } = await client.auth.signInWithPassword({ email: config.email, password });
  if (error || !data?.session) throw new Error("AUTHENTICATION_FAILED");
  const verified = await client.auth.getUser(data.session.access_token);
  if (verified.error || !verifyIdentity(data.session, verified.data?.user, config.userId)) {
    throw new Error("PUBLISHER_IDENTITY_MISMATCH");
  }
  output.write(`Target: local (${localUrl}), project: local\nPublisher: ${config.userId}\n` +
    `Mystery: ${ref.mysteryId}\nVersion: ${ref.version}\nSchema: ${ref.schemaVersion}\n` +
    `Rule set: ${rules.id}\nSHA-256: ${ref.digestSha256}\n`);
  if (!await confirm(input, output)) throw new Error("CANCELLED");
  const diagnostics = {};
  const result = await publishMysteryDefinition(definition, rules, approvalFor(ref, config.userId),
    publicationStore(client, diagnostics));
  if (!result.ok) {
    const phase = result.code === "REGISTRATION_FAILED" ? "registration" :
      result.code === "READBACK_FAILED" || result.code === "READBACK_MISMATCH" ? "readback" :
        result.code === "OBJECT_WRITE_FAILED" || result.code === "OBJECT_CONFLICT" ? "upload" : "approval";
    output.write(`Phase: ${phase}${phase === "registration" ? `; RPC code: ${diagnostics.rpcCode || "OTHER"}` : ""}\n` +
      "No overwrite was attempted. Retry only with the identical package and target; investigate conflicts before proceeding.\n");
    throw new Error(result.code);
  }
  output.write(`${result.status}: ${ref.mysteryId}/${ref.version} sha256=${ref.digestSha256}\n`);
  await client.auth.signOut({ scope: "local" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  publish({ argv: process.argv.slice(2), env: process.env, input: process.stdin, output: process.stdout })
    .catch((error) => {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PUBLICATION_FAILED";
      console.error(code);
      process.exitCode = 1;
    });
}
