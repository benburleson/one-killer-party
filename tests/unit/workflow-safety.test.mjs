import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

function job(name) {
  return workflow.split(`\n  ${name}:\n`)[1].split(/\n  [a-z][\w-]*:\n/)[0];
}

test("local Supabase startup failures expose only categorical diagnostics", () => {
  const starts = [...workflow.matchAll(/- name: Start disposable local Supabase\n([\s\S]*?)(?=\n      - name:)/g)];
  assert.equal(starts.length, 2);

  for (const [, step] of starts) {
    assert.match(step, /npx supabase start >\/dev\/null 2>&1/);
    assert.match(step, /Supabase CLI start failed \(exit code/);
    assert.match(step, /docker info >\/dev\/null 2>&1/);
    assert.match(step, /docker ps -a --filter 'name=one-killer-party' --format '\{\{\.Status\}\}'/);
    assert.doesNotMatch(step, /supabase status|SERVICE_ROLE_KEY|ANON_KEY/);
  }
});

test("browser artifacts remain allowlisted and missing integration screenshots do not mask failures", () => {
  const smoke = job("browser-smoke");
  assert.match(smoke, /path: test-results\/\*\*\/landing-page\.png/);
  assert.match(smoke, /if-no-files-found: warn/);
  assert.doesNotMatch(smoke, /playwright-report|test-results\/\n/);

  const integration = job("browser-integration");
  const evidence = integration.split("- name: Upload allowlisted host and guest UI evidence\n")[1];
  assert.match(evidence, /test-results\/\*\*\/host-sign-in\.png/);
  assert.match(evidence, /test-results\/\*\*\/guest-waiting-lobby\.png/);
  assert.match(evidence, /if-no-files-found: warn/);
  assert.doesNotMatch(evidence, /error-context|trace\.zip|playwright-report/);
});
