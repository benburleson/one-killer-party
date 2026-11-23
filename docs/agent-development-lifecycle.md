# AI-assisted development lifecycle

## How it works
A GitHub issue initiates an AI coding task in an isolated branch and workspace. The agent implements the change, runs meaningful checks, and opens a draft PR with reproducible evidence. Only a human can approve and merge to `main`.

## Issue sources
- Human-authored feature or bug issue (the only source in use).
- Proposed, not implemented: Vercel alerts for production errors or performance regressions.
- Proposed, not implemented: Supabase database, auth, API and realtime signals.
- Proposed, not implemented: browser error monitoring and scheduled end-to-end smoke tests.

## Proposed ingestion (not yet implemented)
Telemetry/alert provider → authenticated webhook/alert adapter → normalize and redact → fingerprint and deduplicate → severity classification → GitHub issue with evidence → approved agent dispatch.

Safeguards:
- No automatic dispatch on every raw error or untrusted issue.
- Rate limits and incident fingerprinting; update existing issues for recurring events.
- No access tokens, user data, session identifiers, or sensitive payloads in issue bodies.
- Store only links or sanitized samples; preserve provenance and timestamps.
- Production-impacting changes, migrations, security issues, and infrastructure permission changes require manual authorization.
- Human review remains mandatory before merging any PR.

Suggested initial rollout: manual issue assignment → automatic issue creation with human triage → opt-in agent dispatch for low-risk issues → later automated dispatch for narrowly classified, low-risk incidents.

## Agent execution
- GitHub Copilot coding agent is the agent in use.
- Maintain agent-agnostic issue contracts, tests, and PR evidence.
- Keep agent permissions scoped; work on its own branch and never force-update main.
- Use a local VS Code development container or Codespaces for reproducible human validation. Standard Copilot cloud environments may require separate configuration.

## Testing and PR evidence
- CI runs unit tests, lint, type checks, build, CodeQL, database security tests and browser tests for every PR; see [workflow setup](workflow-setup.md).
- Keep browser smoke and local-Supabase integration separate where their environments differ. Upload only reviewed, credential-safe, allowlisted evidence; do not publish arbitrary DOM, traces, test-result contexts or logs.
- Include the exact Vercel preview URL in the PR when one was verified.
- Use the disposable local Supabase CI stack for integration testing; never target production from agent test runs.
- CI pass and preview deployment success are independent gates; report missing or failed checks clearly.

## Human handoff checklist
- Issue linked and acceptance criteria mapped to completed behavior.
- Automated test results and limitations documented.
- Screenshots or artifact links for changed UI.
- Preview URL and manual verification steps.
- Risk assessment and any migrations highlighted.
- The PR stays a draft until a human marks it ready; merge requires human approval.

## Owner-managed settings not visible from the repository
Copilot coding-agent access, the `main` ruleset and required checks, the Vercel
Git integration, and preview-environment secrets. Dedicated preview Supabase
isolation and an alerting provider are undecided (O-025).
