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

## M1.5–M1.7 rollout status (checked 2026-11-23)

These are separate gates; a merged PR, successful CI run, or Vercel PR check
does not establish the next one.

| Milestone | Code merged | Production migration applied | Vercel Production deployed | Production smoke-tested |
| --- | --- | --- | --- | --- |
| M1.5 guest join/recovery | Yes; present in current main | **Unknown — owner verification required** (`20261122000000_guest_membership.sql`) | **Unknown — owner verification required** | **Unknown — owner verification required** |
| M1.6 public role assignment | Yes; [PR #34](https://github.com/benburleson/one-killer-party/pull/34) merged 2026-11-22 | **Unknown — owner verification required** (`20261122010000_public_character_assignment.sql`) | **Unknown — owner verification required** | **Unknown — owner verification required** |
| M1.7 lobby synchronization | Yes; [PR #36](https://github.com/benburleson/one-killer-party/pull/36) merged 2026-11-23 | **Not applicable**; polling uses existing RPCs | **Unknown — owner verification required** | **Unknown — owner verification required** |

CI run [#90](https://github.com/benburleson/one-killer-party/actions/runs/45087065308)
passed on the merged M1.7 `main` SHA. PR #36 also had a completed Vercel check,
but that check does not verify the production target or a production smoke
test. The earlier M1.3/M1.4 remote migration history is owner-reported in the
repository; it does not establish M1.5/M1.6 rollout. Update this table only
with a verified target, migration history, production deployment, and actual
smoke-test evidence.

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
  `supabase/config.toml`. The owner reported a prior production episode where
  this setting was disabled and guest join misleadingly reported an
  existing-account conflict. The current production setting is **unknown**:
  verify it directly before any guest-join rollout and have the owner approve
  any change. Do not enable it in previews unless they use an isolated,
  disposable Supabase project.
- **Delivery:** The owner reports custom SMTP configured in Supabase, following the Resend setup for One Killer Party. Intended dedicated sending domain: `auth.onekillerparty.com` with sender `no-reply@auth.onekillerparty.com`; **verify actual sender/domain and provider settings in the Supabase and mail-provider dashboards before relying on them**. SMTP host, username, password/API key, DNS ownership records, verified sender, and sending limits are managed in the providers' dashboards, **not in GitHub or Vercel client variables**.
- **DNS:** Keep sender-domain SPF/DKIM records as instructed by the email provider; avoid changing inbound MX records for the apex domain unless explicitly required. Check sender-domain verification, bounce/delivery diagnostics and provider sending limits.
- **Public host signup:** Custom SMTP enables email delivery beyond Supabase organization members, but does **not** implement guest party admission or recovery. Monitor abuse, throttling, CAPTCHA and delivery reliability before public promotion. Do not claim successful non-team-member delivery until it has been tested.

### Safe host smoke test

1. Navigate directly to `https://app.onekillerparty.com/host` in a fresh tab. Request a magic link with an authorized test inbox; avoid repeated requests that hit rate limits.
2. Follow the email link back to the exact app host; verify the signed-in dashboard.
3. Create one disposable test Blackwood party; save the initially displayed invite code privately (it cannot be recovered from its database hash).
4. Open and refresh the lobby; verify the host-only view, invitation rotation (old code invalidated), and sign-out protection. Do not publish real invite links or tokens.
5. Later verify delivery to a **non-organization** address after SMTP is configured, without exposing its address in logs/artifacts.

Troubleshooting: Vercel server log events tagged `host_magic_link` contain safe stage categories (`origin_rejected`, `invalid_email_format`, `provider_rejected`, `provider_accepted`, `unexpected_server_error`). `provider_accepted` means the Supabase API accepted the request, **not** that email was delivered. Use Supabase Auth and SMTP provider logs for downstream delivery. Origin checks compare the request `Origin` exactly with `APP_URL`; request `Referer` is not a substitute. Never log raw headers, user emails, magic links or service keys.

## Database migrations and separation

Migrations are committed under `supabase/migrations/` and reviewed alongside their related PR. The owner confirmed `20261121030000_lobby_persistence.sql` and `20261121040000_host_party_commands.sql` were applied to the linked production Supabase project, and both versions appeared in the remote migration history.

`20261122010000_public_character_assignment.sql` is the M1.6 production
migration, merged with [PR #34](https://github.com/benburleson/one-killer-party/pull/34).
Its application to Production is **unknown**; merging did not authorize it.
It backfills only the eight public role IDs for parties pinned to
`blackwood-affair` / `first-playtest-placeholder-v1`, updates the existing
party-creation RPC to register those IDs for newly created parties, and adds
the assignment and safe-read RPC projections. It does not add story content.
All migration and integration tests must use the disposable local Supabase
project; do not link or reset the production database.

For M1.5/M1.6 and other future production changes:

1. Explicitly verify the linked **target project and environment**; inspect the target database and existing migration history. Plan backup/restore and rollback for destructive or data-changing operations.
2. Review migration SQL, especially every introduced or modified RPC; compare the verified target with `npx supabase migration list --remote` and `npx supabase db push --dry-run --remote`.
3. Obtain specific human approval **for this migration** before using `npx supabase db push --remote`; review the CLI's exact target and migration list again at confirmation. Apply and verify required production migrations **before** deploying an app version that depends on their RPCs.
4. Verify remote migration history, the actual Vercel Production deployment, and the production smoke test separately. Record links, timestamps, and any incident in durable issue/PR evidence.

**Never** let Copilot, PR CI, or a test workflow migrate/reset Production. Never run a remote/linked database reset, migrations from unreviewed agent code, or automated integration tests against Production. Local tests use `npx supabase db reset --no-seed` and `npx supabase test db` against disposable Docker Supabase only.

## Current limits and unfinished work

The merged app supports M1.5 guest joining, removal and host-assisted recovery;
M1.6 public assignments; and M1.7 spoiler-safe polling/reconciliation. Their
production migration/deployment/smoke status is recorded separately above.
M1.7 uses authenticated polling, not Supabase Realtime, and adds no migration.
Private dossiers and game progression are not implemented. Supabase sessions
from a recovered guest's lost browser cannot be globally revoked by this app
because the supported admin sign-out call requires that session's JWT;
rebinding and tombstoning remove that old principal's access to the recovered
participant, but its access token may remain authenticated until expiry.

Production backups/restore rehearsal, retention, dedicated preview Supabase isolation, SMTP deliverability beyond owner test addresses, and anonymous-signup abuse monitoring still require verification/decisions (O-025, O-029). The database-backed rate limiter is distributed across app instances, but its principal fallback and forwarded-address proxy assumptions require monitoring before public promotion. This runbook records configuration and owner-reported results, not independent credentials inspection or permission for future production changes.

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
