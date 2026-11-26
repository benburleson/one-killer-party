# GitHub agent and CI operations

This repository uses a **human-supervised issue → Copilot agent → PR → CI → human merge** workflow. This is the current operating procedure, not an account-setup diary. Repo and agent rules are in [`.github/copilot-instructions.md`](../.github/copilot-instructions.md). Production changes and publications are separately governed by [Production operations](production-operations.md).

## Everyday workflow

1. Write a well-scoped issue with requirements, acceptance criteria, relevant product decisions, security boundaries and expected tests. Unresolved design choices must be called out.
2. Assign the issue to GitHub Copilot coding agent. It works on an isolated branch; [`copilot-setup-steps.yml`](../.github/workflows/copilot-setup-steps.yml) prepares its environment. Dev containers are for interactive development, not necessarily the agent runner.
3. Inspect the PR's actual diff and test evidence. The agent must report unit/lint/type/build results and relevant local Supabase pgTAP/Playwright evidence for DB/Auth/UI work, plus remaining limitations.
4. Require current-head-SHA checks; review risky changes manually. A Vercel preview is not Production, and a merge is not evidence of a Production migration or smoke test. Never fix failures by disabling tests or weakening authorization.
5. Mark a draft ready only after review handoff; a human performs any required review/merge. **Never auto-merge to `main`.** Keep branch protection, required checks, no force-push/delete and limited GitHub Actions permissions intact.
6. Owner handles Production migrations, Auth hooks, deployment, publisher provisioning and each content publication as separate approvals and verifications. Keep agents and CI away from Production credentials.

## CI and previews

- CI validates clean Linux checkout with Node/npm and application tests; use `npm ci` and scripts in `package.json` locally. Check the *current commit* Actions results and investigate failure logs before editing.
- Chromium Playwright evidence should contain only allowed, non-sensitive screenshots; do not publish arbitrary DOM dumps, traces, Auth headers, player data, email addresses, invite codes or private content in artifacts.
- Preview deployments must use isolated or mock services. **Do not connect a preview to Production Supabase or expose Production service-role credentials.** Check preview URLs explicitly before citing them.
- Playwright integrations and `npx supabase db reset --no-seed` use a disposable local Supabase stack; never run against a linked Production database.

## Maintenance checks

For changes to GitHub Actions permissions, Copilot agent permissions, branch rulesets or auto-merge, request owner review first. If a workflow changes, verify it on a fresh PR and observe permissions before relying on it. For protected branches, ensure the agent cannot bypass review or merge by itself. Document evidence instead of preserving a chronological troubleshooting diary.

**Where to look:** [development environments](development-environments.md) for local setup, [agent lifecycle](agent-development-lifecycle.md) for scope and evidence expectations, [production operations](production-operations.md) for live changes and backups, [agent evaluation](agent-evaluation.md) for historical trial evidence.
