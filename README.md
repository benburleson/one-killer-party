# One Killer Party

**A murder-mystery party in your pocket — and a public experiment in autonomous, human-supervised software delivery.**

One Killer Party is an in-person, phone-assisted murder-mystery experience. Guests interact face-to-face while the app handles game guidance, private information, clues and pacing. Alongside the product, this repository showcases an AI-assisted engineering lifecycle: **GitHub issue → coding agent → isolated branch → automated tests and evidence → PR ready for human review → human-controlled merge**.

## What we're building

The initial playable mystery is **The Blackwood Affair**. Product behavior is specified in the version-controlled [product specification](docs/product/product-vision.md), including:

- [Vision and scope](docs/product/product-vision.md)
- [Game rules and state](docs/product/gameplay-specification.md)
- [Host and player journeys](docs/product/host-and-player-flows.md)
- [Reusable mystery content model](docs/product/mystery-content-model.md)
- [The Blackwood Affair](docs/product/blackwood-affair.md)
- [Decision register and open questions](docs/product/decisions-and-open-questions.md)

The v0.3 documents are an **implementation baseline**, not a claim that all gameplay details are finalized. They label confirmed decisions, proposals and unresolved questions; implementation issues must reference the relevant requirements rather than inventing missing rules.

## Development lifecycle

```text
Product specification / GitHub issue
                |
                v
      Copilot coding agent
       isolated issue branch
                |
                v
       Implement and test
                |
                v
    PR + CI + Playwright evidence
                |
                v
       Vercel PR preview
                |
                v
    Ready for human review
                |
                v
     Human-controlled merge
```

**No automatic merge to `main`.** GitHub rules protect the default branch; agent-generated code and tests are proposals, not approvals.

### Demonstrated and configured status (November 20, 2026)

| Capability | Status / evidence |
| --- | --- |
| Public repository and protected `main` | Public confirmed; branch ruleset reported configured by owner |
| Copilot coding agent from GitHub issue | **Demonstrated:** [Issue #2](https://github.com/benburleson/one-killer-party/issues/2) → [PR #3](https://github.com/benburleson/one-killer-party/pull/3) |
| CI: lint, TypeScript and build | **Demonstrated:** [successful run](https://github.com/benburleson/one-killer-party/actions/runs/44832837014) |
| Playwright desktop/mobile and evidence artifacts | **Demonstrated:** [trial 2 PR #6](https://github.com/benburleson/one-killer-party/pull/6) and its linked CI/artifacts |
| Vercel PR preview deployments | **Demonstrated:** successful preview status and browser access during agent trials |
| Workflow approvals | **Owner-configured:** Copilot workflow-run approval disabled; trial 2 ran without the earlier approval interruption |
| Automatic draft → Ready for Review | **Configured:** [promotion workflow](.github/workflows/promote-agent-pr.yml); live end-to-end validation still required |
| Product specification v0.3 | **Version controlled:** [docs/product/](docs/product/) |
| Dev container | **Configured; preferred setup**, not yet independently validated after this update |
| Copilot cloud-agent setup steps | **Configured in this change**; requires merge and subsequent agent-run verification |
| Isolated Supabase integration-test data | Planned |
| Vercel/Supabase alerts → deduplicated GitHub issues | Planned |

We deliberately record manual interventions, failed runs, and limits alongside successes; see [agent evaluation](docs/agent-evaluation.md).

## Development environment — dev container first

**Preferred:** use the repo's [dev container](.devcontainer/devcontainer.json), with Node.js 22, npm dependencies, and Chromium for Playwright. This works in VS Code + Docker and compatible GitHub Codespaces environments.

1. Install Docker and the VS Code **Dev Containers** extension, or use GitHub Codespaces.
2. Clone the repository and open it in VS Code.
3. Select **Dev Containers: Reopen in Container** from the Command Palette. Setup runs `npm ci` and installs Playwright Chromium/dependencies.
4. Start the app inside the container:

```bash
npm run dev
```

Open the forwarded port **3000**. Keep any local `.env.local` or other secrets uncommitted. The container does not automatically provision a Supabase database or production credentials.

### Verify locally

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e -- --project=desktop-chromium --project=mobile-chromium
```

Playwright tests use the production build (`npm run build` first). Screenshots and HTML reports appear under `test-results/` and `playwright-report/`. On PRs, download the `playwright-evidence` artifact from the GitHub Actions run (14-day retention).

**Fallback without a container:** install Node.js 22 and npm locally, run `npm ci`, then `npx playwright install --with-deps chromium` (Linux) or `npx playwright install chromium` (macOS). Run the same scripts above.

### Environment parity and limitations

The dev container is the **preferred interactive workspace**, not the automatic runtime of GitHub Copilot's cloud agent. When Copilot runs on GitHub Actions, [`copilot-setup-steps.yml`](.github/workflows/copilot-setup-steps.yml) prepares Node 22, dependencies and Chromium. CI independently verifies changes on Linux runners. All environments use the same package lockfile and npm scripts, but different host images can still behave differently.

For setup details and known limitations, see [development environments](docs/development-environments.md).

## How to explore the showcase

Start with [the lifecycle](docs/agent-development-lifecycle.md) and [environment setup](docs/workflow-setup.md); inspect public [issues](https://github.com/benburleson/one-killer-party/issues), [pull requests](https://github.com/benburleson/one-killer-party/pulls), and [Actions runs](https://github.com/benburleson/one-killer-party/actions). See the [evaluation rubric](docs/agent-evaluation.md) for measured autonomy and the [draft promotion policy](docs/pr-auto-promotion.md).

## Stack and safety

Next.js (App Router), React, TypeScript, Tailwind CSS, Supabase, Playwright, GitHub Actions, Vercel.

This repository is intentionally public. Never publish tokens, secrets, private player information or real production data in source, issues, artifacts or logs. Agent work uses isolated branches; production changes and merges require human authorization.
