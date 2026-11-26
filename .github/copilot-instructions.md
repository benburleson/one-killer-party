# Coding-agent instructions

## Objective and ownership

Complete the assigned, well-scoped GitHub issue as a **reviewable PR** on an isolated branch. Do not merge, deploy, alter Production or publish mystery content. An agent proposal is not approval; GitHub branch protection and human-controlled release gates remain authoritative.

## Sources of truth

1. **Current behavior:** inspect code, `supabase/migrations/`, tests, and the [current state](../README.md). Don't infer deployed state from an old issue/PR.
2. **Product behavior:** [confirmed decisions and open questions](../docs/product/decisions-and-open-questions.md), [gameplay](../docs/product/gameplay-specification.md), and [host/player flows](../docs/product/host-and-player-flows.md). A proposal is not a confirmed requirement.
3. **Architecture:** [lobby persistence](../docs/architecture/lobby-persistence.md), [private content architecture](../docs/architecture/mystery-content-architecture.md), and [package contract](../docs/architecture/mystery-content-package.md).
4. **Operational rules:** [Production runbook](../docs/production-operations.md), [development environments](../docs/development-environments.md) and [workflow setup](../docs/workflow-setup.md).

**Next.js warning:** before editing a framework API, read its installed guide in `node_modules/next/dist/docs/`; this project version may differ from your training data. Keep the Next.js-managed block in [AGENTS.md](../AGENTS.md) unchanged.

## Implementation workflow

1. Read the issue, acceptance criteria, relevant source files, migration and tests. Flag unresolved decisions instead of silently inventing behavior.
2. Make focused, smallest-scope edits with tests. Keep secret-bearing and private content data on trusted server/operator boundaries.
3. Validate from a disposable environment:
   ```sh
   npm run test:unit
   npm run lint
   npx tsc --noEmit
   npm run build
   ```
   Run `npx supabase db reset --no-seed`, `npx supabase test db`, relevant integration suites and desktop/mobile Playwright when the change affects Auth, DB, gameplay or UI. **Never run integration/reset tests against Production.**
4. If CI fails, inspect the failed step on the **current head SHA** before guessing a fix. Avoid weakening tests, branch rules, RLS or permissions to make checks pass.
5. Submit a PR describing scope, actual commands and outcomes, limitations, screenshots/evidence when safe, migration/deployment gates, risks, and owner verification instructions. An old passing run does not validate a newer commit.
6. Leave Production migration, Auth hook settings, SMTP/Turnstile configuration, Vercel releases, Keychain enrollment, and each package publication to a **separately authorized owner-operated step**.

## Source-of-truth security boundaries

For implemented lobby authorization and data model consult [lobby persistence](../docs/architecture/lobby-persistence.md). For private mystery and version-pinning design consult [content architecture](../docs/architecture/mystery-content-architecture.md). Use [source code](../src/lib/) and [migrations](../supabase/migrations/) to verify executable behavior, and [Production operations](../docs/production-operations.md) for live status.

Never expose complete private mystery packages to browsers. Keep credentials and private content out of commits and test reports. Preserve operator authentication, role grants, immutable version pins, server-side authorization, and current host/guest security boundaries. Production actions require separate approval.

## Common review traps

- Check discriminated Supabase Auth results before accessing `user.id`; distinguish missing sessions from other errors.
- Keep host and guest Playwright sessions in separate browser contexts; use stable scoped locators.
- Preserve `useActionState` feedback through revalidation; don't remount forms on party-version changes without need.
- Don't label a merged PR as proof of Production migration or smoke test; report the actual evidence and its limits.
- Never modify Production Auth hook settings or the guarded publisher SQL installer merely to make a test pass.
