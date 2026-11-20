# One Killer Party

An interactive murder-mystery party application **and a public experiment in AI-assisted software engineering**.

This project has two goals:
1. Build a theatrical, multiplayer mystery experience.
2. Demonstrate a development lifecycle in which GitHub issues become autonomous coding tasks, agents work in isolated environments, and humans review evidence-backed pull requests before merging.

The engineering workflow is part of the product showcase, not just an implementation detail. Changes, experiments, limitations, and lessons learned are intended to be visible through public issues, pull requests, and documentation.

## The development loop

```text
Human issue / monitoring alert
           |
           v
Normalize, prioritize, deduplicate (monitoring automation: planned)
           |
           v
GitHub issue -> approved agent assignment
           |
           v
Isolated agent workspace + issue branch
           |
           v
Implement -> test -> debug -> repeat
           |
           v
Draft PR + CI + screenshots + Vercel preview
           |
           v
Human review and manual merge decision
```

**No automatic merge to `main`.** The desired autonomy is in investigation, implementation, test iteration, and reviewer handoff—not bypassing human approval.

## Current state

This is an evolving experiment. A checked-in configuration is **not** evidence that the entire workflow has run successfully.

| Capability | Status |
| --- | --- |
| Next.js app, GitHub, Vercel, Supabase initial setup | Established during initial project setup |
| CI workflow for lint, TypeScript and build | Configured in setup PR; verify checks before merging |
| Agent instructions and issue / PR templates | Configured in setup PR |
| VS Code / Codespaces dev container definition | Configured in setup PR; runtime not yet validated |
| Copilot issue assignment and autonomous PR | To be enabled and proven with first trial |
| Playwright screenshots / traces in PR | Planned |
| Automated Vercel PR preview verification | Planned |
| Isolated Supabase integration test resources | Planned |
| Vercel / Supabase alerts to deduplicated issues | Planned |

## Workflow documentation

- [Architecture and autonomy boundaries](docs/agent-development-lifecycle.md)
- [Environment and GitHub setup runbook](docs/workflow-setup.md)
- [Agent-run evidence and showcase metrics](docs/agent-evaluation.md)
- [Agent working instructions](.github/copilot-instructions.md)

## Local development

Requires Node.js 22 and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Secrets belong in local, uncommitted environment files (refer to existing environment configuration); never publish production credentials or personal player data.

You can alternatively open this repository in a compatible VS Code development container using `.devcontainer/devcontainer.json`.

## Technologies

Next.js, React, TypeScript, Tailwind CSS, Supabase, GitHub Actions, Vercel. Playwright is planned for browser-based verification.

## Portfolio review guide

Start with the [development lifecycle](docs/agent-development-lifecycle.md), then inspect the GitHub **Issues**, **Pull requests**, and **Actions** tabs. The [agent evaluation rubric](docs/agent-evaluation.md) is designed to distinguish real, independently verifiable autonomy from claims about what an agent might do.

## Security model

The repository is intentionally public. Public read access does not grant permission to push to protected branches. No secrets, personal data, or production database credentials belong in repository files, issue bodies, PR comments, screenshots, or CI artifacts. Production-impacting changes and merging remain human-controlled.
