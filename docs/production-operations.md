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
- **Guest auth:** M1.5 requires Supabase anonymous sign-in. The local disposable
  project enables it in `supabase/config.toml`; Production's Auth setting has
  not been changed. Before releasing the reviewed M1.5 migration, obtain
  separate owner approval and enable anonymous sign-in only for the intended
  Production project. Do not enable it in previews unless they use an isolated,
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

For **future** production changes:

1. Explicitly verify the linked **target project and environment**; inspect the target database and existing migration history. Plan backup/restore and rollback for destructive or data-changing operations.
2. Review migration SQL and compare what would apply with `npx supabase migration list --remote` and `npx supabase db push --dry-run --remote`.
3. Obtain specific human approval **per production migration** before using `npx supabase db push --remote`; review the CLI's exact target and migration list again at confirmation.
4. Verify remote migration history and app functionality after deployment. Record links and any incident in durable issue/PR evidence.

**Never** run a remote/linked database reset, migrations from unreviewed agent code, or automated integration tests against Production. Local tests use `npx supabase db reset --no-seed` and `npx supabase test db` against disposable Docker Supabase only.

## Current limits and unfinished work

M1.4 supplies host authentication, party creation, invitation issuance/rotation and a host-safe lobby. M1.5 guest joining, lobby admission, removal and host-assisted recovery are implemented in a pending migration and application change; they are not deployed to Production, and the shareable invitation URL does not admit players there until separately approved and applied. Supabase sessions from a recovered guest's lost browser cannot be globally revoked by this app because the supported admin sign-out call requires that session's JWT; rebinding and tombstoning remove that old principal's access to the recovered participant, but its access token may remain authenticated until expiry. Role assignment (M1.6), realtime/reconnect (M1.7) and private gameplay data are not available.

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
identity must be created. **Supabase validates and consumes this token.** Do
not also call Cloudflare Siteverify with the same token in the Next.js action.

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
