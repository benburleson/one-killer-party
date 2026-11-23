# Production deployment and authentication operations

## Public domains and runtime

| Purpose | URL / environment |
| --- | --- |
| Marketing homepage | `https://onekillerparty.com` (and `https://www.onekillerparty.com`) |
| Host and gameplay app | `https://app.onekillerparty.com` |
| Host sign-in | `https://app.onekillerparty.com/host` |
| Supabase Auth callback | `https://app.onekillerparty.com/auth/callback` |
| Application hosting | Vercel Production |
| Authentication and persistence | Hosted Supabase production project |

The root/`www` marketing hosts must send **Host a party** visitors to `APP_URL + /host`. A browser tab left on `www.onekillerparty.com/host` will fail the app's intentional exact Origin check; start from the app subdomain. Do not weaken Origin validation to accommodate marketing-host posts.

## Production status

Code merged, migration applied, Vercel Production deployed and production
smoke-tested are separate gates. A merged PR, a green CI run or a Vercel PR
check establishes none of the later ones.

| Item | Status | Basis |
| --- | --- | --- |
| `20261121030000_lobby_persistence.sql`, `20261121040000_host_party_commands.sql` | Applied | Owner attestation; the owner also reported both versions in the remote migration history |
| `20261122000000_guest_membership.sql`, `20261122010000_public_character_assignment.sql` | Applied | Owner attestation (issue #41, 2026-11-23) |
| Guest join and recovery, public role assignment, lobby synchronization | Deployed and smoke-tested in Production | Owner attestation (issue #41, 2026-11-23) |
| `20261123000000_browser_role_lockdown_and_join_pin.sql` | **Not applied** | Needs the approval procedure below; apply before deploying the app version that depends on it |
| `20261123010000_private_mystery_packages.sql` | **Not applied; local-only for M2.1b** | No production bucket, schema, publication or deployment was requested or performed |

**Owner attestation is not independent verification.** This repository holds
no migration-history output, deployment SHA, date or smoke-test record for the
attested rows, and no agent inspected the Supabase or Vercel dashboards. Add
those links here if they are captured; do not infer them.

## Vercel Production environment

| Variable | Purpose / handling |
| --- | --- |
| `APP_URL` | Exactly `https://app.onekillerparty.com` (HTTPS origin only; no path or trailing whitespace) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project's `https://<project>.supabase.co` API origin |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase anon key matching that project |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged **server-only** key for the same project; never `NEXT_PUBLIC_` |

After editing deployment environment variables, redeploy Production. Ensure the domain routes to the intended Vercel project and deployment. Privileged credentials may bypass RLS; protect rotation/access and never show values in source, PRs, screenshots or logs. PR previews must not receive production service credentials or use the production auth/database backend.

## Supabase Auth and SMTP

- **Supabase Authentication → URL Configuration:** Site URL `https://app.onekillerparty.com`; allow the exact redirect `https://app.onekillerparty.com/auth/callback`. Do not indiscriminately allow wildcard preview domains.
- **Provider:** Email magic-link / OTP sign-in enabled for hosts.
- **Guest auth preflight:** guest identity creation requires Supabase
  **Authentication → Providers → Anonymous Sign-Ins** enabled for the intended
  production project. The local disposable project enables it in
  `supabase/config.toml`. If it is disabled, guest join fails with the
  "Guest sign-in was unavailable" message. The owner's production smoke test
  covered guest join; the setting itself was not inspected from this
  repository, so check it first if guest join fails. The owner approves any
  change. Do not enable it in previews unless they use an isolated,
  disposable Supabase project.
- **Delivery:** The owner reports custom SMTP configured in Supabase, following the Resend setup for One Killer Party. Intended dedicated sending domain: `auth.onekillerparty.com` with sender `no-reply@auth.onekillerparty.com`; **verify actual sender/domain and provider settings in the Supabase and mail-provider dashboards before relying on them**. SMTP host, username, password/API key, DNS ownership records, verified sender, and sending limits are managed in the providers' dashboards, **not in GitHub or Vercel client variables**.
- **DNS:** Keep sender-domain SPF/DKIM records as instructed by the email provider; avoid changing inbound MX records for the apex domain unless explicitly required. Check sender-domain verification, bounce/delivery diagnostics and provider sending limits.
- **Public host signup:** Custom SMTP enables email delivery beyond Supabase organization members, Monitor abuse, throttling, CAPTCHA and delivery reliability before public promotion. Do not claim successful non-team-member delivery until it has been tested.

### Safe host smoke test

1. Navigate directly to `https://app.onekillerparty.com/host` in a fresh tab. Request a magic link with an authorized test inbox; avoid repeated requests that hit rate limits.
2. Follow the email link back to the exact app host; verify the signed-in dashboard.
3. Create one disposable test Blackwood party; save the initially displayed invite code privately (it cannot be recovered from its database hash).
4. Open and refresh the lobby; verify the host-only view, invitation rotation (old code invalidated), and sign-out protection. Do not publish real invite links or tokens.
5. Verify delivery to a **non-organization** address without exposing its address in logs/artifacts.

Troubleshooting: Vercel server log events tagged `host_magic_link` contain safe stage categories (`origin_rejected`, `invalid_email_format`, `provider_rejected`, `provider_accepted`, `unexpected_server_error`). `provider_accepted` means the Supabase API accepted the request, **not** that email was delivered. Use Supabase Auth and SMTP provider logs for downstream delivery. Origin checks compare the request `Origin` exactly with `APP_URL`; request `Referer` is not a substitute. Never log raw headers, user emails, magic links or service keys.

## Database migrations and separation

Migrations are committed under `supabase/migrations/` and reviewed alongside
their PR. Their production status is in the table above. All migration and
integration tests use the disposable local Supabase project; do not link or
reset the production database.

`20261123000000_browser_role_lockdown_and_join_pin.sql` revokes every
remaining browser-role privilege on `public` tables and sequences (the
recovery-audit sequence previously allowed `setval`), stops future tables and
sequences from inheriting browser grants, and makes `join_party` return the
party's pinned mystery ID and version. **Apply it before deploying the
matching app version:** the new server rejects a join whose RPC response lacks
the pin, while the previous app version keeps working against the migrated
database. The default-privilege change applies to objects created by the role
that runs the migration; confirm the result on the target with the catalog
queries in `supabase/tests/security_invariants.test.sql` rather than assuming
the local default ACLs match Production.

For every production change:

1. Explicitly verify the linked **target project and environment**; inspect the target database and existing migration history. Plan backup/restore and rollback for destructive or data-changing operations.
2. Review migration SQL, especially every introduced or modified RPC; compare the verified target with `npx supabase migration list --remote` and `npx supabase db push --dry-run --remote`.
3. Obtain specific human approval **for this migration** before using `npx supabase db push --remote`; review the CLI's exact target and migration list again at confirmation. Apply and verify required production migrations **before** deploying an app version that depends on their RPCs.
4. Verify remote migration history, the actual Vercel Production deployment, and the production smoke test separately. Record links, timestamps, and any incident in durable issue/PR evidence.

**Never** let Copilot, PR CI, or a test workflow migrate/reset Production. Never run a remote/linked database reset, migrations from unreviewed agent code, or automated integration tests against Production. Local tests use `npx supabase db reset --no-seed` and `npx supabase test db` against disposable Docker Supabase only.

## Private mystery package storage (M2.1b)

M2.1b adds a **local-only** private Storage bucket, restricted published
registry, operator publication CLI and server-only exact-reference loader.
The existing lobby placeholder remains `blackwood-affair /
first-playtest-placeholder-v1`; it has no private package and no party pin or
game-start behavior changed. The new migration and synthetic integration test
must not be pointed at a linked or production project.

The local database boundary separates a `mystery_operator` role (package
object read/create and registration RPC only) from the runtime `service_role`
(exact-reference lookup only; no registration RPC). Browser roles have no
bucket listing/object access. Storage triggers reject update/delete through
the REST API even for `service_role`, and registry rows are immutable. However,
`service_role` bypasses RLS and can directly read Storage objects, including
unregistered orphans, and can upload orphan objects. A database owner or
superuser can disable triggers or alter the schema. The local CLI derives a
short-lived custom-role JWT from the local project JWT secret. This is **not**
a production operator credential design: the project signing secret is too
broad to treat as a separately scoped production publisher credential.

Before any production use, obtain separate human approvals for all of the
following gates; none is approved by this issue or its local tests:

1. **Target and dry run:** confirm the exact Supabase production project,
   inspect current migration history and run a reviewed dry run. Verify the
   expected migration order, including the still-unapplied
   `20261123000000_browser_role_lockdown_and_join_pin.sql`.
2. **Schema and Storage review:** review the fixed bucket name, nonpublic
   settings, browser-deny policies, `mystery_operator` role, registry fields,
   RPC execute grants, immutable triggers and administrator/superuser limits.
3. **Credential separation:** approve a dedicated operator authorization,
   issuance, rotation, revocation and audit strategy that does not distribute
   the runtime service-role key or reuse a broad project JWT signing secret.
   The production CLI must target only that approved credential boundary.
4. **Backup and retention:** rehearse consistent Postgres registry and Storage
   object backups/restores; verify restored objects against every registered
   digest and retain versions pinned by parties. Define an owner-audited
   procedure for orphan cleanup; ordinary operator/runtime API roles cannot
   delete immutable package objects.
5. **Explicit apply and publication approval:** obtain approval for the exact
   target and migration, apply the reviewed schema before deploying dependent
   application code, then separately approve any package's editorial
   provenance/publication. Validator success is not editorial approval.
6. **Independent verification:** after an owner-authorized operation, verify
   migration history, deployment SHA, object digest/retention and production
   smoke test separately. Record the evidence and rollback plan; a green CI
   run, merged PR or owner attestation is not independent verification.

M2.2 must separately implement fresh party/member/assignment authorization
and an allowlisted own-dossier projection. Possessing or successfully loading
a complete package never authorizes its disclosure. Do not wire this loader
to a public route, host operation, server component props or player interface.

## Current limits and unfinished work

The app is `LOBBY`-only: private dossiers and game progression are not
implemented. Lobby updates use authenticated polling, not Supabase Realtime.
Supabase sessions from a recovered guest's lost browser cannot be globally
revoked by this app because the supported admin sign-out call requires that
session's JWT; rebinding and tombstoning remove that old principal's access
to the recovered participant, but its access token may remain authenticated
until expiry.

Production backups/restore rehearsal, retention, dedicated preview Supabase isolation, SMTP deliverability beyond owner test addresses, and anonymous-signup abuse monitoring still require verification/decisions (O-025, O-029). The database-backed rate limiter is distributed across app instances, but its principal fallback and forwarded-address proxy assumptions require monitoring before public promotion. This runbook records configuration and owner-attested results, not independent credentials inspection or permission for future production changes.

## Cloudflare Turnstile for Supabase Auth

The existing widget uses public sitekey `0x4AAAAAAGNYu6Zb0_5s2c2h`.
The **secret is already configured in Supabase Auth → Attack Protection**
(owner-confirmed); do not copy that secret into GitHub or Vercel.

The app displays this widget before host email magic-link requests, guest join,
and recovery requests. The challenge token is submitted to our Next.js server
action as `cf-turnstile-response`, then passed to Supabase's
`signInWithOtp({ options: { captchaToken } })` or
`signInAnonymously({ options: { captchaToken } })` when an anonymous guest
identity must be created. The browser widget issues the token; the Next.js
server action forwards it to Supabase Auth, which validates and consumes it.
Do not also call Cloudflare Siteverify with the same token in the action.

The join/recovery screen mounts one flow and one Turnstile widget at a time.
Switching flows unmounts the inactive form; do not render duplicate widgets or
reuse a token across actions.

Set `NEXT_PUBLIC_TURNSTILE_SITEKEY=0x4AAAAAAGNYu6Zb0_5s2c2h` in
Vercel Production (the source has this sitekey as a fallback).
Confirm the existing Cloudflare widget allows `app.onekillerparty.com` and
Supabase CAPTCHA protection is **enabled** with provider Turnstile. The
`NEXT_PUBLIC_` sitekey is public; do not put the Turnstile secret in Vercel
or client environment variables. Redeploy after changing public Vercel settings.

**Scope:** Supabase's CAPTCHA gate protects creation of anonymous guest
identities and host Auth OTP requests, including API calls made directly to
Supabase. When a guest already has an anonymous session, joining/recovery
does not call `signInAnonymously`, so the fresh widget is a UX gate rather
than a server-side verification for those existing-session actions. Separate
database-backed per-source rate limits still apply to joining and recovery.
If complete Turnstile enforcement for already-authenticated guest commands
becomes a requirement, design a **second separately verified challenge** with
secure app-side secret storage; never reuse the token consumed by Supabase.

For local integration CI, use Cloudflare's published dummy sitekey
`1x00000000000000000000AA`, with local Supabase CAPTCHA disabled as in
`supabase/config.toml`. This checks UI wiring and token forwarding but **does
not test live Supabase verification**. Production smoke testing must confirm a
real challenge succeeds for both host magic links and anonymous guest signup,
and that a missing or invalid token is rejected by Supabase. The actual
widget secret must never be captured in tests, PRs, or logs.
