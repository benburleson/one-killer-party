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
| `20261123000000_browser_role_lockdown_and_join_pin.sql` | Applied | Owner attestation for M2.1c (2026-11-23); not independently verified |
| `20261123010000_private_mystery_packages.sql` | Applied | Owner attestation for M2.1c (2026-11-23); not independently verified; no publication or rehearsal reported |

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

## Private mystery package storage and publishing (M2.1b/M2.1c)

M2.1b implements private Storage, a restricted published registry, a
local-only operator CLI and a server-only exact-reference loader. The owner
reports both current migrations as applied to Production (owner attestation
only); no dashboard, migration-history, deployment or object inspection was
performed for this issue. Production publishing is still disabled.
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
superuser can disable triggers or alter the schema. The legacy integration CLI
derives a short-lived custom-role JWT from the local project JWT secret. This is **not**
a production operator credential design: the project signing secret is too
broad to treat as a separately scoped production publisher credential.

### Owner publisher decision and production activation gate (M2.1d)

**Decision, 2026-11-24:** the owner alone authorizes publication. A second
human approver or independent approval service is not required. The approved
approval is an MFA-authenticated owner session plus an exact interactive
confirmation of the target, project, package ID/version/schema, canonical
SHA-256 digest and rule set. The CLI must bind the confirmation to those
values, recheck the session immediately before registration, and retain
identity, time, provenance and approval reference in the audit record.
Confirmation flags or self-reported metadata without that authenticated
session are not authorization.

This approval does **not** create separation of duties. The owner-controlled
MFA account/session, Supabase Auth configuration and privileged database
administrators remain trusted; compromise of the session, device or those
administrative controls could authorize publication. The exact confirmation
limits accidental or unattended publication but is not an independent
verification service.

Production remains disabled until the owner provisions the approved
production identity/session and mapping, confirms MFA and credential custody,
and completes the separately approved synthetic publication and recovery
rehearsal. No Production target, credential or package is configured by this
documentation change. The existing local CLI remains a disposable test
harness until those gates are completed.

`npx supabase login` authenticates the CLI to the **Management API**; listing
projects does not authorize Storage or the publication RPC as
`mystery_operator`. Browser login issues a full-account-access personal access
token (PAT); limited PATs can be configured separately. Neither kind is a
demonstrated project JWT with that role. Do not use a PAT to retrieve a
service-role/secret key, a JWT signing secret or a database password for
publishing, and do not build a Management API privilege bridge or public
publishing endpoint. Secret keys bypass RLS and have broad Storage access.
See [personal access tokens](https://supabase.com/docs/guides/platform/personal-access-tokens),
[CLI authentication](https://supabase.com/docs/reference/cli/introduction),
[Management API](https://supabase.com/docs/reference/api/introduction) and
[API keys](https://supabase.com/docs/guides/getting-started/api-keys).
These links could not be rechecked live for M2.1d because network access was
unavailable; the Management API distinction and owner-reported CLI test are
not a proof of a supported role-token bridge.

The legacy local-only command and its environment are in the
[package contract](architecture/mystery-content-package.md#local-operator-publishing-and-trust-boundary).
It takes explicit flags and uses the disposable project's JWT secret; it is
not suitable for real packages or Production. The separate local Auth
experiment below is not a Production implementation. A future Production
workflow must display the verified environment/project, owner identity,
package ID/version/schema, rule set and digest and require explicit
confirmation; cancellation or failed verification must cause no writes. The
owner must first decide between the following alternatives, after current
official documentation and a disposable end-to-end proof are available:

The approved direction is an owner-operated MFA-authenticated session, not a
separate issuer or approval provider. The follow-up must specify the
production identity mapping, session expiry/revocation, MFA assurance,
credential custody, compromise recovery, and prove both Storage and RPC
behavior in a disposable environment. Production Auth changes, credential
issuance, remote writes and synthetic rehearsal remain separately authorized
human operations after review.

### Credential trust boundary

No Production credential or CLI target is configured. The selected Supabase
database grants are narrow, but the MFA-authenticated session must still
produce a project-trusted token carrying the exact `role: mystery_operator`
claim. PostgREST extracts the role claim and assumes that PostgreSQL role only
when the JWT signature is trusted and the role is granted to `authenticator`;
Storage independently validates the bearer JWT and uses the role for its RLS
checks. A random OIDC token, anon key, or new API key does not acquire this
role. See Supabase's [JWT guide](https://supabase.com/docs/guides/auth/jwts),
[signing keys guide](https://supabase.com/docs/guides/auth/signing-keys),
[third-party Auth overview](https://supabase.com/docs/guides/auth/third-party/overview),
and [PostgREST JWT role claims](https://postgrest.org/en/stable/references/auth.html).
The official docs source was reviewed; live docs access was unavailable from
the development environment.

Never give publisher operators `SUPABASE_SERVICE_ROLE_KEY` or the broad
project JWT signing secret, and do not substitute a long-lived database
credential. `service_role` still bypasses RLS and has broad Storage access;
database owners/superusers can change grants, disable triggers or alter rows.
No mechanism here claims isolation from those privileged credentials.

| Identity | Intended access | Important limit |
| --- | --- | --- |
| `anon` / `authenticated` browser roles | No package bucket listing/read/write; no registry access or publication RPC | Verify both Storage policies and RPC/table grants; route absence alone is insufficient |
| Runtime `service_role` | Exact-reference registry lookup and private object read through the server-only loader | Bypasses RLS and retains broad Storage API powers; can read unregistered orphans and must remain server-only |
| `mystery_operator` | Package object `SELECT`/`INSERT` and `publish_mystery_version` only | Cannot directly read registry or use ordinary API deletion; production mapping is not provisioned |
| Owner MFA session / publisher operator | Receive a short-lived token scoped to `mystery_operator`; invoke Storage and registration only after exact interactive confirmation | Approved direction, but not provisioned or rehearsed. Compromise of the owner session or trusted signing/admin controls may authorize publication or escalate beyond intended grants |
| Database owner / superuser | Administrative recovery and schema maintenance | Can bypass RLS, alter registry or disable triggers; trusted administrator boundary remains |

The reusable publisher requires the MFA-authenticated owner session and exact
interactive confirmation to bind environment, exact Supabase project
reference, package ID/version/schema, canonical digest and exact rule set. It
rechecks the session and confirmation immediately before registry insertion,
after upload and readback. Its immutable approval ID/reference and
identity/time evidence must be recorded in the registry/audit system. A bare
`--approved-by` or `--approval-reference` is never authorization. No
independent approval service or second human is required; the owner session
and Supabase administrative trust boundary remain explicit limitations.
Production publishing remains disabled until the owner provisions and
rehearses this workflow.

### Production publisher review artifact (M2.1f-a)

**Code review is not activation.** The separately reviewed
`scripts/production-publisher-hook-review.sql` is not a migration and does not
enable an Auth hook or create a publisher identity. The local example below
must never be used as a Production hook. The proposed artifact maps a single
Auth UUID in a non-public table, preserves unrelated token claims, and adds a
server-side `aal2` and current-mapping check to both private Storage access and
the registration RPC. The Auth hook alone is **not** an MFA boundary.
Production publishing remains blocked until the owner provisions the
identity-backed, revocable MFA session and demonstrates the exact
confirmation workflow in the approved rehearsal; this is owner approval, not
an independent verifier.

The candidate configuration validator expects an explicitly selected
`MYSTERY_PRODUCTION_PROJECT_REF`, matching
`MYSTERY_PRODUCTION_SUPABASE_URL` (`https://<project-ref>.supabase.co`),
`MYSTERY_PRODUCTION_ANON_KEY` (publishable or project anon key), and the
dedicated `MYSTERY_PUBLISHER_EMAIL` and `MYSTERY_PUBLISHER_USER_ID`. These
are configuration inputs, not authority to publish. The candidate Keychain
label is `one-killer-party.mystery-publisher.production.<project-ref>` and
the account is the UUID. No Production values are checked in. Production enrollment remains disabled;
`--target production --keychain` is the supported routine path once the
owner-approved mapping exists, while `--enroll-keychain` is rejected for the
Production target. The CLI still requires the separate provisioning,
preflight and rehearsal gates below before any live use.

Two independent gates remain:

1. **Owner-run read-only Production preflight and security review.** Complete
   the inspection below, compare existing grants, policies, functions and Auth
   hook configuration with the reviewed design, and stop on any mismatch or
   existing hook. An existing hook must not be overwritten; any composition
   requires its own review. Verify backup and recovery before requesting
   authorization for changes.
2. **Separately approved Production Auth provisioning and synthetic rehearsal.**
   Only after approval may the owner provision a dedicated user and TOTP,
   install and configure the reviewed boundary, and rehearse using synthetic
   content. Prove ordinary host magic-link/OTP and anonymous guest sign-in
   still work; prove publisher `aal1` cannot insert/read private objects or
   register and `aal2` can, while ordinary and anonymous identities cannot
   read private bytes or publish. Record only redacted results. No Production
   changes or rehearsal are authorized by this PR or its CI.

For revocation, stop publishing and remove the private UUID mapping under an
approved administrative procedure. The reviewed SQL checks the mapping at
each Storage and registration request, so removal is intended to deny even
previously issued publisher tokens at those boundaries. Also revoke Auth
sessions, rotate the password and TOTP as appropriate, and account for tokens
already issued elsewhere and privileged roles that bypass RLS. Confirm the
denial in a disposable rehearsal; restoring the same UUID mapping can
reactivate an unexpired token, so revoke sessions and wait out its lifetime
before remapping. Do not assume disabling a hook invalidates existing JWTs.
Before hook rollback, stop new issuance and remove the mapping;
restore any prior hook only through a separately reviewed plan. Do not remove
the MFA policies or restore the unguarded RPC while publisher tokens remain
usable. Never weaken private-bucket immutability to resolve an orphan.

After both gates and an explicit authorization for the change, the owner can
install the reviewed SQL from a trusted checkout in an authenticated `psql`
session whose database target has been independently verified:

```text
\set ON_ERROR_STOP on
\i scripts/production-publisher-hook-review.sql
INSERT INTO private_mystery.production_publisher_identity (user_id)
VALUES ('<APPROVED-PUBLISHER-AUTH-UUID>'::uuid);
```

Replace the placeholder privately, not in a committed file. The script does
not activate Auth. If the Auth custom-access-token hook is already configured,
stop; do not overwrite it. After separate approval, select
`private_mystery.production_publisher_hook` as the custom-access-token hook
using the supported Supabase configuration interface and verify the resulting
configuration. The installation is idempotent only in the absence of drift:
on a repeat it does not repair modified objects. Inspect the objects and grants
before and after installation, and stop on collisions or unexpected state.

To revoke the publisher, the authorized owner can remove the mapping in the
same independently verified database:

```sql
DELETE FROM private_mystery.production_publisher_identity
WHERE user_id = '<APPROVED-PUBLISHER-AUTH-UUID>'::uuid;
```

Confirm the old token is denied, revoke the Auth session, and rotate the
credential. When rolling back, first remove the mapping and disable the
publisher hook; restore a prior hook only if its exact configuration and
composition have been reviewed. Leave the restrictive policy and guarded RPC
in place until all old tokens have expired or are otherwise demonstrably
ineffective. Removing those guards requires a separately reviewed database
rollback and verification; simply disabling the hook is not a safe rollback.

#### macOS Keychain experiment

The Keychain integration can currently be exercised only with the disposable
local publisher above; Production targeting is blocked in code pending the
approved identity-backed verifier, not enabled by setting environment values.
Install dependencies with `npm ci`, configure the disposable local user and
environment as below, and enroll a verified TOTP factor for that user. Then
run these commands in an interactive macOS terminal:

```sh
npm run mystery:publish -- --target local --enroll-keychain
npm run mystery:publish -- --target local --keychain /absolute/path/to/synthetic-package.json
```

The first command prompts without echo for the password and a TOTP code,
verifies them against local Auth, and stores the password under the Keychain
service `one-killer-party.mystery-publisher.local`, with the user UUID as the
account. The second retrieves it, signs in afresh, prompts for TOTP and requires
`PUBLISH` for the displayed package. Passwords accepted by this experiment
must use only ASCII letters, digits, `_` or `-`; choose a long random one.
macOS may prompt to unlock the Keychain or permit access; deny unexpected
requests. No password is passed in process arguments or written to a file.
Keep the Keychain locked when not in use and never store a service-role key,
signing secret, Management API PAT, or database password in this entry.

To remove the local entry, use Keychain Access or, with the local UUID still
set in the shell:

```sh
security delete-generic-password -s one-killer-party.mystery-publisher.local -a "$MYSTERY_PUBLISHER_USER_ID"
```

For rotation, stop publishing, remove the old mapping and revoke sessions,
rotate the dedicated user's password and TOTP using the approved Auth
procedure, delete the old Keychain entry, then enroll the new credential after
the identity mapping has been restored. On device compromise, immediately
revoke the mapping and sessions from a trusted device, rotate the credentials
and review access and orphaned objects; do not assume Keychain deletion
invalidates tokens already issued.

### Local Auth publisher experiment

This procedure is **only for a disposable local Supabase stack and synthetic
content**. It describes the companion `mystery:publish` command and
`scripts/local-publisher-hook.sql`; check that both are present before use.
Documentation alone neither installs them nor demonstrates that they work.
Do not use linked or remote databases, Production credentials, or real
mystery content. Never commit the local config change, credentials or package.

1. Start the disposable stack with `npx supabase start`. Verify that the API,
   database and Studio are local on ports 54321, 54322 and 54323 respectively;
   keep forwarded ports private. Obtain the local anon key and database
   credentials from the local stack's status privately; do not copy status
   output, passwords, tokens or keys into logs, issues or shell history.
2. Connect `psql` directly to the **local** database and install the
   `private_mystery.local_mystery_publisher_hook` and private mapping table,
   after inspecting the script and confirming the target. Keeping the hook in
   the private schema avoids adding a public RPC. Use an interactive password
   prompt, not a password in the URI or command line:

   ```sh
   psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -W \
     -v ON_ERROR_STOP=1 -f scripts/local-publisher-hook.sql
   ```

   The SQL installation does not activate the hook. Do not run it against a
   remote database or add it as a migration. If installation fails, inspect the
   local state before retrying; do not assume the script is idempotent.
3. In local Studio at `http://127.0.0.1:54323`, create a disposable Auth user
   with an email and password. Record its Auth UUID privately. In an
   interactive `psql` session using the same explicitly local connection,
   insert that UUID into the private mapping, replacing the placeholder with
   the local user's UUID:

   ```sql
   INSERT INTO private_mystery.local_publisher_identity (user_id)
   VALUES ('<LOCAL-AUTH-USER-UUID>'::uuid);
   ```

   This is a singleton mapping: remove the old mapping before assigning a
   replacement. Do not map a real account. The hook remains disabled until
   explicitly enabled in the next step.
4. In the local, **uncommitted** `supabase/config.toml`, set:

   ```toml
   [auth.hook.custom_access_token]
   enabled = true
   uri = "pg-functions://postgres/private_mystery/local_mystery_publisher_hook"
   ```

   Restart the disposable local stack (`npx supabase stop` followed by
   `npx supabase start`) to apply the Auth configuration. Do not use
   `--no-backup` if retaining this disposable local state for the experiment.
   Never apply this configuration to Production.
5. In a private interactive shell, enter the local anon key, disposable
   user's email and its UUID at the prompts rather than putting values in
   shell history. Keep the synthetic package outside the repository:

   ```sh
   export SUPABASE_URL=http://127.0.0.1:54321
   read -r -s -p "Local anon key: " SUPABASE_ANON_KEY; printf '\n'
   read -r -p "Disposable user email: " MYSTERY_PUBLISHER_EMAIL
   read -r -p "Disposable user UUID: " MYSTERY_PUBLISHER_USER_ID
   export SUPABASE_ANON_KEY MYSTERY_PUBLISHER_EMAIL MYSTERY_PUBLISHER_USER_ID
   npm run mystery:publish -- /absolute/path/to/synthetic-package.json
   ```

   Use a TTY for the password and confirmation prompts; do not put the password
   in an environment variable or command line. The flow is intended not to
   persist secrets. Review the displayed target and package details before
   typing `PUBLISH` to confirm; cancel on any mismatch. Do not record raw
   output containing private content, tokens or credentials. Unset the shell
   variables afterward:

   ```sh
   unset SUPABASE_URL SUPABASE_ANON_KEY MYSTERY_PUBLISHER_EMAIL MYSTERY_PUBLISHER_USER_ID
   ```

This is a local Auth session with a custom role claim, not a Supabase CLI
Management API PAT. A PAT or anon key alone cannot confer the publishing role.
Installation or successful sign-in does not prove Storage **and** the
registration RPC work. The issue reports an initial `REGISTRATION_FAILED`
after upload on 2026-11-24, followed by a successful retry; the root cause
remains unknown. This implementation's local integration verified an orphan
retry and a conflicting publication, but did not reproduce that initial
failure. Do not extrapolate these local results to Production.

`npm run test:integration:owner` requires a disposable local Supabase stack
with the local hook installed and active. It creates and deletes disposable
Auth users and the local publisher mapping; the singleton mapping must be
available before the test. Never run it against Production.

For rotation or cleanup, stop publishing, delete the mapped row locally
(`DELETE FROM private_mystery.local_publisher_identity;`), disable the hook
in the uncommitted config and restart the local stack. Delete the disposable
Auth user in Studio and remove local credentials from the shell; restore the
config file without committing it. An already issued JWT remains usable until
expiry even after the mapping is deleted or the hook is disabled. To rotate,
provision a new disposable user and mapping and repeat the local activation
steps; never reuse this experiment as a Production credential.

On a partial publish, preserve evidence and check the exact local registry
identity and object digest. Upload and registration are not atomic: an object
may be an unregistered orphan. Retry only the identical package bytes; an
identical registered version is idempotent, while different bytes for the same
version conflict. Do not automatically delete objects or weaken immutable
triggers; use the separately reviewed reconciliation procedure below if
cleanup is necessary. A disposable reset loses local state and is not a
Production recovery procedure.

### Owner-operated read-only Production preflight

Only an authorized owner may perform this inspection after this PR is reviewed.
It is **read-only**: do not run `db push`, alter Auth or Storage settings, issue
tokens, upload/delete objects, or publish. Record redacted links and result
timestamps; do not paste secret values, package bytes or object locators in
GitHub.

1. Select the exact Supabase project ID from the owner-controlled console and
   independently confirm its Production label and expected Vercel project;
   never infer target from a shell default or URL alone.
2. Inspect remote migration history for both `20261123000000` and
   `20261123010000`; compare against reviewed migration files. Record this as
   independent verification (or report mismatch), separately from the
   owner-reported application status above.
3. Inspect the package bucket's ID, private flag, MIME/size limits and
   browser-deny Storage policies. Inspect `mystery_operator` membership/grants,
   table RLS/force-RLS, immutable triggers, the exact `publish_mystery_version`
   and `get_published_mystery` execute grants, and confirm no browser role can
   list/read package bytes. Inspect direct and transitive operator-role
   membership: only `authenticator`, the trusted `supabase_storage_admin`
   database service, and the explicitly trusted administrative roles allowed
   by the reviewed artifact may assume it. Those database credentials can
   forge claims; their custody is part of the trust boundary. Repeat this review
   after installation because later role grants are not prevented by the
   installer. Use read-only catalog/dashboard inspection only.
   If using the SQL editor, run only read-only checks like the following and
   keep raw result rows in the owner's restricted audit system:

   ```sql
   SELECT version
   FROM supabase_migrations.schema_migrations
   WHERE version IN ('20261123000000', '20261123010000')
   ORDER BY version;

   SELECT id, public, file_size_limit, allowed_mime_types
   FROM storage.buckets
   WHERE id = 'private-mystery-packages';

   SELECT policyname, roles, cmd, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename IN ('objects', 'buckets')
     AND policyname LIKE 'private_mystery%';

   SELECT rolname, rolcanlogin,
          pg_catalog.pg_has_role('authenticator', rolname, 'MEMBER') AS authenticator_member,
          pg_catalog.has_table_privilege(rolname, 'private_mystery.published_versions', 'SELECT') AS registry_select
   FROM pg_roles
   WHERE rolname IN ('mystery_operator', 'anon', 'authenticated', 'service_role');

   SELECT pg_catalog.has_function_privilege(
            role_name,
            'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)',
            'EXECUTE'
          ) AS can_publish,
          role_name
   FROM unnest(ARRAY['mystery_operator', 'anon', 'authenticated', 'service_role'])
     AS principals(role_name);

   SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, t.tgname, t.tgenabled
   FROM pg_class AS c
   LEFT JOIN pg_trigger AS t ON t.tgrelid = c.oid AND NOT t.tgisinternal
   WHERE c.oid IN (
     'private_mystery.published_versions'::regclass,
     'storage.objects'::regclass
   )
   ORDER BY c.relname, t.tgname;
   ```

4. Confirm service-role credentials are confined to the server runtime; no
   publisher, GitHub Actions, Copilot, PR preview or public client receives
   them. Record only yes/no and credential owner, not values. Confirm no
   Production issuer/approval artifact is configured until its separate
   decision is approved.
5. Inspect current deployment SHA and verify it does not expose package data
   through browser routes, RSC/client payloads, notifications or public
   Storage. A trusted loader is not player authorization; M2.2 must separately
   revalidate fresh party pin, member and assignment before an allowlisted
   dossier projection.
6. Review existing encrypted Postgres and object-backup inventory, access
   separation, retention and latest restore evidence. A database-only backup
   is insufficient. Stop and request owner decision if any item is unknown.

### Backup, retention, recovery and orphan controls

Production backup must capture a consistent registry snapshot **and** every
private bucket object. Pause publisher use for the snapshot window; save an
encrypted Postgres custom-format dump/snapshot and a separately encrypted
object archive with a protected manifest containing each object path and
SHA-256. Encrypt before offsite transfer using owner-approved KMS-managed keys;
limit restore-key access to named recovery operators and keep it separate from
the publisher identity. Never store bytes, manifests, keys or raw logs in
GitHub artifacts. The owner must approve a concrete retention schedule and
restore location before activation. Proposed minimum policy for review: daily
backups retained 35 days plus monthly copies retained 12 months; preserve
objects indefinitely while any party pin references them, then retain until an
audited content-retirement decision.

The local integration test exports exact registry rows from the local lookup
RPC and matching bytes from local private Storage, then loads two versions
through an isolated restore adapter. It confirms missing or tampered snapshot
bytes fail closed. This is a useful application-level consistency test, not a
physical database restore, object-store restore or KMS/offsite test; no full
backup restoration has been demonstrated. Keep the distinction explicit in
handoff evidence.

For restore, use an isolated disposable project with the reviewed migration
version and compatible Storage schema; restore the registry and object bytes
from the same snapshot generation, then cross-check every registry identity,
schema, rule-set, path and digest against exact object bytes with
`loadVerifiedMysteryDefinition`. Also enumerate backup objects absent from the
registry as orphan candidates. Do not point the app at a partial restore. Test
both versions of the synthetic fixture independently and confirm a missing or
changed object returns only `CONTENT_UNAVAILABLE`. Local unit/integration
checks cover these integrity/fail-closed cases; a full Postgres-plus-Storage
backup restore rehearsal is still a human production gate and has not been
performed.

Never automatically clean up package objects. An authorized reconciliation
operator exports a redacted candidate list, rechecks each canonical path
against the registry and all party pins immediately before action, obtains
separate human approval, pauses concurrent publication for the affected
identity, then records candidate digest, decision, actor, time and result in
the owner audit system. The normal triggers intentionally prohibit deletes,
including by service_role. If an orphan must be removed, use a separately
reviewed, narrowly privileged maintenance window with a reversible backup;
do not weaken triggers or add a general-purpose deletion RPC. Preserve every
registered or referenced object across deployments and rollback.

### Incident and release rollback

- **Lost publisher token/key:** stop publishing, revoke/retire the issuer key
  under the owner-approved key lifecycle, wait for the applicable verification
  cache/expiry window, review issuer audit for unexpected issuance, and issue a
  replacement only after owner approval. Do not rotate the project-wide legacy
  secret as a convenience.
- **Registry compromise:** suspend the issuer, preserve audit evidence, compare
  registry and object manifests to the last known encrypted backup, and have a
  database owner assess rollback/repair. Immutability triggers are not a
  defense against that owner.
- **Missing/tampered object or partial publication:** fail closed; do not serve
  another version or "latest". Preserve evidence, reconcile exact registry and
  digest, then restore the same immutable object from verified backup or issue
  a corrected new version and separately approve any party migration decision.
  An uploaded but unregistered object is an orphan; identical retries are safe,
  changed bytes/version conflicts are not.
- **Application release rollback:** restore the prior deployment while keeping
  every registered object and party-pinned version. Confirm the old code
  understands those schema/rule versions. Never delete or repin a party as
  part of application rollback.

### Separately approved synthetic Production rehearsal

This is a future checklist only, not authorized or executed by this issue. It
requires reviewed code, an independently verified read-only preflight, owner
provisioning of the MFA session and exact-confirmation mapping, approved
encrypted backups with a successful isolated restore, and a separate written authorization naming the
exact synthetic package identity/digest/rule set/Production project. After
those gates, an owner-operated session may verify identity and
short expiry, review the safe summary, publish only a non-story synthetic
sentinel package, independently verify registration/object digest and
browser/unauthenticated denial, capture redacted audit evidence, and execute
an approved recovery/rollback plan. No real mystery package or editorial
content belongs in this rehearsal. This issue performs none of these steps.

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
