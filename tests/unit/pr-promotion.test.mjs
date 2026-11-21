import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflow = readFileSync(new URL("../../.github/workflows/promote-agent-pr.yml", import.meta.url), "utf8");
const script = workflow.split("          script: |\n")[1]
  .split("\n").map(line => line.replace(/^ {12}/, "")).join("\n");
const execute = new (Object.getPrototypeOf(async function () {}).constructor)("github", "context", "core", script);

const repo = { id: 1 };
const body = `## Validation
Tests passed.
## Screenshots and browser evidence
See CI artifact.
## Human verification steps
Review the changes.`;
const pr = () => ({
  number: 7, node_id: "PR_7", state: "open", draft: true, title: "Complete work", body,
  head: { repo, ref: "copilot/task", sha: "head" },
  base: { repo, ref: "main", sha: "base" }, merge_commit_sha: "merge",
});
const run = () => ({
  id: 42, path: ".github/workflows/ci.yml", event: "pull_request", status: "completed", conclusion: "success",
  repository: repo, head_repository: repo, head_branch: "copilot/task", head_sha: "head",
});
const artifact = () => ({ name: "playwright-evidence", expired: false, size_in_bytes: 100 });

async function check({ event = "edit", pull = pr(), latest = pull, current = latest, runs = [run()],
  artifacts = [artifact()], listed = [pull], mutationError } = {}) {
  const calls = { mutations: 0, logs: [], artifactRuns: [] };
  let reads = 0;
  const pulls = { list: () => {}, get: async () => ({ data: reads++ === 0 ? pull : reads === 2 ? latest : current }) };
  const actions = { listWorkflowRuns: () => {}, listWorkflowRunArtifacts: () => {} };
  const github = {
    rest: { pulls, actions },
    paginate: async (method, options) => {
      if (method === pulls.list) return listed;
      if (method === actions.listWorkflowRuns) {
        assert.equal(options.workflow_id, "ci.yml");
        assert.equal(options.branch, "copilot/task");
        return runs;
      }
      if (method === actions.listWorkflowRunArtifacts) {
        calls.artifactRuns.push(options.run_id);
        return artifacts;
      }
      throw new Error("unexpected API");
    },
    graphql: async () => {
      calls.mutations++;
      if (mutationError) throw mutationError;
      return { markPullRequestReadyForReview: { pullRequest: { url: "pr", isDraft: false } } };
    },
  };
  const context = {
    repo: { owner: "owner", repo: "repo" },
    payload: { repository: repo, ...(event === "edit" ? { pull_request: pull } : { workflow_run: runs[0] }) },
  };
  await execute(github, context, { info: message => calls.logs.push(message), notice: () => {} });
  return calls;
}

test("either ordering promotes only after finalization and successful current CI", async () => {
  assert.equal((await check({ runs: [] })).mutations, 0);
  assert.equal((await check({ event: "ci", pull: { ...pr(), title: "[WIP] working" } })).mutations, 0);
  for (const event of ["edit", "ci"]) {
    const calls = await check({ event });
    assert.equal(calls.mutations, 1);
    assert.deepEqual(calls.artifactRuns, [42]);
  }
});

test("rejects unsuccessful, stale, wrong-repository or wrong-branch CI and missing evidence", async () => {
  for (const change of [
    { conclusion: "failure" }, { status: "in_progress" }, { event: "push" }, { path: ".github/workflows/other.yml" },
    { head_sha: "old" }, { head_branch: "copilot/other" },
    { repository: { id: 2 } }, { head_repository: { id: 2 } },
  ]) {
    assert.equal((await check({ runs: [{ ...run(), ...change }] })).mutations, 0, JSON.stringify(change));
  }
  for (const artifacts of [[], [{ ...artifact(), expired: true }], [{ ...artifact(), size_in_bytes: 0 }], [{ ...artifact(), name: "other" }]]) {
    assert.equal((await check({ artifacts })).mutations, 0);
  }
  assert.equal((await check({ runs: [{ ...run(), head_sha: "merge" }] })).mutations, 1);
  assert.equal((await check({ runs: [{ ...run(), head_sha: "old" }, run()] })).mutations, 1);
});

test("rejects unrelated, fork, non-draft, WIP and incomplete PRs", async () => {
  for (const change of [
    { draft: false }, { state: "closed" }, { title: "Draft: task" }, { title: "Blocked task" },
    { base: { ...pr().base, ref: "other" } },
    { base: { ...pr().base, repo: { id: 2 } } },
    { head: { ...pr().head, repo: { id: 2 } } },
    { head: { ...pr().head, ref: "feature/task" } },
    { body: "" }, { body: "<!--\n" + body + "\n-->" },
    { body: "```\n" + body + "\n```" },
    { body: body.split("\n").map(line => "> " + line).join("\n") },
    { body: "## Validation\n## Screenshots and browser evidence\n## Human verification steps" },
    { body: "## Validation\n### Results\n## Screenshots and browser evidence\n### Evidence\n## Human verification steps\n### Steps" },
    { body: body.replace("Tests passed.", "# Unrelated\nTests passed.") },
  ]) {
    assert.equal((await check({ pull: { ...pr(), ...change } })).mutations, 0, JSON.stringify(change));
  }
  assert.equal((await check({ listed: [pr(), { ...pr(), number: 8 }] })).mutations, 0);
  assert.equal((await check({ listed: [{ ...pr(), number: 8 }] })).mutations, 0);
});

test("rechecks PR state and handles an already-ready mutation race", async () => {
  for (const change of [
    { state: "closed" }, { draft: false }, { title: "changed" }, { body: "changed" },
    { head: { ...pr().head, sha: "new" } }, { head: { ...pr().head, ref: "copilot/new" } },
    { base: { ...pr().base, ref: "other" } }, { base: { ...pr().base, sha: "new" } },
    { merge_commit_sha: "new" },
  ]) {
    assert.equal((await check({ latest: { ...pr(), ...change } })).mutations, 0, JSON.stringify(change));
  }
  const calls = await check({ mutationError: new Error("already ready"), current: { ...pr(), draft: false } });
  assert.equal(calls.mutations, 1);
  assert.match(calls.logs[0], /already ready/);
  await assert.rejects(check({ mutationError: new Error("API failed") }), /API failed/);
});
