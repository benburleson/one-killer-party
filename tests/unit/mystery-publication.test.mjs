import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Hex } from "../../src/lib/mystery-content/integrity.ts";
import { loadTrustedPublishedMystery } from "../../src/lib/mystery-content/trusted-loader-core.ts";
import { publishMysteryDefinition } from "../../src/lib/mystery-content/publication.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "../../src/lib/mystery-content/validate.ts";
import { syntheticMysteryPackage } from "./fixtures/synthetic-mystery-package.mjs";

const metadata = {
  provenance: "synthetic:unit-test",
  approvedBy: "test-operator",
  approvalReference: "issue-45",
};

function localAuthorization({
  bindingFor = (binding) => binding,
  approvedAt = new Date().toISOString(),
  expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  approvalMetadata = metadata,
  approved = true,
} = {}) {
  return {
    target: "local",
    projectRef: "local",
    artifact: { localTestApproval: true },
    async verify(_artifact, binding) {
      return approved ? {
        ...approvalMetadata,
        binding: bindingFor(binding),
        approvedAt,
        expiresAt,
      } : null;
    },
  };
}

function memoryStore() {
  const objects = new Map();
  const registry = new Map();
  return {
    objects,
    registry,
    async upload(path, bytes) {
      if (objects.has(path)) throw new Error("exists");
      objects.set(path, new Uint8Array(bytes));
    },
    async download(path) {
      if (!objects.has(path)) throw new Error("missing");
      return new Uint8Array(objects.get(path));
    },
    async register(ref, path, rulesId) {
      const key = `${ref.mysteryId}/${ref.version}`;
      const current = registry.get(key);
      if (current && (current.digest_sha256 !== ref.digestSha256 ||
          current.schema_version !== ref.schemaVersion || current.object_path !== path)) {
        throw new Error("conflict");
      }
      if (!current) registry.set(key, {
        mystery_id: ref.mysteryId,
        version: ref.version,
        schema_version: ref.schemaVersion,
        digest_sha256: ref.digestSha256,
        object_path: path,
        rule_set_id: rulesId,
      });
      return current ? "already_published" : "published";
    },
    async lookup(ref) {
      const current = registry.get(`${ref.mysteryId}/${ref.version}`);
      return current && current.schema_version === ref.schemaVersion &&
        current.digest_sha256 === ref.digestSha256 ? [current] : [];
    },
  };
}

test("publishes exact sealed bytes and independently loads only the registered reference", async () => {
  const store = memoryStore();
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-local";
  packageOne.version = "local-v1";
  const published = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store);
  assert.equal(published.ok, true);
  assert.equal(published.status, "published");

  const loaded = await loadTrustedPublishedMystery(published.ref, store);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.definition.solution.narrative.startsWith("SENTINEL-SOLUTION"), true);

  const retry = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store);
  assert.equal(retry.ok, true);
  assert.equal(retry.status, "already_published");
});

test("keeps a second immutable version independently loadable and rejects changed bytes under an existing version", async () => {
  const store = memoryStore();
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-local";
  packageOne.version = "local-v1";
  const first = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store);
  assert.equal(first.ok, true);

  const packageTwo = { ...packageOne, version: "local-v2" };
  const second = await publishMysteryDefinition(packageTwo, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store);
  assert.equal(second.ok, true);
  assert.equal((await loadTrustedPublishedMystery(first.ref, store)).ok, true);
  assert.equal((await loadTrustedPublishedMystery(second.ref, store)).ok, true);

  const conflicting = { ...packageOne, title: "Different synthetic title" };
  const conflict = await publishMysteryDefinition(conflicting, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store);
  assert.deepEqual(conflict, { ok: false, code: "REGISTRATION_FAILED" });
  assert.equal((await loadTrustedPublishedMystery(first.ref, store)).ok, true);
});

test("fails closed for missing, corrupt, mismatched, unpublished, and legacy references", async () => {
  const store = memoryStore();
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-local";
  packageOne.version = "local-v1";
  const published = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store);
  assert.equal(published.ok, true);

  const path = `${published.ref.mysteryId}/${published.ref.version}/${published.ref.digestSha256}.json`;
  const original = store.objects.get(path);
  store.objects.set(path, new Uint8Array([0x7b, 0x7d]));
  assert.deepEqual(await loadTrustedPublishedMystery(published.ref, store), {
    ok: false,
    code: "CONTENT_UNAVAILABLE",
  });
  store.objects.set(path, original);

  const mismatchedRecord = { ...store.registry.get("synthetic-local/local-v1"), rule_set_id: "unknown-rules" };
  const mismatch = await loadTrustedPublishedMystery(published.ref, {
    lookup: async () => [mismatchedRecord],
    download: store.download,
  });
  assert.deepEqual(mismatch, { ok: false, code: "CONTENT_UNAVAILABLE" });
  for (const mismatched of [
    { ...store.registry.get("synthetic-local/local-v1"), mystery_id: "another-mystery" },
    { ...store.registry.get("synthetic-local/local-v1"), object_path: "another-mystery/other-version/object.json" },
    { ...store.registry.get("synthetic-local/local-v1"), unexpected_field: "malformed" },
  ]) {
    assert.deepEqual(await loadTrustedPublishedMystery(published.ref, {
      lookup: async () => [mismatched],
      download: store.download,
    }), { ok: false, code: "CONTENT_UNAVAILABLE" });
  }

  assert.deepEqual(await loadTrustedPublishedMystery({ ...published.ref, digestSha256: "0".repeat(64) }, store), {
    ok: false,
    code: "CONTENT_UNAVAILABLE",
  });
  assert.deepEqual(await loadTrustedPublishedMystery(published.ref, {
    lookup: async () => [],
    download: store.download,
  }), { ok: false, code: "CONTENT_UNAVAILABLE" });
  assert.deepEqual(await loadTrustedPublishedMystery(published.ref, {
    lookup: store.lookup,
    download: async () => { throw new Error("storage details"); },
  }), { ok: false, code: "CONTENT_UNAVAILABLE" });
  assert.deepEqual(await loadTrustedPublishedMystery({ ...published.ref, schemaVersion: 2 }, store), {
    ok: false,
    code: "CONTENT_UNAVAILABLE",
  });
  assert.deepEqual(await loadTrustedPublishedMystery({
    mysteryId: "blackwood-affair",
    version: "first-playtest-placeholder-v1",
    schemaVersion: 1,
    digestSha256: "0".repeat(64),
  }, store), { ok: false, code: "CONTENT_UNAVAILABLE" });
});

test("failed read-back or registration leaves an inaccessible orphan and reports no payload", async () => {
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-orphan";
  packageOne.version = "local-v1";
  const objects = new Map();
  const orphanStore = {
    async upload(path, bytes) {
      objects.set(path, new Uint8Array(bytes));
    },
    async download(path) {
      return objects.get(path);
    },
    async register() {
      throw new Error("private provider details");
    },
    async lookup() {
      return [];
    },
  };
  const result = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), orphanStore);
  assert.deepEqual(result, { ok: false, code: "REGISTRATION_FAILED" });
  assert.equal(objects.size, 1);
  assert.deepEqual(await loadTrustedPublishedMystery({
    mysteryId: "synthetic-orphan",
    version: "local-v1",
    schemaVersion: 1,
    digestSha256: sha256Hex([...objects.values()][0]),
  }, orphanStore), { ok: false, code: "CONTENT_UNAVAILABLE" });
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL|private provider details/);
});

test("does not replace conflicting object bytes and requires explicit non-secret approval metadata", async () => {
  const store = memoryStore();
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-local";
  packageOne.version = "local-v1";
  const result = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization({
    approvalMetadata: { ...metadata, approvalReference: "contains secret data" },
  }), store);
  assert.deepEqual(result, { ok: false, code: "INVALID_APPROVAL" });
  assert.equal(store.objects.size, 0);

  const valid = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store);
  assert.equal(valid.ok, true);
  const path = `${valid.ref.mysteryId}/${valid.ref.version}/${valid.ref.digestSha256}.json`;
  store.objects.set(path, new Uint8Array([1, 2, 3]));
  assert.deepEqual(await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), store), {
    ok: false,
    code: "OBJECT_CONFLICT",
  });
});

test("does not register an object whose independent read-back differs from the sealed bytes", async () => {
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-corrupt";
  packageOne.version = "local-v1";
  let registered = false;
  const result = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, localAuthorization(), {
    async upload() {},
    async download() {
      return new Uint8Array([0x7b, 0x7d]);
    },
    async register() {
      registered = true;
      return "published";
    },
  });
  assert.deepEqual(result, { ok: false, code: "READBACK_MISMATCH" });
  assert.equal(registered, false);
});

test("requires a fresh, exact-bound verifier result and rejects revoked or untrusted issuers", async () => {
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-approval";
  packageOne.version = "local-v1";

  for (const authorization of [
    localAuthorization({ approved: false }),
    localAuthorization({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    localAuthorization({ approvedAt: new Date(Date.now() + 60_000).toISOString() }),
    {
      target: "local",
      projectRef: "local",
      artifact: { issuer: "untrusted-issuer" },
      async verify(artifact) {
        return artifact.issuer === "owner-approved-issuer" ? {} : null;
      },
    },
    {
      target: "local",
      projectRef: "local",
      artifact: {},
      async verify(_artifact, binding) {
        return {
          ...metadata,
          binding,
          approvedAt: { toString() { throw new Error("raw approval details"); } },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
    localAuthorization({
      bindingFor: (binding) => ({ ...binding, target: "production" }),
    }),
    localAuthorization({
      bindingFor: (binding) => ({ ...binding, projectRef: "different-project" }),
    }),
    localAuthorization({
      bindingFor: (binding) => ({ ...binding, digestSha256: "0".repeat(64) }),
    }),
    localAuthorization({
      bindingFor: (binding) => ({ ...binding, ruleSetId: "unsupported-rules" }),
    }),
    {
      target: "local",
      projectRef: "local",
      artifact: {},
      async verify() {
        throw new Error("raw provider details and secret");
      },
    },
  ]) {
    const store = memoryStore();
    const result = await publishMysteryDefinition(
      packageOne,
      EIGHT_ROLE_PROTOTYPE_RULES,
      authorization,
      store,
    );
    assert.deepEqual(result, { ok: false, code: "INVALID_APPROVAL" });
    assert.doesNotMatch(JSON.stringify(result), /raw approval details|untrusted-issuer/);
    assert.equal(store.objects.size, 0);
    assert.equal(store.registry.size, 0);
  }
});

test("rechecks approval before registration so mid-publication revocation leaves only an orphan", async () => {
  const packageOne = syntheticMysteryPackage();
  packageOne.mysteryId = "synthetic-revoked";
  packageOne.version = "local-v1";
  const approvedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  let checks = 0;
  const store = memoryStore();
  const result = await publishMysteryDefinition(packageOne, EIGHT_ROLE_PROTOTYPE_RULES, {
    target: "local",
    projectRef: "local",
    artifact: { approvalId: "synthetic-approval" },
    async verify(_artifact, binding) {
      checks += 1;
      return checks === 1 ? {
        ...metadata,
        binding,
        approvedAt,
        expiresAt,
      } : null;
    },
  }, store);

  assert.deepEqual(result, { ok: false, code: "INVALID_APPROVAL" });
  assert.equal(checks, 2);
  assert.equal(store.objects.size, 1);
  assert.equal(store.registry.size, 0);
});
