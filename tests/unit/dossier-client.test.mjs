import assert from "node:assert/strict";
import { test } from "node:test";
import { DossierLifecycle, DossierRequest, parseDossier, dossierContextKey, membershipContextKey, syncIdentityChanged, hostVersionMatches } from "../../src/app/dossier-client.ts";

const projection = {
  character: { id: "role-1", publicName: "Role", archetype: "Archetype", description: "Public" },
  biography: "Private biography",
  relationships: [{ characterId: "role-2", publicName: "Other", perspective: "Private perspective" }],
  interpersonalPrompts: ["Private prompt"],
};

test("validates the assigned character and entire projection, discarding extra data", () => {
  assert.deepEqual(parseDossier({ dossier: { ...projection, secret: "not projected" } }, "role-1"), projection);
  assert.equal(parseDossier({ dossier: projection }, "role-2"), null);
  assert.equal(parseDossier({ dossier: { ...projection, relationships: [{}] } }, "role-1"), null);
  assert.equal(parseDossier({ dossier: { ...projection, interpersonalPrompts: [null] } }, "role-1"), null);
  assert.equal(parseDossier({}, "role-1"), null);
});

test("requests privately and invalidates deferred responses even if fetch ignores abort", async () => {
  const request = new DossierRequest();
  let release, options;
  const pending = request.open("party", "role-1", async (url, init) => {
    assert.equal(url, "/api/lobby/party/dossier");
    options = init;
    await new Promise((resolve) => { release = resolve; });
    return Response.json({ dossier: projection });
  });
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  request.invalidate();
  assert.equal(options.signal.aborted, true);
  release();
  assert.equal(await pending, null);
  assert.deepEqual(await request.open("party", "role-1", async () => Response.json({ dossier: projection })), projection);
  assert.equal(await request.open("party", "role-2", async () => Response.json({ dossier: projection })), null);
  assert.equal(await request.open("party", "role-1", async () => new Response(null, { status: 404 })), null);
});

test("a later deliberate request supersedes a pending one", async () => {
  const request = new DossierRequest();
  let release;
  const first = request.open("party", "role-1", async () => {
    await new Promise((resolve) => { release = resolve; });
    return Response.json({ dossier: projection });
  });
  const second = await request.open("party", "role-1", async () => Response.json({ dossier: projection }));
  release();
  assert.deepEqual(second, projection);
  assert.equal(await first, null);
});

test("suspension aborts and retains open intent until reconciled; context changes and unmount close it", async () => {
  for (const reason of ["failed sync", "hidden", "offline", "pagehide", "pageshow", "popstate"]) {
    const lifecycle = new DossierLifecycle();
    const generation = lifecycle.begin();
    let release, signal;
    const pending = lifecycle.request.open("party", "role-1", async (_url, init) => {
      signal = init.signal;
      await new Promise((resolve) => { release = resolve; });
      return Response.json({ dossier: projection });
    });
    assert.equal(lifecycle.suspend(), true, reason);
    assert.equal(signal.aborted, true, reason);
    assert.equal(lifecycle.isCurrent(generation), false, reason);
    assert.equal(lifecycle.shouldResume(), true, reason);
    release();
    assert.equal(await pending, null, reason);
    lifecycle.begin();
    assert.equal(lifecycle.shouldResume(), false, reason);
  }
  for (const reason of ["party", "session", "membership", "assignment", "host version", "close", "unmount"]) {
    const lifecycle = new DossierLifecycle();
    const generation = lifecycle.begin();
    lifecycle.suspend();
    lifecycle.close();
    assert.equal(lifecycle.isCurrent(generation), false, reason);
    assert.equal(lifecycle.shouldResume(), false, reason);
  }
});

test("reconciliation detects party, membership, assignment, eligibility, session and version changes", () => {
  const member = { partyId: "party", participantId: "member", assignedCharacterId: "role-1", dossierAvailable: true, version: 1 };
  const original = membershipContextKey([member]);
  for (const change of [{ partyId: "other" }, { participantId: "other" },
    { assignedCharacterId: "role-2" }, { assignedCharacterId: null }, { dossierAvailable: false }, { version: 3 }]) {
    assert.notEqual(membershipContextKey([{ ...member, ...change }]), original);
  }
  assert.notEqual(membershipContextKey([]), original);
  assert.equal(membershipContextKey([member]), original);
  assert.notEqual(dossierContextKey("party", "member", "role-1", true, 1),
    dossierContextKey("party", "member", "role-1", true, 2));
  assert.equal(syncIdentityChanged(null, "session-1"), false);
  assert.equal(syncIdentityChanged("session-1", "session-1"), false);
  assert.equal(syncIdentityChanged("session-1", "session-2"), true);
  assert.equal(hostVersionMatches(1, 1), true);
  assert.equal(hostVersionMatches(1, 2), false);
});
