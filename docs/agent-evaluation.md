# Autonomous development experiment: evidence and metrics

We want to show **what the system actually accomplished**, including failures, rather than merely claiming an autonomous pipeline exists.

## Per-issue trial record

Record the following in each agent-generated PR or linked issue:

| Field | What to capture |
| --- | --- |
| Trigger | Human report, Vercel alert, Supabase alert, or synthetic test |
| Issue quality | Acceptance criteria and reproduction steps available at dispatch |
| Agent/environment | Agent name, runtime, branch and execution limits |
| Human interventions | Number and nature of clarifications, restarts, and manual changes |
| Completion | Draft PR opened, blocked, or abandoned |
| CI evidence | Links and pass/fail outcome for lint, types, build and tests |
| Browser evidence | Screenshots, traces, browser/version and target URL where applicable |
| Preview verification | Working Vercel preview link and any manual verification |
| Safety | Data/security/production concerns, violations or mitigations |
| Review outcome | Approved, revisions requested, rejected or merged by a human |
| Learning | Failure mode and workflow improvement to make next |

## Suggested showcase KPIs

- **Issue-to-PR rate:** agent-dispatched issues producing a reviewable draft PR.
- **First-pass CI rate:** PRs passing required checks without follow-up fixes.
- **Human intervention rate:** count of substantive human actions per task.
- **End-to-end elapsed time:** issue assignment to draft PR ready for review.
- **Review rework:** reviewer-requested changes per PR.
- **Reproduction coverage:** bug-fix PRs with a test or repeatable repro.
- **Environment reliability:** sessions reaching a usable test environment.
- **Safety:** number of secret exposures, production writes, permission bypasses (target zero).

Report denominators and failed trials; do not calculate success percentages from cherry-picked examples. Track trend over multiple issues, and distinguish subjective human review from deterministic CI results.

## Graduation criteria for more autonomy

Advance from human-created issues to automated issue creation only after the agent can complete several scoped tasks with credible tests and evidence. Advance from human agent-dispatch to automatic dispatch only for pre-approved, low-risk issue categories with deduplication, rollback/stop mechanisms, and explicit limits on execution cost and privileges. **Never graduate to automatic merge as part of this experiment.**
