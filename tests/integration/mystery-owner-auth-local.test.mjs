import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { publish } from "../../scripts/mystery-publish.mjs";
import { sealMysteryDefinition } from "../../src/lib/mystery-content/integrity.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";
import { syntheticMysteryPackage } from "../unit/fixtures/synthetic-mystery-package.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bucket = "private-mystery-packages";
const options = { auth: { persistSession: false, autoRefreshToken: false } };

function sql(query) {
  execFileSync("docker", ["exec", "-i", "supabase_db_one-killer-party", "psql", "-U", "postgres",
    "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, stdio: ["pipe", "ignore", "ignore"] });
}

test("Auth hook publisher, orphan retry, and private storage boundaries", async (t) => {
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }));
  assert.equal(status.API_URL, "http://127.0.0.1:54321");
  sql(`DO $$ BEGIN
    IF NOT pg_catalog.pg_has_role('authenticator', 'mystery_operator', 'MEMBER')
      OR NOT pg_catalog.has_function_privilege('supabase_auth_admin', 'private_mystery.local_mystery_publisher_hook(jsonb)', 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', 'private_mystery.local_mystery_publisher_hook(jsonb)', 'EXECUTE')
      OR pg_catalog.has_table_privilege('authenticated', 'private_mystery.local_publisher_identity', 'SELECT')
    THEN RAISE EXCEPTION 'hook privileges invalid'; END IF;
  END $$;`);
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const suffix = randomBytes(8).toString("hex");
  const password = randomBytes(24).toString("base64url");
  const email = `publisher-${suffix}@example.invalid`;
  const otherEmail = `other-${suffix}@example.invalid`;
  const otherBucket = `synthetic-other-${suffix}`;
  assert.equal((await admin.storage.createBucket(otherBucket, { public: false })).error, null);
  t.after(async () => { await admin.storage.deleteBucket(otherBucket); });
  const owner = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const other = await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true,
    user_metadata: { role: "mystery_operator" } });
  assert.ok(owner.data.user && other.data.user && !owner.error && !other.error);
  const id = owner.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  t.after(async () => {
    sql(`DELETE FROM private_mystery.local_publisher_identity WHERE user_id = '${id}';`);
    await admin.auth.admin.deleteUser(id);
    await admin.auth.admin.deleteUser(other.data.user.id);
  });
  sql(`INSERT INTO private_mystery.local_publisher_identity(user_id) VALUES ('${id}');`);

  const operator = createClient(status.API_URL, status.ANON_KEY, options);
  const login = await operator.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null);
  const claims = JSON.parse(Buffer.from(login.data.session.access_token.split(".")[1], "base64url").toString());
  assert.equal(claims.sub, id);
  assert.equal(claims.role, "mystery_operator");
  const ordinary = createClient(status.API_URL, status.ANON_KEY, options);
  const ordinaryLogin = await ordinary.auth.signInWithPassword({ email: otherEmail, password });
  assert.equal(ordinaryLogin.error, null);
  const ordinaryClaims = JSON.parse(Buffer.from(ordinaryLogin.data.session.access_token.split(".")[1], "base64url").toString());
  assert.equal(ordinaryClaims.role, "authenticated");

  const definition = syntheticMysteryPackage();
  definition.mysteryId = `synthetic-${suffix}`;
  const sealed = sealMysteryDefinition(definition, EIGHT_ROLE_PROTOTYPE_RULES);
  assert.equal(sealed.ok, true);
  const path = `${sealed.ref.mysteryId}/${sealed.ref.version}/${sealed.ref.digestSha256}.json`;
  const orphan = await operator.storage.from(bucket).upload(path, sealed.bytes, { contentType: "application/json" });
  assert.equal(orphan.error, null);

  const dir = await mkdtemp(join(tmpdir(), "owner-auth-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = join(dir, "synthetic.json");
  await writeFile(filename, JSON.stringify(definition), { mode: 0o600 });
  let output = "";
  const args = { argv: [filename], env: { SUPABASE_URL: status.API_URL, SUPABASE_ANON_KEY: status.ANON_KEY,
    MYSTERY_PUBLISHER_EMAIL: email, MYSTERY_PUBLISHER_USER_ID: id },
  input: { isTTY: true }, output: { isTTY: true, write: (s) => { output += s; } },
  readPassword: async () => password, confirm: async () => true };
  await publish(args);
  await publish(args);
  assert.match(output, /published:/);
  assert.match(output, /already_published:/);
  assert.doesNotMatch(output, /SENTINEL|password|access_token/);
  const readback = await operator.storage.from(bucket).download(path);
  assert.equal(readback.error, null);
  assert.deepEqual(new Uint8Array(await readback.data.arrayBuffer()), sealed.bytes);
  const params = { p_mystery_id: sealed.ref.mysteryId, p_version: sealed.ref.version,
    p_schema_version: sealed.ref.schemaVersion, p_digest_sha256: sealed.ref.digestSha256 };
  const lookup = await operator.rpc("get_published_mystery", params);
  assert.equal(lookup.error, null);
  assert.equal(lookup.data.length, 1);
  assert.ok((await operator.storage.from(bucket).upload(path, new Uint8Array([1]), { upsert: true })).error);
  assert.ok((await operator.storage.from(bucket).remove([path])).error);
  assert.ok((await operator.storage.listBuckets()).error);
  const otherList = await operator.storage.from(otherBucket).list();
  assert.ok(otherList.error || otherList.data.length === 0);
  for (const client of [createClient(status.API_URL, status.ANON_KEY, options), ordinary]) {
    const listed = await client.storage.from(bucket).list(sealed.ref.mysteryId);
    assert.equal(listed.error, null);
    assert.equal(listed.data.length, 0);
    assert.ok((await client.storage.from(bucket).download(path)).error);
    assert.ok((await client.storage.from(bucket).upload(`${suffix}/denied.json`, new Uint8Array([1]))).error);
    assert.ok((await client.rpc("get_published_mystery", params)).error);
    assert.ok((await client.rpc("publish_mystery_version", { ...params, p_object_path: path,
      p_rule_set_id: EIGHT_ROLE_PROTOTYPE_RULES.id, p_provenance: "test",
      p_approved_by: "test", p_approval_reference: "test" })).error);
  }
  const changed = { ...definition, title: "Different synthetic title" };
  await writeFile(filename, JSON.stringify(changed), { mode: 0o600 });
  await assert.rejects(publish(args), /REGISTRATION_FAILED/);
  assert.match(output, /RPC code: 23505/);
});
