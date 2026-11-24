import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { approvalFor, localConfiguration, publicationStore, publish, readPackage, verifyIdentity } from "../../scripts/mystery-publish.mjs";
import { syntheticMysteryPackage } from "./fixtures/synthetic-mystery-package.mjs";
import { publishMysteryDefinition } from "../../src/lib/mystery-content/publication.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";

const userId = "12345678-1234-4234-8234-123456789abc";
const env = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "local-key",
  MYSTERY_PUBLISHER_EMAIL: "owner@example.invalid", MYSTERY_PUBLISHER_USER_ID: userId };
const token = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const session = (overrides = {}) => ({ access_token: token({ sub: userId, aud: "authenticated",
  role: "mystery_operator", exp: Math.floor(Date.now() / 1000) + 60, ...overrides }) });

test("local target and authenticated identity fail closed", () => {
  assert.equal(localConfiguration(env).userId, userId);
  for (const url of ["https://example.invalid", "http://localhost:54321", "http://127.0.0.1:54321/"]) {
    assert.throws(() => localConfiguration({ ...env, SUPABASE_URL: url }), /LOCAL_CONFIGURATION_REQUIRED/);
  }
  assert.equal(verifyIdentity(session(), { id: userId }, userId), true);
  for (const claims of [{ role: "authenticated" }, { sub: "wrong" }, { aud: "anon" }, { exp: 1 }]) {
    assert.equal(verifyIdentity(session(claims), { id: userId }, userId), false);
  }
  assert.equal(verifyIdentity(session(), { id: "other" }, userId), false);
  assert.equal(verifyIdentity({ access_token: "bad" }, { id: userId }, userId), false);
});

test("input must resolve outside repository and validate without disclosure", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "owner-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "package.json");
  await writeFile(path, JSON.stringify(syntheticMysteryPackage()));
  assert.equal((await readPackage(path)).ref.schemaVersion, 1);
  await assert.rejects(readPackage("~/package.json"), /EXPAND_TILDE_IN_SHELL/);
  await symlink(new URL("../../package.json", import.meta.url).pathname, join(dir, "inside.json"));
  await assert.rejects(readPackage(join(dir, "inside.json")), /INPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  await writeFile(path, '{"private":"SENTINEL"}');
  await assert.rejects(readPackage(path), /INVALID_PACKAGE/);
});

test("cancel, EOF and authentication failure never write", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "owner-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "package.json");
  await writeFile(path, JSON.stringify(syntheticMysteryPackage()));
  let writes = 0;
  let text = "";
  const output = { isTTY: true, write: (s) => { text += s; } };
  const client = {
    auth: {
      signInWithPassword: async () => ({ data: { session: session() }, error: null }),
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    storage: { from: () => { writes++; } },
  };
  const options = { argv: [path], env, input: { isTTY: true }, output,
    makeClient: () => client, readPassword: async () => "password", confirm: async () => false };
  await assert.rejects(publish(options), /CANCELLED/);
  await assert.rejects(publish({ ...options, readPassword: async () => null }), /CANCELLED/);
  client.auth.signInWithPassword = async () => ({ error: { message: "private secret" } });
  await assert.rejects(publish(options), /AUTHENTICATION_FAILED/);
  assert.equal(writes, 0);
  assert.doesNotMatch(text, /SENTINEL|password|private secret/);
});

test("approval is bound to the displayed digest, version and expiry", async () => {
  const definition = syntheticMysteryPackage();
  const ref = (await import("../../src/lib/mystery-content/integrity.ts")).sealMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES).ref;
  const approval = approvalFor(ref, userId);
  const neverWrite = { upload: async () => assert.fail("unexpected write") };
  const changed = { ...definition, version: "different-v1" };
  assert.deepEqual(await publishMysteryDefinition(changed, EIGHT_ROLE_PROTOTYPE_RULES, approval, neverWrite),
    { ok: false, code: "INVALID_APPROVAL" });
  assert.deepEqual(await publishMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES,
    approvalFor(ref, userId, Date.now() - 6 * 60 * 1000), neverWrite),
  { ok: false, code: "INVALID_APPROVAL" });
});

test("registration diagnostics expose only allowlisted codes", async () => {
  const diagnostics = {};
  const client = { rpc: async () => ({ error: { code: "23505", message: "SENTINEL" } }) };
  const store = publicationStore(client, diagnostics);
  await assert.rejects(store.register({}, "path", "rules", {}), /REGISTRATION_FAILED/);
  assert.deepEqual(diagnostics, { phase: "registration", rpcCode: "23505" });
  client.rpc = async () => ({ error: { code: "SENTINEL", message: "SENTINEL" } });
  await assert.rejects(store.register({}, "path", "rules", {}), /REGISTRATION_FAILED/);
  assert.deepEqual(diagnostics, { phase: "registration", rpcCode: "OTHER" });
});
