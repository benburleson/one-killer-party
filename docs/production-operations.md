# Production operations

**Scope:** the live application, Auth, publisher credentials, mystery package publication, security checks, backups and recovery. This is a **current-state runbook**, not a deployment or implementation diary. Product behavior is in [the product spec](product/product-vision.md); private content technical details are in [the package contract](architecture/mystery-content-package.md).

## Live environment and verified boundaries

| System | Location / status |
| --- | --- |
| Marketing | `https://onekillerparty.com`, `https://www.onekillerparty.com` |
| Next.js app and host sign-in | `https://app.onekillerparty.com`, `/host` |
| Supabase Auth callback | `https://app.onekillerparty.com/auth/callback` |
| App deployment | Vercel Production |
| Authentication/data | Hosted Supabase Production, migrations through `20261123010000_private_mystery_packages.sql` applied (owner-verified) |
| Lobby | Host magic links, guest anonymous sign-in/recovery, invites, public assignments and polling tested in Production; **LOBBY only** |
| Auth hook | **Enabled:** Custom Access Token Hook → Postgres `private_mystery.production_publisher_hook` |
| Private mystery package | Registry and private bucket installed; one **synthetic** version published and checked. No real story package published |
| Publisher | One dedicated Auth identity mapped in `private_mystery.production_publisher_identity`; TOTP verified at AAL2, Turnstile sign-in and macOS Keychain enrollment tested |

**Evidence and limits (November 26, 2026):** owner-operated checks verified the registration RPC permissions (`anon`, `authenticated`, `service_role` denied; `mystery_operator` allowed), browser-role non-membership, registration row and Storage object for `synthetic-mystery/1.0.0-test.1`, object size **5730 bytes**, content type `application/json`, and an unauthenticated download failure (HTTP 404). The publisher CLI reported successful publication and readback. An actual **authenticated ordinary-host JWT** Storage denial test was **not completed**; do not misrepresent the browser HTTP 400 test as one. We have not independently re-downloaded and hashed the Production object outside the publisher CLI. Do not treat this synthetic success as editorial approval to publish Blackwood content.

## Production configuration

Vercel server environment:

| Key | Purpose |
| --- | --- |
| `APP_URL` | Exact `https://app.onekillerparty.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Correct project API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public project publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only**; never expose to clients, PRs or previews |
| `NEXT_PUBLIC_TURNSTILE_SITEKEY` | Public Cloudflare sitekey; permitted on app hostname |

Never attach Production service credentials to PR preview deployments. Redeploy after Vercel environment changes. `www` and root marketing links must redirect host actions to the **app** hostname; do not weaken exact-Origin checks.

In Supabase Auth, keep email magic-link/OTP hosts, anonymous guest sign-ins, callback URL, custom SMTP and Cloudflare Turnstile configured. The Turnstile **secret belongs in Supabase Auth**, not in Vercel or this repository. Supabase consumes the `captchaToken` once; do not separately run Cloudflare Siteverify against the same token. SMTP sender/domain verification, SPF/DKIM, sending limits, bounce logs, auth rate limits and CAPTCHA failures require ongoing monitoring; do not infer email delivery from API acceptance.

### Normal app smoke test

Using separate private browsing contexts, verify: (1) host magic link delivers to a test inbox and returns to `/host`; (2) host creates a disposable test lobby and sees host-only data; (3) guest joins via Turnstile and reaches lobby; (4) rotating invitations invalidates prior codes; (5) refresh and sign-out preserve authorization boundaries; (6) host/guest public character assignment never reveals private content. Do not put invite codes, email addresses, token payloads or private content in logs or issue comments.

## Publisher access and authentication

Publisher authorization is not based on admin/service-role keys. The database installer lives at `scripts/production-publisher-hook-review.sql` and includes `supabase/tests/production-publisher-hook-review.inc`. **Both are mutating installer source, not inspection scripts. Do not rerun or change them casually.** Production installation has already happened.

- The Auth hook maps only the UUID in the singleton identity table to JWT role `mystery_operator`. It preserves other identities' normal roles; it does **not** itself enforce MFA.
- The guarded registration RPC and restrictive private Storage policy independently require a currently mapped publisher user and JWT `aal2`. The registered original function is private; browser roles cannot execute the public wrapper.
- The operator authenticates with a password, **fresh Turnstile** and **fresh TOTP**, verifies issuer, user, role, AAL2 and token freshness, then explicitly confirms the exact package. No authorization is conferred by having a publishable/anon key alone.
- Production does not host a publisher password/session page. `https://app.onekillerparty.com/publisher-verification` provides **only** a short-lived Turnstile token for copying into the CLI. Do not log, paste into chat, save or reuse a token.
- Use a dedicated trusted Mac. The Keychain service is `one-killer-party.mystery-publisher.production.<project-ref>`, account = approved publisher UUID. The CLI stores the **password**, not JWT/refresh tokens or a TOTP secret. Native macOS permissions and access prompts must be respected.

### Local operator configuration

From a trusted local checkout run `npm ci`. In your **private** operator shell set `MYSTERY_PRODUCTION_PROJECT_REF`, `MYSTERY_PRODUCTION_SUPABASE_URL` (exactly `https://<ref>.supabase.co`), `MYSTERY_PRODUCTION_ANON_KEY` (publishable/anon, **not** service-role), `MYSTERY_PUBLISHER_EMAIL`, and `MYSTERY_PUBLISHER_USER_ID`. Do not store real values in GitHub, CI, Vercel, or shell history. Verify the displayed project and identity before every privileged step.

First-time MFA enrollment (**only if no factor is enrolled**) is:

```sh
npm run mystery:publish -- --target production --enroll-mfa
```

The enrollment-only flow signs in with Turnstile, checks the expected UUID and ordinary pre-hook identity, creates/verifies one TOTP factor and AAL2, then signs out. It does **not** publish or touch Keychain. Keep the setup secret off recordings, screenshots, logs and clipboard. If a factor exists or enrollment is interrupted, **stop** and use reviewed recovery; do not silently delete factors. The hook must be explicitly configured/approved separately for any new Production deployment, not by running this command.

Enroll or refresh the Mac Keychain entry only after MFA and role verification:

```sh
npm run mystery:publish -- --target production --enroll-keychain
```

A real publisher password can include periods and other punctuation; the CLI stores it as a validated encoded Keychain value to avoid `security -i` parser ambiguities. Do not attempt a second enrollment after a failure without checking for a partial entry. Verify presence **without reading the password**:

```sh
security find-generic-password \
  -s "one-killer-party.mystery-publisher.production.${MYSTERY_PRODUCTION_PROJECT_REF}" \
  -a "$MYSTERY_PUBLISHER_USER_ID" >/dev/null 2>&1
```

Remove an entry deliberately with Keychain Access or:

```sh
security delete-generic-password \
  -s "one-killer-party.mystery-publisher.production.${MYSTERY_PRODUCTION_PROJECT_REF}" \
  -a "$MYSTERY_PUBLISHER_USER_ID"
```

**Removing Keychain data does not revoke Auth tokens.** Password/TOTP rotation or suspected compromise requires: suspend publishing; remove the identity mapping (separately approved), revoke provider sessions, wait for issued token expiry, rotate credentials, re-enroll Keychain safely, then restore mapping only after review. Readding a mapped UUID can revive an unexpired token. Never restore the unguarded original RPC while publisher tokens remain active.

## Publishing an immutable package

**Each new Production package requires a separate owner approval** naming project, mystery ID, version, rule set and canonical SHA-256; only private, reviewed story content may be approved for actual release. Keep canonical source files in encrypted, backed-up operator storage outside this public repository. The CLI requires an **absolute path outside the repo**.

```sh
npm run mystery:publish -- --target production --keychain \
  "/absolute/path/outside/repository/package.json"
```

The CLI reads and validates the package, signs in with a fresh CAPTCHA and TOTP, prints the target/version/rules/digest, and waits for exact `PUBLISH` confirmation. Type it **only when those values match the separate approval**. It uploads to the private `private-mystery-packages` bucket, reads back, verifies, and registers an immutable record. Never substitute a service-role key, reuse tokens, blindly retry, or auto-delete an object.

**Synthetic rehearsal record (November 26, 2026):**

| Field | Value |
| --- | --- |
| Identity | `synthetic-mystery` / `1.0.0-test.1` |
| Rule set | `eight-role-prototype-v1` |
| SHA-256 (canonical) | `b08af09b4470c30f6471b78ee3a3e3aa29a62f25d363fb1b803cf54c9170cdc2` |
| Private path | `synthetic-mystery/1.0.0-test.1/<digest>.json` |
| Published at | 2026-11-26 20:44 UTC |
| Result | CLI `published`; one registry row and one matching private Storage object; anonymous download denied |

This **synthetic version is intentionally retained** and immutable. The current Product runtime still uses a public Blackwood lobby placeholder and does not load dossiers.

### Read-only publication checks

In the **Production Supabase SQL Editor**, never a shell:

```sql
SELECT mystery_id, version, schema_version, digest_sha256, object_path,
       rule_set_id, published_at, provenance
FROM private_mystery.published_versions
ORDER BY published_at DESC;

SELECT p.mystery_id, p.version, o.bucket_id, o.name,
       o.metadata->>'mimetype' AS content_type,
       o.metadata->>'size' AS size_bytes
FROM private_mystery.published_versions p
LEFT JOIN storage.objects o
  ON o.bucket_id = 'private-mystery-packages' AND o.name = p.object_path;
```

Database metadata does **not** prove exact Storage bytes; the publisher CLI's verified readback or separately authorized digest verification is required. For denial checks, use Supabase client/API with a genuinely authenticated host session to test host authorization; a bare unauthenticated fetch (even from a logged-in browser tab) cannot test authenticated host access. Never paste session tokens into Console, chat or GitHub.

An upload and registry insertion are **not atomic**. After partial failure, pause, inspect the matching object/path/digest and registry, then retry **only the identical canonical package** after review. Different content under the same version conflicts; never weaken immutable triggers or use an unapproved cleanup script.

## Backups, restoration and rollback

Supabase Free uses **owner-operated manual backups**, not a guaranteed managed backup service. Before substantial new Production changes or new real content, refresh encrypted database and private Storage backups. The latest known encrypted local database snapshot is `okp-production-20261124-132544.dump.age`; **it predates publisher provisioning and synthetic publication**. An encrypted synthetic Storage recovery fixture also exists. Encrypted off-device backup was checksum-matched and a separate local restore rehearsal validated Auth, registry/immutable guards and synthetic Storage recovery. This was **not** a complete managed, clean-room recovery test. Treat backup freshness and complete restoration as continuing operational responsibilities.

Store Postgres exports and exact private object bytes with verified digests in encrypted, access-restricted off-device storage. Keep original canonical package files separately. Back up registry and matching Storage bytes as one consistent snapshot, including version pin references; record what was included and when. Don't store plaintext dumps, Auth user records, JWTs, private objects or encryption credentials in this public repo or CI. Recovery must occur in an **isolated** environment first; validate Auth, version registry, schema versions, RLS, object digests and party pins together before cutover.

Incident procedures:
1. **Lost/compromised publisher access:** suspend issuance by removing the identity mapping; revoke sessions and wait for all tokens to expire; rotate credentials from a trusted device; inspect audit and objects before re-enabling. Keep guarded RPC and restrictive Storage policy in place while tokens may exist.
2. **Broken Auth hook:** restore token issuance for ordinary users only via a separately reviewed change; assess whether already-issued publisher tokens remain valid. Do not replace the hook with an unguarded publication RPC.
3. **Missing/tampered content:** fail closed, preserve evidence, compare registry/digests to encrypted backup, and restore identical bytes through an approved procedure or publish a new corrected version; don't mutate an immutable registered version.
4. **Orphan upload:** investigate source object, registry, and party pins. Never auto-delete objects or remove immutability protections. Any maintenance deletion needs an owner-approved, backed-up, scoped procedure.
5. **App rollback:** maintain immutable object versions and existing party pins. Confirm prior app understands pinned schema/rule version; never silently repin parties.

## Development and CI separation

Migrations live in `supabase/migrations/`. All automated Auth/database tests and `npx supabase db reset --no-seed` run against **disposable local Supabase** only. Never link, reset, push or run integration suites on Production. Merge, migration deployment, Auth hook activation, Vercel deployment, Production smoke testing and content publication are distinct owner-controlled actions.

See [Development environments](development-environments.md), [lobby persistence](architecture/lobby-persistence.md), [mystery package contract](architecture/mystery-content-package.md) and [agent instructions](../.github/copilot-instructions.md).
