# Lobby persistence and local database

**Status: M1.3 schema implemented; trusted application commands are deferred.**

The local Supabase database is disposable and must contain only synthetic test
data. These migrations are not permission to link, reset, or migrate any hosted
Supabase project.

## Schema boundary

The migration in `supabase/migrations/` creates:

- `parties`: UUID identity, an `auth.users` host principal, pinned mystery ID
  and version, `LOBBY`-only status, nonnegative nondecreasing party version,
  and creation/update timestamps.
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
  Issuance, verification, rate limiting, and recovery remain later work.

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
deliberate: no reviewed server command layer or safe database projection exists
yet, so even a host cannot directly read the roster or invitation verifier.
The API also disables automatic exposure of newly created tables.

The party-version trigger is an invoker function with a fixed `pg_catalog`
search path; it rejects version decreases and refreshes `updated_at`. Browser
roles cannot execute it directly. No security-definer RPC or client-writable
policy is introduced. Later server commands must derive identity from verified
`auth.uid()`, authorize host and participant scopes independently, use
allowlisted M1.1 projections, and keep privileged credentials server-only.

- **M1.4:** authenticate the host and implement narrowly authorized party
  creation/host commands; host authority does not imply participant or
  author/solution authority.
- **M1.5:** implement guest identity, reusable invite validation, and separate
  host-assisted recovery credentials; rate limits and admission/capacity policy
  belong at this trusted command boundary.
- **M1.6:** implement transactional assignment and optimistic version
  conflicts, populate party character references from the pinned public
  roster, and preserve the private-content boundary.

O-025 (production operations/backups), O-026 (server-only mystery storage),
and O-027 (public story/repository policy) remain open. No production or
preview database is configured by this change.

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

## CI and review checklist

The `Supabase migration and RLS tests` CI job starts a fresh local project on
GitHub-hosted Ubuntu, resets from migrations without seeds, runs pgTAP tests,
and removes its containers and volumes even after a failure. It needs no
hosted Supabase credentials; startup output is suppressed so generated local
keys are not put in Actions logs. Existing lint/type/build and Playwright jobs
remain separate.

Reviewers should confirm:

- [ ] Migrations and tests run only against a fresh local disposable database.
- [ ] RLS remains enabled and no browser role has table privileges or policies.
- [ ] Participant/party/character constraints protect uniqueness and scope.
- [ ] Invite storage contains only a verifier, not a raw join code.
- [ ] No authored mystery content, capacity rule, or recovery mechanism was
  introduced.
- [ ] Any future read/write policies are reviewed alongside the trusted
  server authorization and explicit M1.1 response projections.
