# Workflow setup and operations runbook

This is the runbook for repository, agent and CI setup. Account-level settings (rulesets, Copilot access, Vercel) are owner-managed and cannot be verified from the repository. Dated trial records live in [agent evaluation](agent-evaluation.md).

## Phase 0: security and source control

1. Keep the repository public for the showcase, while restricting write and merge rights to trusted collaborators.
2. In **Settings → Rules → Rulesets** (or Branch protection), add an active ruleset for `main`.
3. Require a pull request before merging, block force pushes and deletion, and require CI checks once their names have appeared in a successful run.
4. Set no bypass permissions for coding agents. Avoid auto-merge. On a solo-maintainer repository, requiring an independent approving review can prevent self-merge; choose the enforcement mechanism deliberately and document any limitation. The essential policy is that the agent cannot merge.
5. Confirm GitHub Actions has least-privilege default permissions and only approved workflows receive write access.

## Phase 1: initial coding agent

1. Verify GitHub Copilot plan eligibility and coding-agent availability in GitHub settings.
2. Confirm the repository permits agent sessions. See [GitHub's current agent guide](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview).
3. Keep `.github/copilot-instructions.md` updated with conventions, checks, and security limits.
4. `.github/workflows/copilot-setup-steps.yml` preinstalls dependencies in the managed agent environment. A dev container by itself does not configure that environment.
5. Create a small, well-specified issue with the Agent task template. Assign the issue to Copilot from the GitHub issue UI.
6. Observe the agent session and draft PR. Document session duration, intervention, CI results, changed files, and evidence. Do not hand-fix an agent PR without recording it.
7. Ask the agent to address failing CI through PR comments or agent handoff instead of manually committing a fix, except when diagnosing the workflow itself.

## Phase 2: independent CI and browser evidence

1. Verify the GitHub Actions `CI` workflow has green lint, type-check, and build jobs on a clean checkout.
2. Keep the public landing-page browser smoke test separate from the local-Supabase multiplayer integration job.
3. Publish only credential-safe screenshots/evidence allowlisted for each job. Do not upload arbitrary DOM, error-context files, traces, or logs that may contain credentials. Keep retention limits.
4. Post a reviewer-readable PR summary that links to real artifacts and test output; never claim tests that did not run.
5. Define an explicit CI failure policy: agent attempts limited repairs, then stops and reports a blocker rather than looping indefinitely.

## Phase 3: previews and data isolation

1. Verify Vercel Git integration creates a *Preview* deployment for PR branches; distinguish it from the production domain.
2. Verify access controls and secrets are scoped to preview environments, not production.
3. For UI review, include the preview URL and a reproducible manual walkthrough in the PR.
4. For backend integration tests, use the existing disposable local Supabase CI database. Never use production credentials/data for agent execution.
5. Document how to reset test data and expire ephemeral environments.

## Phase 4: incident-to-issue pipeline (not implemented)

Candidate event sources: Vercel server/edge errors; Supabase query, auth, API and realtime errors; browser exceptions; scheduled Playwright smoke checks.

Pipeline:
```text
Provider alert / webhook -> authenticated receiver
 -> sanitize and normalize -> incident fingerprint
 -> deduplicate / rate-limit -> severity classification
 -> create or update GitHub issue -> human triage
 -> eligible agent assignment -> draft PR
```

Use a stable incident key (source, service, error signature, environment), bounded time windows, and a link to the original alert. Never paste unsanitized log bodies or tokens into public issues. Auto-assign only low-risk, reproducible classes after the workflow has been demonstrated manually. Allow a human to stop dispatch or quarantine an issue.

## Environment compatibility

- `.devcontainer/devcontainer.json` documents a Node 22 environment for local VS Code / compatible Codespaces execution.
- GitHub Copilot's standard hosted coding agent uses a managed GitHub Actions runtime; configure it separately as needed.
- CI uses Node 22 and `npm ci`. Try to keep all three environments aligned, without assuming they are the same container.

## Running CI without intermediate human approval

The policy is **unattended CI but attended merge**. The owner reports that Copilot's **Require approval for workflow runs** setting is disabled. That permits agent-authored workflow steps to execute; it does *not* mean PR content is trusted. Review the threat model and keep:

1. PR workflow token permissions at `contents: read` unless an exception is explicitly reviewed.
2. Production secrets and deployment credentials unavailable to untrusted PR jobs.
3. No use of `pull_request_target` to check out and execute untrusted PR code with privileged tokens.
4. Protected `main`, human merge decision, and no agent auto-merge authority.
5. Future security or permissions modifications subject to separate human approval before merge.

If another approval gate appears, record which GitHub setting or workflow triggered it before changing security policy.

## Workflow map

| Workflow | Triggers and jobs | Permissions / boundary |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | `pull_request` to `main`, `push` to `main`, `workflow_dispatch`. Jobs: local DB/RLS tests; unit, lint, type-check and build; and on PRs or manual dispatch only, CodeQL, browser smoke and local-Supabase integration | Default `contents: read`; only CodeQL adds `security-events: write` and `actions: read`. Supabase is disposable and local. No production credentials |
| [`copilot-setup-steps.yml`](../.github/workflows/copilot-setup-steps.yml) | Manual dispatch, or push/PR touching this workflow; installs Node 22, npm dependencies, Chromium | `contents: read`; no production credentials |

The two jobs that need Supabase share
[`start-local-supabase`](../.github/actions/start-local-supabase/action.yml),
a local composite action with no inputs, secrets or expressions. It suppresses
raw CLI output, which prints local keys, and on failure reports only the exit
code, Docker reachability and container status. Evidence uploads are
allowlisted screenshots with 14-day retention and warn, rather than fail, when
an earlier failure produced none. `tests/unit/workflow-safety.test.mjs` guards
both rules.

Which checks are required for merge is a GitHub ruleset setting the owner
manages; do not infer it from workflow YAML. Changing workflow permissions,
triggers or the evidence allowlist needs explicit human review.

## Draft PRs are marked ready by a human

There is no automatic draft promotion; the former workflow was retired on
2026-11-23 (reasons and run history in [agent evaluation](agent-evaluation.md)).
No workflow uses `pull_request_target` or holds `pull-requests: write`.

An agent PR stays a draft until a human reviews the handoff, confirms a
successful CI run on the current head SHA, and marks it ready. The PR
template's `Validation`, `Screenshots and browser evidence` and
`Human verification steps` sections are still required. For a docs-only PR,
state that changed-UI screenshots are not applicable; do not fabricate one.
