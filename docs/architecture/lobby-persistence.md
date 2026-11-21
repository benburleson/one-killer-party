# Lobby persistence and local database

**Status: local lobby persistence and M1.4 host commands.**

The local Supabase database is disposable and must contain only synthetic test
data. These migrations are not permission to link, reset, or migrate any hosted
Supabase project.

## Schema boundary

The migration in `supabase/migrations/` creates:

- `parties`: UUID identity, an `auth.users` host principal, immutable pinned
  mystery ID and version, `LOBBY`-only status, nonnegative nondecreasing party
  version, and creation/update timestamps.
- `participants`: UUID identity, party and authenticated-principal foreign
  keys, display name, and nullable assigned public character ID. A unique
  `(party_id, principal_id)` prevents duplicate membership. A partial unique
  index prevents duplicate non-null assignments within one party. Deleting a
  participant is the storage-level removal/re-enrollment path; no post-start
  removal or replacement behavior is modeled.
- `party_character_refs`: only a party ID and public character ID, with no
  authored names, dossiers, or story data. The participant composite foreign
  key prevents assigning a reference that is not registered for that party.
  The later trusted content service must validate that a public character ID
  exists in the pinned mystery version; this migration has no content catalog.
- `invitation_credentials`: one active reusable invitation verifier per party,
  stored as a 32-byte digest with creation, revocation, and optional expiry
  metadata. There is no raw code column or guest-recovery credential table.
  Guest verification, rate limiting, and recovery remain later work.

No table stores solution material, private dossiers, a culprit marker, or
invitation plaintext. The host is not a participant unless a separate
`participants` row exists. D-022/D-025's eight player slots apply to the first
Blackwood game, with the host counted only when explicitly enrolled. The
database intentionally has no generic capacity limit; M1.5 admission logic
must enforce the approved story-specific limit.

## Browser access and server boundary

RLS is enabled on all four tables. No policies and no table privileges are
granted to `anon` or `authenticated`; therefore visitors, unjoined users,
participants, and hosts cannot directly read or mutate these tables. This is
deliberate: even a host cannot directly read the roster or invitation verifier.
The API also disables automatic exposure of newly created tables.

The party-update trigger is an invoker function with a fixed `pg_catalog`
search path; it rejects changes to the pinned mystery reference and version
decreases, and refreshes `updated_at`. Browser roles cannot execute it
directly. The host command RPCs are security-definer functions with a fixed
search path and are executable only by `service_role`, not browser roles.
The server verifies the Supabase user for each command or read and supplies
that verified principal to the RPC; the RPC checks the stored host for
party-specific operations. The service key is never sent to the browser.
RPC responses contain only explicitly selected party fields, not invitation
verifiers or private story data. The service-role boundary is trusted: access
to that credential permits impersonation and must be restricted accordingly.

- **M1.4:** host authority does not imply participant or author/solution
  authority. The pinned `blackwood-affair` / `first-playtest-placeholder-v1`
  identifiers are nonsecret placeholders, not validated story content.
- **M1.5:** implement guest identity, reusable invite validation, and separate
  host-assisted recovery credentials; rate limits and admission/capacity policy
  belong at this trusted command boundary.
- **M1.6:** implement transactional assignment and optimistic version
  conflicts, populate party character references from the pinned public
  roster, and preserve the private-content boundary.

O-025 (production operations/backups), O-026 (server-only mystery storage),
and O-027 (public story/repository policy) remain open. No production or
preview database is configured by this change.

## Invitation lifecycle

A cryptographically random eight-character code uses a 32-character alphabet
without ambiguous characters (40 bits of entropy); only its 32-byte SHA-256
verifier is stored. The host must save or share the code when it is
displayed: a hash cannot be reversed to redisplay it. On returning to a lobby,
the host can explicitly regenerate the code; the old code is revoked in the
same transaction as the replacement. The command checks the party version
shown when rotation was confirmed, so a stale concurrent request cannot
silently replace a newer code. Regeneration affects everyone holding the
previous link or code.

The create request uses a party UUID as an idempotency key. A retry of the
same request for the same host returns the existing party rather than creating
another, but cannot redisplay the original code. The key is retained for
retries in the current form, not across a page reload; after a lost response
or reload, check the host's party list before deliberately creating a separate
party with a new UUID. Codes are reusable for multiple guests under D-024,
not recovery tokens. The database has no admission-close operation yet, so expiry at
admission close is not implemented. Guest redemption, nonrevealing errors,
rate limiting, and expiry at admission close are required in M1.5. Until
then, the share link is only a placeholder and cannot enroll anyone.

## Local disposable database

From the repository root, use only these local commands:

```sh
npx supabase start
npx supabase db reset --no-seed
npx supabase test db
npx supabase stop --no-backup
```

`db reset` and `test db` target the local instance by default. Do not pass
`--remote`, link a project, or use `db push`. Local Supabase prints generated
local API credentials at startup; keep them on the local machine and out of
screenshots, logs, artifacts, and issue comments. No seed data is required;
the pgTAP suite creates synthetic rows inside a transaction and rolls them
back.

To inspect RLS locally, open Supabase Studio at
`http://127.0.0.1:54323` after `supabase start`, then inspect the four tables'
RLS status and grants. The SQL test suite also checks catalog state and
executes denied requests under the `authenticated` database role with
synthetic JWT claims. Keep database, API, and Studio ports private; the
repository's devcontainer forwards only the application port.

## Local host sign-in walkthrough

Start the disposable local stack as above. In an uncommitted `.env.local`,
set `APP_URL` to the exact app origin, `NEXT_PUBLIC_SUPABASE_URL` to the local
API URL, `NEXT_PUBLIC_SUPABASE_ANON_KEY` to its local anon key, and
`SUPABASE_SERVICE_ROLE_KEY` to its local service-role key. Obtain the values
from local `npx supabase status` output without sharing or recording it.
The service-role key is server-only; never use a `NEXT_PUBLIC_` prefix for it.
Restart the app after changing environment variables.

For localhost, use `http://127.0.0.1:3000` as `APP_URL` and open port 54324
locally for the captured email. In Codespaces, forward port 3000 and the local
email capture port 54324 as **Private**. The app origin must be the actual
forwarded HTTPS origin, not `localhost` or a caller-provided header. GoTrue's
confirmation link also needs a browser-reachable local API: forward 54321 as
**Private**, and configure the local `[auth]` `external_url` to that exact
forwarded origin with `/auth/v1` appended. Set local `site_url` and
`additional_redirect_urls` to the exact app origin and callback
`<app-origin>/auth/callback`; restart the local stack after changing these
settings. Do not use wildcard preview domains or change hosted auth settings.
These are local, environment-specific configuration edits: do not commit them.
Codespaces forwarding and cookie behavior require a human walkthrough; they
have not been independently verified by the database schema tests.

Open the app and request a host sign-in link using a synthetic email address.
Open the captured message in the private port 54324 interface, follow its
link in the same browser, create a party, and save the displayed invitation
securely. Reload the lobby and confirm it offers regeneration rather than
reconstructing the old code. Sign out and confirm the lobby is inaccessible.
Do not capture invitation codes, magic links, local keys, or email addresses
in public screenshots, test artifacts, or logs.

## CI and review checklist

The `Supabase migration and RLS tests` CI job starts a fresh local project on
GitHub-hosted Ubuntu, resets from migrations without seeds, runs pgTAP tests,
and removes its containers and volumes even after a failure. It needs no
hosted Supabase credentials; startup output is suppressed so generated local
keys are not put in Actions logs. A separate local-Supabase browser job tests
the host flow without capturing sensitive invite or authentication data. The
existing lint/type/build and landing-page Playwright jobs remain separate.

Reviewers should confirm:

- [ ] Migrations and tests run only against a fresh local disposable database.
- [ ] RLS remains enabled and no browser role has table privileges or policies.
- [ ] Participant/party/character constraints protect uniqueness and scope.
- [ ] Invite storage contains only a verifier, not a raw join code.
- [ ] No authored mystery content, capacity rule, or recovery mechanism was
  introduced.
- [ ] Trusted RPC grants, host checks, and safe response projections are
  reviewed independently of browser-side authorization.
