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

## Current security and product invariants

- The app implements **LOBBY only** (host login, guest join/recovery, public role assignment, polling). Do not invent dossier/act/reveal UI or assume those are deployed.
- A private mystery package is immutable JSON validated and hashed canonically, stored in the `private-mystery-packages` bucket and registered under `private_mystery.published_versions`. **Only a synthetic package has been published in Production.** No real Blackwood story content belongs in this public repository.
- The **enabled Production** Custom Access Token Hook maps one publisher UUID to `mystery_operator`. The server-side guarded publication RPC and restrictive Storage policy require current mapping and `aal2`. Operator sign-in requires Cloudflare Turnstile, TOTP and exact `PUBLISH` confirmation; do not bypass with service-role keys. App clients must not access the full private package.
- Host and guest browser roles have no direct public-table privileges. Changes to tables/RPCs must preserve migration/RLS and `supabase/tests/security_invariants.test.sql` constraints. No anonymous or ordinary authenticated caller may inherit publisher capabilities.
- Party mystery ID and version pins are immutable for existing parties. The existing Blackwood placeholder pin is public roster data; never quietly replace it with a private published version.
- Preserve host/guest separation, owner-checked versions, origin and anti-CSRF guards, invite secrecy, and spoiler-safe public projections. Browser/client bundles, screenshots, logs and PR evidence must never leak private dossiers, solution, JWTs, passwords or user data.
- Cloudflare Turnstile sitekey is public; secret belongs in Supabase Auth. Turnstile tokens are short-lived and single use. No Production secrets or databases in previews, CI or local fixtures.
- On partial publication, preserve the object and inspect registry+digest; no automatic overwrite, deletion or party repinning. A real content release requires separate identity/digest-scoped approval.
- Existing Production evidence: synthetic publication+registry/Storage metadata, unauthenticated Storage denial, host/guest login, publisher MFA. **An ordinary-host authenticated JWT Storage denial was not live-tested.** Do not claim otherwise.

## Common review traps

- Check discriminated Supabase Auth results before accessing `user.id`; distinguish missing sessions from other errors.
- Keep host and guest Playwright sessions in separate browser contexts; use stable scoped locators.
- Preserve `useActionState` feedback through revalidation; don't remount forms on party-version changes without need.
- Don't label a merged PR as proof of Production migration or smoke test; report the actual evidence and its limits.
- Never modify Production Auth hook settings or the guarded publisher SQL installer merely to make a test pass.
