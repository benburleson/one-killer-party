import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { test } from "node:test";
import { sealMysteryDefinition } from "../../src/lib/mystery-content/integrity.ts";
import { loadTrustedPublishedMystery } from "../../src/lib/mystery-content/trusted-loader-core.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";
import { syntheticMysteryPackage } from "../unit/fixtures/synthetic-mystery-package.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bucket = "private-mystery-packages";
const metadata = {
  provenance: "synthetic:local-integration",
  approvedBy: "local-test-operator",
  approvalReference: "issue-45",
};

function localStatus() {
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }));
  assert.equal(status.API_URL, "http://127.0.0.1:54321");
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY && status.JWT_SECRET);
  return status;
}

function operatorToken(secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: now + 300,
    iat: now,
    iss: "supabase",
    role: "mystery_operator",
    sub: "00000000-0000-4000-8000-000000000001",
  })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

function runPublisher(inputPath, status) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--experimental-strip-types",
      "scripts/publish-mystery.mjs",
      "--target", "local",
      "--input", inputPath,
      "--provenance", metadata.provenance,
      "--approved-by", metadata.approvedBy,
      "--approval-reference", metadata.approvalReference,
      "--confirm-approval",
    ], {
      cwd: root,
      env: {
        ...process.env,
        SUPABASE_URL: status.API_URL,
        SUPABASE_ANON_KEY: status.ANON_KEY,
        SUPABASE_JWT_SECRET: status.JWT_SECRET,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("local operator publication, exact loading, retries and browser storage denial", async (t) => {
  const status = localStatus();
  const temp = await mkdtemp(join(tmpdir(), "mystery-storage-"));
  t.after(() => rm(temp, { recursive: true, force: true }));

  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-local";
  packageOne.version = "local-v1";
  const inputOne = join(temp, "package-one.json");
  await writeFile(inputOne, JSON.stringify(packageOne), { mode: 0o600 });

  const attempts = await Promise.all([
    runPublisher(inputOne, status),
    runPublisher(inputOne, status),
  ]);
  for (const attempt of attempts) {
    assert.equal(attempt.code, 0, attempt.stderr);
    assert.doesNotMatch(attempt.stdout + attempt.stderr, /SENTINEL/);
  }
  assert.ok(attempts.every(({ stdout }) => /^(published|already_published): synthetic-local\/local-v1 /m.test(stdout)));

  const runtime = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const store = {
    async lookup(ref) {
      const { data, error } = await runtime.rpc("get_published_mystery", {
        p_mystery_id: ref.mysteryId,
        p_version: ref.version,
        p_schema_version: ref.schemaVersion,
        p_digest_sha256: ref.digestSha256,
      });
      if (error) throw new Error("lookup failed");
      return data;
    },
    async download(path) {
      const { data, error } = await runtime.storage.from(bucket).download(path);
      if (error || !data) throw new Error("download failed");
      return new Uint8Array(await data.arrayBuffer());
    },
  };
  const firstRef = sealMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES).ref;
  assert.equal((await loadTrustedPublishedMystery(firstRef, store)).ok, true);

  const packageTwo = { ...packageOne, version: "local-v2" };
  const inputTwo = join(temp, "package-two.json");
  await writeFile(inputTwo, JSON.stringify(packageTwo), { mode: 0o600 });
  const secondPublication = await runPublisher(inputTwo, status);
  assert.equal(secondPublication.code, 0, secondPublication.stderr);
  const secondRef = sealMysteryDefinition(packageTwo, EIGHT_ROLE_PROTOTYPE_RULES).ref;
  assert.equal((await loadTrustedPublishedMystery(firstRef, store)).ok, true);
  assert.equal((await loadTrustedPublishedMystery(secondRef, store)).ok, true);

  const changedPackage = { ...packageOne, title: "Another synthetic title" };
  const changedPath = join(temp, "changed-package.json");
  await writeFile(changedPath, JSON.stringify(changedPackage), { mode: 0o600 });
  const conflict = await runPublisher(changedPath, status);
  assert.notEqual(conflict.code, 0);
  assert.match(conflict.stderr, /REGISTRATION_FAILED/);
  assert.doesNotMatch(conflict.stdout + conflict.stderr, /SENTINEL/);
  const changedRef = sealMysteryDefinition(changedPackage, EIGHT_ROLE_PROTOTYPE_RULES).ref;
  assert.deepEqual(await loadTrustedPublishedMystery(changedRef, store), {
    ok: false,
    code: "CONTENT_UNAVAILABLE",
  });
  assert.equal((await loadTrustedPublishedMystery(firstRef, store)).ok, true);

  const path = `${firstRef.mysteryId}/${firstRef.version}/${firstRef.digestSha256}.json`;
  const operator = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + operatorToken(status.JWT_SECRET) } },
  });
  const operatorBuckets = await operator.storage.listBuckets();
  assert.ok(operatorBuckets.error);
  const overwrite = await operator.storage.from(bucket).upload(path, new Uint8Array([1, 2, 3]), {
    contentType: "application/json",
    upsert: true,
  });
  assert.ok(overwrite.error);
  const operatorDelete = await operator.storage.from(bucket).remove([path]);
  assert.ok(operatorDelete.error);
  const runtimeOverwrite = await runtime.storage.from(bucket).upload(path, new Uint8Array([1, 2, 3]), {
    contentType: "application/json",
    upsert: true,
  });
  assert.ok(runtimeOverwrite.error);
  const runtimeDelete = await runtime.storage.from(bucket).remove([path]);
  assert.ok(runtimeDelete.error);
  const runtimePublish = await runtime.rpc("publish_mystery_version", {
    p_mystery_id: firstRef.mysteryId,
    p_version: firstRef.version,
    p_schema_version: firstRef.schemaVersion,
    p_digest_sha256: firstRef.digestSha256,
    p_object_path: path,
    p_rule_set_id: EIGHT_ROLE_PROTOTYPE_RULES.id,
    p_provenance: metadata.provenance,
    p_approved_by: metadata.approvedBy,
    p_approval_reference: metadata.approvalReference,
  });
  assert.ok(runtimePublish.error);
  assert.equal((await loadTrustedPublishedMystery(firstRef, store)).ok, true);

  const browser = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonymousBuckets = await browser.storage.listBuckets();
  assert.ok(anonymousBuckets.error ||
    !anonymousBuckets.data?.some(({ name }) => name === bucket));
  const anonymousAttempts = [
    browser.storage.from(bucket).list("synthetic-local"),
    browser.storage.from(bucket).download(path),
    browser.storage.from(bucket).upload("browser-attempt/blocked.json", new Uint8Array([1]), {
      contentType: "application/json",
    }),
    browser.storage.from(bucket).update(path, new Uint8Array([1]), { contentType: "application/json" }),
    browser.storage.from(bucket).remove([path]),
  ];
  const anonymousResults = await Promise.all(anonymousAttempts);
  assert.deepEqual(anonymousResults.map(({ error }) => Boolean(error)), [false, true, true, true, false]);
  assert.equal(anonymousResults[0].data.length, 0);
  assert.deepEqual(anonymousResults[4].data, []);
  const anonymousSignIn = await browser.auth.signInAnonymously();
  assert.equal(anonymousSignIn.error, null);
  const authenticatedBuckets = await browser.storage.listBuckets();
  assert.ok(authenticatedBuckets.error ||
    !authenticatedBuckets.data?.some(({ name }) => name === bucket));
  const authenticatedResults = await Promise.all([
    browser.storage.from(bucket).list("synthetic-local"),
    browser.storage.from(bucket).download(path),
    browser.storage.from(bucket).upload("browser-attempt/blocked-authenticated.json", new Uint8Array([1]), {
      contentType: "application/json",
    }),
    browser.storage.from(bucket).update(path, new Uint8Array([1]), { contentType: "application/json" }),
    browser.storage.from(bucket).remove([path]),
  ]);
  assert.deepEqual(authenticatedResults.map(({ error }) => Boolean(error)), [false, true, true, true, false]);
  assert.equal(authenticatedResults[0].data.length, 0);
  assert.deepEqual(authenticatedResults[4].data, []);

  const publishedBytes = await runtime.storage.from(bucket).download(path);
  assert.equal(publishedBytes.error, null);
  assert.equal((await loadTrustedPublishedMystery(firstRef, store)).ok, true);
  const serializedResponse = JSON.stringify({
    anonymous: anonymousResults.map(({ error }) => error?.status),
    authenticated: authenticatedResults.map(({ error }) => error?.status),
    operator: attempts.map(({ stdout }) => stdout),
  });
  assert.doesNotMatch(serializedResponse, /SENTINEL|private-item|solution narrative/i);
});
