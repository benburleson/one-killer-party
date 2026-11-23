import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../scripts/publish-mystery.mjs", import.meta.url));

test("publisher rejects production and implicit targets before reading credentials", () => {
  for (const args of [
    ["--target", "production"],
    [],
  ]) {
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      script,
      ...args,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_URL: "https://production.example.invalid",
        SUPABASE_ANON_KEY: "synthetic-anon-key",
        SUPABASE_JWT_SECRET: "synthetic-signing-secret",
      },
    });

    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.split(/\r?\n/, 1)[0], "INVALID_ARGUMENTS");
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic|production\.example/);
  }
});
