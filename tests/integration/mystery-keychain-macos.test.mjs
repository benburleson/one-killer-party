import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createKeychain } from "../../scripts/mystery-publish.mjs";

test("disposable macOS Keychain entry round-trips and refuses replacement", {
  skip: process.platform !== "darwin" ? "Requires a real Mac and an interactive Keychain" : false,
}, async (t) => {
  const account = randomUUID();
  const service = "one-killer-party.mystery-publisher.local";
  const password = ` synthetic ${randomBytes(24).toString("base64url")} !@#$%^&*()[]{};:'"\\|<>,.?/~ 雪 🐈 `;
  const store = createKeychain();
  t.diagnostic(`Disposable Keychain account for cleanup if enrollment fails: ${account}`);
  await store.enroll(account, password, { target: "local" });
  t.after(() => {
    execFileSync("/usr/bin/security", ["delete-generic-password", "-s", service, "-a", account],
      { stdio: "ignore" });
  });
  assert.ok(await store.read(account, { target: "local" }) === password, "Keychain round-trip mismatch");
  await assert.rejects(store.enroll(account, "different synthetic password", { target: "local" }),
    /KEYCHAIN_FAILED/);
  assert.ok(await store.read(account, { target: "local" }) === password, "duplicate changed the item");
});
