import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingLobbyStatus } from "../../src/app/join/guest-lobby-state.ts";

test("pending lobby offers retry only while synchronization can continue", () => {
  for (const kind of ["joined", "recovered", "existing"]) {
    const waiting = pendingLobbyStatus(kind, false);
    assert.equal(waiting.canRetry, true);
    assert.match(waiting.message, /keep trying/);
    const unauthorized = pendingLobbyStatus(kind, true);
    assert.equal(unauthorized.canRetry, false);
    assert.match(unauthorized.message, /no longer has authorized access/);
    assert.match(unauthorized.message, /Reload the page or ask the host/);
    assert.doesNotMatch(unauthorized.message, /keep trying/);
  }
  assert.match(pendingLobbyStatus("recovered", true).message, /^Recovery completed\./);
  assert.match(pendingLobbyStatus("joined", true).message, /^You joined the party\./);
});
