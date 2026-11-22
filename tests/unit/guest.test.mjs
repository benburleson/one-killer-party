import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateRecoveryToken,
  invitationCodeFromFragment,
  normalizeDisplayName,
  normalizeInvitationCode,
  recoveryTokenVerifier,
} from "../../src/lib/lobby/core.ts";

test("invite fragments accept only the code and are safe to discard before submission", () => {
  assert.equal(invitationCodeFromFragment("#code=ABCD2345"), "ABCD2345");
  assert.equal(invitationCodeFromFragment("code=abcd2345"), "ABCD2345");
  for (const fragment of [
    "#code=ABCDEFG0",
    "#code=ABCDEFGH&extra=secret",
    "#party=123",
    "",
  ]) {
    assert.equal(invitationCodeFromFragment(fragment), null);
  }
  assert.equal(normalizeInvitationCode(" abcd2345 "), "ABCD2345");
  assert.equal(normalizeInvitationCode("invalid"), null);
});

test("display names are trimmed, bounded and not treated as unique identities", () => {
  assert.equal(normalizeDisplayName(" Alex "), "Alex");
  assert.equal(normalizeDisplayName("Alex"), normalizeDisplayName("Alex"));
  assert.equal(normalizeDisplayName(" \t "), null);
  assert.equal(normalizeDisplayName("x".repeat(51)), null);
  assert.equal(normalizeDisplayName("😀".repeat(50)), "😀".repeat(50));
  assert.equal(normalizeDisplayName("😀".repeat(51)), null);
});

test("recovery credentials have 256 bits of randomness and store only a SHA-256 verifier", () => {
  const first = generateRecoveryToken();
  const second = generateRecoveryToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  const verifier = recoveryTokenVerifier(first);
  assert.match(verifier, /^\\x[0-9a-f]{64}$/);
  assert.notEqual(verifier, first);
});
