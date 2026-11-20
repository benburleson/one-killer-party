# AI-assisted development lifecycle

## Desired outcome
A GitHub issue initiates an AI coding task in an isolated branch and workspace. The agent implements the change, runs meaningful checks, and opens a draft PR with reproducible evidence. Only a human can approve and merge to `main`.

## Issue sources
- Human-authored feature or bug issue.
- Vercel alerts for production errors or performance regressions.
- Supabase database, auth, API and realtime signals.
- Browser error monitoring and scheduled end-to-end smoke tests.

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
- Use GitHub Copilot coding agent as the initial native GitHub integration, subject to enabled access and plan entitlement.
- Maintain agent-agnostic issue contracts, tests, and PR evidence.
- Keep agent permissions scoped; work on its own branch and never force-update main.
- Use a local VS Code development container or Codespaces for reproducible human validation. Standard Copilot cloud environments may require separate configuration.

## Testing and PR evidence
- CI should run lint, type checks and build for every PR.
- Add Playwright smoke tests that produce screenshots, traces and HTML reports as downloadable CI artifacts.
- Configure Vercel PR preview deployments; include the exact preview URL in PR discussion.
- Use a dedicated Supabase test project or isolated branches for integration testing; never target production from agent test runs.
- CI pass and preview deployment success are independent gates; report missing or failed checks clearly.

## Human handoff checklist
- Issue linked and acceptance criteria mapped to completed behavior.
- Automated test results and limitations documented.
- Screenshots or artifact links for changed UI.
- Preview URL and manual verification steps.
- Risk assessment and any migrations highlighted.
- PR remains draft until human decides it is reviewable; merge requires human approval.

## Setup still requiring account-level configuration
1. Verify GitHub repository visibility and Copilot coding-agent access.
2. Configure branch rules and required checks; disable automatic merges.
3. Verify Vercel Git integration is producing PR preview deployments.
4. Configure separate Supabase development/test data, credentials and safe test fixtures.
5. Select alerting provider and integration after initial baseline instrumented errors are available.
6. Add Playwright and CI artifact publication with verified tests.
