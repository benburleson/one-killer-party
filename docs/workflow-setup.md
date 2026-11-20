# Workflow setup and operations runbook

This document is a reproducible runbook, **not a statement that all account-level settings have been completed**. Dates and screenshots of successful runs should be added as each milestone is verified.

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
4. Optional: add a dedicated `.github/workflows/copilot-setup-steps.yml` to preinstall dependencies in the managed agent environment. A dev container by itself does not configure that environment.
5. Create a small, well-specified issue with the Agent task template. Assign the issue to Copilot from the GitHub issue UI.
6. Observe the agent session and draft PR. Document session duration, intervention, CI results, changed files, and evidence. Do not hand-fix an agent PR without recording it.
7. Ask the agent to address failing CI through PR comments or agent handoff instead of manually committing a fix, except when diagnosing the workflow itself.

## Phase 2: independent CI and browser evidence

1. Verify the GitHub Actions `CI` workflow has green lint, type-check, and build jobs on a clean checkout.
2. Add Playwright smoke tests for public landing page, then multiplayer flows.
3. On pull requests, publish Playwright screenshots, traces and HTML reports as GitHub Actions artifacts. Apply retention limits and avoid sensitive player data in artifacts.
4. Post a reviewer-readable PR summary that links to real artifacts and test output; never claim tests that did not run.
5. Define an explicit CI failure policy: agent attempts limited repairs, then stops and reports a blocker rather than looping indefinitely.

## Phase 3: previews and data isolation

1. Verify Vercel Git integration creates a *Preview* deployment for PR branches; distinguish it from the production domain.
2. Verify access controls and secrets are scoped to preview environments, not production.
3. For UI review, include the preview URL and a reproducible manual walkthrough in the PR.
4. For backend integration tests, provision a dedicated Supabase test project or safe, isolated database branching. Never use production credentials/data for agent execution.
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

## Verification record

Add dated links to real CI runs, PRs, screenshots and alert-created issues as they occur. Until an item has such evidence, treat it as planned or configured, not proven.
