import assert from "node:assert/strict";
import { test } from "node:test";
import {
  forwardedClientAddress,
  generateRecoveryToken,
  normalizeDisplayName,
  recoveryTokenVerifier,
  validRecoveryToken,
} from "../../src/lib/lobby/core.ts";
import {
  invitationCodeFromFragment,
  normalizeInvitationCode,
} from "../../src/lib/lobby/invite-code.ts";

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

test("recovery credential shape accepts only generated 43-character base64url strings", () => {
  assert.equal(validRecoveryToken(generateRecoveryToken()), true);
  for (const value of [null, undefined, 43, "", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "=", "a".repeat(42) + "/"]) {
    assert.equal(validRecoveryToken(value), false);
  }
});

test("rate-limit source prefers the platform-overwritten forwarded header", () => {
  const headers = (values) => new Headers(values);
  assert.equal(forwardedClientAddress(headers({
    "x-vercel-forwarded-for": "203.0.113.7",
    "x-forwarded-for": "198.51.100.9",
  })), "203.0.113.7");
  assert.equal(forwardedClientAddress(headers({ "x-forwarded-for": "198.51.100.9" })), "198.51.100.9");
  assert.equal(forwardedClientAddress(headers({ forwarded: "for=198.51.100.9" })), null);
});
