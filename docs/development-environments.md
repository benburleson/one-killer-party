# Development environments

## Preferred: Dev Container

The repository uses [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json) for interactive, reproducible development, rather than requiring every contributor to install Node and browser dependencies on their host.

Requirements: Docker + VS Code and the Dev Containers extension, or a compatible Codespaces environment.

1. Clone this repository (or open in Codespaces).
2. From VS Code, run **Dev Containers: Reopen in Container**.
3. The container provisions Node.js 22, runs `npm ci`, and installs Chromium plus its Linux system dependencies with Playwright.
4. Use `npm run dev` and the forwarded port 3000.
5. For browser verification, use `npm run build` then `npm run test:e2e`.

This is an initial setup definition, not yet a verified end-to-end Docker/Codespaces run. If `postCreateCommand` fails because browser installation needs elevated privileges, capture the logs and fix the image/Dockerfile in a follow-up issue rather than silently skipping browser tests.

### App configuration and data

Do not put secrets in `devcontainer.json`, build arguments, source files or PR artifacts. Supply only non-production environment settings through uncommitted developer configuration or an approved secret store. The dev container does **not** create an isolated Supabase project. Integration testing against Supabase must wait for explicitly provisioned safe test resources.

## GitHub Copilot cloud coding agent

Copilot's default hosted runtime is **not automatically the dev container**. GitHub documents a separate setup workflow in [`.github/workflows/copilot-setup-steps.yml`](../.github/workflows/copilot-setup-steps.yml), which applies to Copilot sessions running on GitHub Actions (not every cloud sandbox runtime).

It runs on Ubuntu with Node 22, `npm ci`, and Playwright Chromium dependencies. When added to `main`, validate its standalone workflow and inspect the next agent session logs. GitHub can continue an agent session even if a setup step fails; a setup workflow existing is not proof of a healthy environment.

If we later choose a custom Copilot environment running in Codespaces or containers, that requires explicit registration and selection. It is not enabled by the files in this PR.

## CI and Vercel

- [CI](../.github/workflows/ci.yml) separately executes lint, typecheck, build and desktop/mobile Chromium smoke tests on GitHub runners. Browser reports and screenshots are uploaded for human review.
- Vercel preview deployments are branch-specific deployments for human acceptance testing, not coding containers.
- Never claim environment parity solely from Node versions: OS packages, networking, secrets, permissions and deployment configuration can differ.

## Verification after merge

- [ ] Build/reopen the dev container in VS Code or Codespaces; record setup logs.
- [ ] Run `node --version`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm run test:e2e`.
- [ ] Verify port 3000 works and capture screenshots if relevant.
- [ ] Run **Copilot Setup Steps** manually in Actions (or verify its PR-triggered run) and inspect actual results.
- [ ] Dispatch a small agent issue and verify its environment setup and independently passing CI.
- [ ] Record findings and human interventions in [agent-evaluation.md](agent-evaluation.md).

## Why not a single image for everything?

A dev container provides a consistent, portable *interactive* environment. Copilot cloud execution and CI have independent security boundaries and supported setup mechanisms. Aligning Node, npm lockfile and Playwright across these is useful, but forcibly hosting all jobs in one mutable image would increase complexity without demonstrating additional agent autonomy yet.
