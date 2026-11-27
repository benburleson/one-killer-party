import assert from "node:assert/strict";
import { test } from "node:test";
import { getOwnDossier } from "../../src/lib/mystery-content/dossier-core.ts";
import { dossierMethodResponse, dossierRequest } from "../../src/lib/mystery-content/dossier-request.ts";
import { syntheticMysteryPackage, SYNTHETIC_SENTINELS as S } from "./fixtures/synthetic-mystery-package.mjs";

const partyId = "10000000-0000-4000-8000-000000000001";
const principalId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const participantId = "10000000-0000-4000-8000-000000000004";
const pin = { mysteryId: "synthetic-mystery", version: "1.0.0-test.1", schemaVersion: 1, digestSha256: "a".repeat(64) };
const row = () => ({
  party_id: partyId, principal_id: principalId, participant_id: participantId,
  assigned_character_id: "role-3", status: "LOBBY", party_version: 12,
  mystery_id: pin.mysteryId, mystery_version: pin.version,
  schema_version: pin.schemaVersion, digest_sha256: pin.digestSha256,
});
const identity = () => ({ principalId, sessionId });
const dependencies = (overrides = {}) => ({
  identity: async () => identity(),
  snapshot: async () => [row()],
  load: async () => ({ ok: true, definition: syntheticMysteryPackage() }),
  ...overrides,
});

test("projects only the assigned dossier, including for the murderer", async () => {
  for (let i = 1; i <= 8; i++) {
    const result = await getOwnDossier(partyId, dependencies({
      snapshot: async () => [{ ...row(), assigned_character_id: `role-${i}` }],
    }));
    assert.deepEqual(result, {
      character: { id: `role-${i}`, publicName: `Test Role ${i}`,
        archetype: `Placeholder Archetype ${i}`, description: `Public placeholder description ${i}.` },
      biography: `${S.dossier}-${i} placeholder biography.`,
      relationships: [{ characterId: `role-${i % 8 + 1}`, publicName: `Test Role ${i % 8 + 1}`,
        perspective: `${S.dossier}-${i} placeholder perspective.` }],
      interpersonalPrompts: [`${S.dossier}-${i} placeholder prompt.`],
    });
    const serialized = JSON.stringify(result);
    for (let other = 1; other <= 8; other++) {
      if (other !== i) assert.ok(!serialized.includes(`${S.dossier}-${other}`));
    }
    for (const forbidden of [S.briefing, S.item, S.objective, S.solution, "digestSha256",
      "object_path", "Placeholder announcement", "culpritCharacterId"]) {
      assert.ok(!serialized.includes(forbidden));
    }
  }
});

test("denies invalid inputs, authentication, snapshots and loader errors before disclosure", async () => {
  let loads = 0;
  const load = async () => { loads++; throw Error("private"); };
  assert.equal(await getOwnDossier("bad", dependencies({ load })), null);
  for (const badIdentity of [null, { principalId: "bad", sessionId }, { principalId, sessionId: "bad" }]) {
    assert.equal(await getOwnDossier(partyId, dependencies({ identity: async () => badIdentity, load })), null);
  }
  const invalidRows = [
    [], [row(), row()], null, [null], [{ ...row(), party_id: participantId }],
    [{ ...row(), principal_id: participantId }], [{ ...row(), participant_id: "bad" }],
    [{ ...row(), assigned_character_id: null }], [{ ...row(), assigned_character_id: "bad id" }],
    [{ ...row(), status: "ACT_1" }], [{ ...row(), party_version: -1 }],
    [{ ...row(), party_version: 1.5 }], [{ ...row(), schema_version: null }],
    [{ ...row(), digest_sha256: null }],
  ];
  for (const bad of invalidRows) {
    assert.equal(await getOwnDossier(partyId, dependencies({ snapshot: async () => bad, load })), null);
  }
  assert.equal(loads, 0);
  for (const override of [
    { load }, { load: async () => ({ ok: false, code: "CONTENT_UNAVAILABLE" }) },
    { snapshot: async () => { throw Error("private"); } },
    { identity: async () => { throw Error("private"); } },
    { snapshot: async () => [{ ...row(), assigned_character_id: "unknown-role" }] },
  ]) assert.equal(await getOwnDossier(partyId, dependencies(override)), null);
});

test("uses the immutable party pin, not active state", async () => {
  let actualPin;
  const result = await getOwnDossier(partyId, dependencies({
    load: async (ref) => {
      actualPin = ref;
      return { ok: true, definition: syntheticMysteryPackage() };
    },
  }));
  assert.deepEqual(actualPin, pin);
  assert.ok(result);
});

test("canonicalizes a valid uppercase party UUID before both snapshot reads", async () => {
  const letterPartyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const seen = [];
  const result = await getOwnDossier(letterPartyId.toUpperCase(), dependencies({
    snapshot: async (id) => {
      seen.push(id);
      return [{ ...row(), party_id: letterPartyId }];
    },
  }));
  assert.ok(result);
  assert.deepEqual(seen, [letterPartyId, letterPartyId]);
});

test("request boundary protects origin, handles errors generically and never caches", async () => {
  const projection = await getOwnDossier(partyId, dependencies());
  const params = Promise.resolve({ partyId });
  let calls = 0;
  const getDossier = async () => { calls++; return projection; };
  const success = await dossierRequest(params, { sameOrigin: async () => true, getDossier });
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { dossier: projection });
  const denied = await dossierRequest(params, { sameOrigin: async () => false, getDossier });
  assert.equal(denied.status, 403);
  assert.equal(calls, 1);
  const missing = await dossierRequest(params, { sameOrigin: async () => true, getDossier: async () => null });
  const failed = await dossierRequest(params, {
    sameOrigin: async () => true, getDossier: async () => { throw Error("secret exception"); },
  });
  const originError = await dossierRequest(params, { sameOrigin: async () => { throw Error("secret"); }, getDossier });
  for (const response of [denied, missing, failed, originError]) {
    assert.deepEqual(await response.json(), { error: "Dossier unavailable" });
    assert.equal(response.status, response === denied ? 403 : 404);
  }
  const otherMethod = dossierMethodResponse();
  const options = dossierMethodResponse(true);
  assert.equal(otherMethod.status, 405);
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("allow"), "POST, OPTIONS");
  for (const response of [success, denied, missing, failed, originError, otherMethod, options]) {
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }
});

test("deferred loading fails closed on authorization and pin races", async () => {
  const cases = [
    { name: "reassignment", after: { ...row(), assigned_character_id: "role-4" } },
    { name: "unassignment", after: { ...row(), assigned_character_id: null } },
    { name: "removal", after: null },
    { name: "recovery", after: { ...row(), principal_id: participantId } },
    { name: "participant replacement", after: { ...row(), participant_id: sessionId } },
    { name: "phase", after: { ...row(), status: "ACT_1" } },
    { name: "version", after: { ...row(), party_version: 13 } },
    ...["mystery_id", "mystery_version", "schema_version", "digest_sha256"].map((key) => ({
      name: key, after: { ...row(), [key]: key === "schema_version" ? 2 : key === "digest_sha256" ? "b".repeat(64) : "changed" },
    })),
    { name: "principal", afterIdentity: { principalId: participantId, sessionId } },
    { name: "session", afterIdentity: { principalId, sessionId: participantId } },
    { name: "session lost", afterIdentity: null },
    { name: "lookup failure", lookupError: true },
  ];
  for (const scenario of cases) {
    let release, started;
    const ready = new Promise((resolve) => { started = resolve; });
    const wait = new Promise((resolve) => { release = resolve; });
    let snapshots = 0, identities = 0;
    const result = getOwnDossier(partyId, dependencies({
      identity: async () => ++identities === 1 ? identity() :
        ("afterIdentity" in scenario ? scenario.afterIdentity : identity()),
      snapshot: async () => {
        if (++snapshots === 1) return [row()];
        if (scenario.lookupError) throw Error("private");
        return "after" in scenario ? (scenario.after ? [scenario.after] : []) : [row()];
      },
      load: async () => { started(); await wait; return { ok: true, definition: syntheticMysteryPackage() }; },
    }));
    await ready;
    release();
    assert.equal(await result, null, scenario.name);
  }
});
