import assert from "node:assert/strict";
import { test } from "node:test";
import { committedGuestResult } from "../../src/lib/lobby/core.ts";

test("committed join and recovery retain the normal projected membership", async () => {
  const membership = { partyId: "party", participantId: "member", version: 7 };
  for (const outcome of ["joined", "recovered"]) {
    let reads = 0;
    const result = await committedGuestResult(outcome, async () => {
      reads++;
      return membership;
    });
    assert.deepEqual(result, { outcome, membership });
    assert.equal(reads, 1);
  }
});

test("committed join and one-time recovery remain successful when projection races or is unavailable", async () => {
  for (const outcome of ["joined", "recovered"]) {
    for (const project of [
      async () => { throw new Error("concurrent party version change"); },
      async () => { throw new Error("lobby unavailable"); },
      async () => null,
    ]) {
      assert.deepEqual(await committedGuestResult(outcome, project), { outcome, membership: null });
    }
  }
});
