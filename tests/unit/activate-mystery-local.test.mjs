import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("local activation refuses other targets and malformed references before connecting", () => {
  for (const args of [
    ["--production", "synthetic", "v1", "1", "a".repeat(64), "--confirm-local-activation"],
    ["--local", "synthetic", "v1", "1", "a".repeat(64)],
    ["--local", "synthetic", "v1", "1", "bad", "--confirm-local-activation"],
    ["--local", "synthetic';drop", "v1", "1", "a".repeat(64), "--confirm-local-activation"],
  ]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/activate-mystery-local.mjs", ...args], {
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /INVALID_ARGUMENTS|INVALID_REFERENCE/);
    assert.doesNotMatch(result.stdout + result.stderr, /drop|synthetic/);
  }
});

test("production verifier rejects invalid targets and keys before network or mutation", () => {
  for (const args of [
    ["--local", "project", "synthetic", "v1", "1", "a".repeat(64), "--verify-only"],
    ["--production", "project.example", "synthetic", "v1", "1", "a".repeat(64), "--verify-only"],
    ["--production", "project", "synthetic", "v1", "1", "a".repeat(64), "--verify-only"],
  ]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/verify-mystery-activation.mjs", ...args], {
      encoding: "utf8",
      env: { ...process.env, MYSTERY_VERIFICATION_SERVICE_ROLE_KEY: "not-a-service-key" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /INVALID_ARGUMENTS|VERIFICATION_KEY_REQUIRED/);
    assert.doesNotMatch(result.stdout + result.stderr, /not-a-service-key|synthetic/);
  }
});
