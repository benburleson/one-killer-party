import assert from "node:assert/strict";
import { test } from "node:test";
import { coherentGuestRevision } from "../../src/lib/lobby/core.ts";

const principal = "principal";
const pin = { schemaVersion: 1, digestSha256: "digest" };
const snapshot = {
  party_id: "party", principal_id: principal, participant_id: "member",
  assigned_character_id: "role-a", status: "LOBBY", party_version: 4,
  mystery_id: "mystery", mystery_version: "v1", schema_version: 1, digest_sha256: "digest",
};
const member = { ...snapshot };
const revision = (before, after, membership = member, checkedPin = pin) =>
  coherentGuestRevision(before, after, membership, principal, checkedPin);

test("projects only a coherent revision, including unassigned and legacy parties", () => {
  assert.equal(revision([snapshot], [snapshot]), 4);
  const unassigned = { ...snapshot, assigned_character_id: null };
  assert.equal(revision([unassigned], [unassigned], unassigned), 4);
  const legacy = { ...unassigned, schema_version: null, digest_sha256: null };
  assert.equal(revision([legacy], [legacy], legacy, { schemaVersion: null, digestSha256: null }), 4);
});

test("rejects membership, identity, assignment, phase, pin and revision races", () => {
  assert.equal(revision([], [snapshot]), null);
  assert.equal(revision([snapshot], []), null);
  for (const change of [
    { party_id: "other" }, { principal_id: "other" }, { participant_id: "other" },
    { assigned_character_id: "role-b" }, { status: "OTHER" }, { party_version: 6 },
    { mystery_id: "other" }, { mystery_version: "v2" }, { schema_version: 2 },
    { digest_sha256: "other" },
  ]) assert.equal(revision([snapshot], [{ ...snapshot, ...change }]), null);
  for (const change of [{ party_id: "other" }, { participant_id: "other" },
    { assigned_character_id: "role-b" }, { status: "OTHER" },
    { mystery_id: "other" }, { mystery_version: "v2" }]) {
    assert.equal(revision([snapshot], [snapshot], { ...member, ...change }), null);
  }
  assert.equal(revision([snapshot], [snapshot], member, { ...pin, digestSha256: "other" }), null);
  assert.equal(revision([{ ...snapshot, party_version: -1 }], [{ ...snapshot, party_version: -1 }]), null);
});
