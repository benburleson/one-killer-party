# Automatically marking agent PRs ready for human review

## Purpose

GitHub Copilot cloud agent creates **draft** pull requests and cannot mark them ready for review itself. This repository uses a small, trusted workflow, [`promote-agent-pr.yml`](../.github/workflows/promote-agent-pr.yml), to perform that transition after independently verified CI and reviewer handoff evidence.

The workflow **never reviews, approves or merges** a PR. It cannot bypass the `main` branch ruleset.

## Trigger and checks

The GitHub Actions `workflow_run` event fires when the established `CI` workflow completes. The promotion job runs only for successful pull-request CI events and then checks all of the following:

1. CI came from a branch in this repository whose name starts with `copilot/`.
2. There is exactly one open *draft* PR targeting `main` for that branch.
3. CI completed for the PR's **current revision**, not a stale commit.
4. The title no longer indicates WIP or Draft, and the body includes validation, screenshot evidence, and human verification sections.
5. The successful CI run actually published a nonempty `playwright-evidence` artifact.
6. The PR's head, base, title and description have not changed during the checks.

If any check fails, the workflow does **nothing** and logs the reason. The human reviewer can still mark a PR ready manually.

**Limitation:** GitHub does not expose a universally reliable, separately verified “agent finished” signal in this workflow. The no-WIP title plus handoff sections are practical evidence of completion, not a guarantee. The promotion workflow must never be treated as code approval or a substitute for review.

## Security boundaries

- The workflow file is trusted only from the repository's **default branch**.
- It never checks out, builds or executes untrusted pull-request code.
- The only write permission is `pull-requests: write` on the workflow token.
- It does not download or execute artifacts; it inspects their GitHub API metadata.
- Only same-repository `copilot/` branches targeting `main` qualify.
- Production secrets are not used.
- Agents cannot use this workflow to approve, merge or grant access.

The privileged `workflow_run` trigger must remain isolated from untrusted PR source and artifacts. Changes to this file deserve special human scrutiny.

## Verification plan

1. Merge this workflow through a reviewed, human-controlled PR.
2. Create and assign a small test issue to GitHub Copilot.
3. Observe that the initial Copilot draft remains a draft during implementation.
4. After the final successful CI run and a published `playwright-evidence` artifact, verify the **Promote completed agent PR** workflow transitions the draft to **Ready for review**.
5. Confirm no manual workflow approval was required, no merge happened, and the promotion job logged the transition.
6. Verify a failed CI run, a WIP PR, or a missing artifact **does not** promote the PR.

Record any failures or additional human intervention in [agent-evaluation.md](agent-evaluation.md).

## Operational note

If CI succeeds before Playwright evidence is uploaded or while the PR remains WIP, the workflow will skip promotion. A later successful CI run can retry. For an already completed draft with no further CI run, a human can mark it ready; do not invent a success signal.
