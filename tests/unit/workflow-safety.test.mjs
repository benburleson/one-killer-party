import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

function job(name) {
  return workflow.split(`\n  ${name}:\n`)[1].split(/\n  [a-z][\w-]*:\n/)[0];
}

test("local Supabase startup failures expose only categorical diagnostics", () => {
  const action = readFileSync(
    new URL("../../.github/actions/start-local-supabase/action.yml", import.meta.url), "utf8");
  assert.match(action, /using: composite/);
  assert.match(action, /npx supabase start >\/dev\/null 2>&1/);
  assert.ok(action.includes("Supabase CLI start failed after ${max_attempts} attempts; raw output suppressed"));
  assert.match(action, /max_attempts=3/);
  assert.match(action, /attempt<=max_attempts/);
  assert.ok(action.includes("npx supabase stop --project-id one-killer-party --no-backup >/dev/null 2>&1 || true"));
  assert.ok(action.includes('sleep "$delay"'));
  assert.match(action, /docker info >\/dev\/null 2>&1/);
  assert.match(action, /docker ps -a --filter 'name=one-killer-party' --format '\{\{\.Status\}\}'/);
  assert.doesNotMatch(action, /supabase status|SERVICE_ROLE_KEY|ANON_KEY/);
  // The shared step must stay unprivileged: no inputs, secrets, expressions or nested actions.
  assert.doesNotMatch(action, /\$\{\{|^inputs:|secrets\.|uses:/m);

  for (const name of ["database-security", "browser-integration"]) {
    assert.match(job(name),
      /- name: Start disposable local Supabase\n        uses: \.\/\.github\/actions\/start-local-supabase\n      - name: Reset from migrations/);
  }
  // No job starts Supabase inline, where output suppression could drift.
  assert.doesNotMatch(workflow, /supabase start/);
  assert.equal([...workflow.matchAll(/uses: \.\//g)].length, 2);
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
