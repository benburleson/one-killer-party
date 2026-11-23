# Lobby persistence and host commands

The lobby schema and its service-role commands are version-controlled in
`supabase/`. Production migration, deployment and smoke-test status, including
which results are owner attestation, is recorded only in
[production operations](../production-operations.md). All **automated tests**
use disposable local Supabase only.

For the **accepted design boundary** between lobby state and future private content, see
[mystery content architecture](mystery-content-architecture.md): private immutable object packages, restricted Postgres registry and party/release state, with server-only authorized projections. Decisions D-026–D-028 do not change the current lobby or authorize private publication.

## Schema boundary

The migrations in `supabase/migrations/` create:

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
  Party creation registers exactly eight public Blackwood IDs for
  `blackwood-affair` / `first-playtest-placeholder-v1`; this remains a
  placeholder package pin, not a claim that a complete mystery package is
  published.
- `invitation_credentials`: one active reusable invitation verifier per party,
  stored as a 32-byte digest with creation, revocation, and optional expiry
  metadata. There is no raw code column.
- `lobby_rate_limits`: shared rolling request counts keyed by an HMAC of the
  server-selected source address (or authenticated-principal fallback), never a
  raw IP or credential.
- `removed_participants`: a party/principal tombstone that prevents a removed
  or recovered-away identity from using an invitation to rejoin that party.
- `participant_recovery_tokens`: single-use recovery verifier, creator,
  expiry, consumption and revocation timestamps. The bearer itself is never
  stored.
- `participant_recovery_audit`: nonsecret initiation, redemption and removal
  events. No bearer values or invitation verifiers are recorded in the audit.

No table stores solution material, private dossiers, a culprit marker, or
invitation plaintext. The host is not a participant unless a separate
`participants` row exists. D-022/D-025's eight player slots apply to the first
Blackwood game, with the host counted only when explicitly enrolled. The
database has no generic capacity constraint; trusted join and explicit host
enrollment transactions serialize on the party row and enforce eight slots
only for `blackwood-affair`.

## Browser access and server boundary

RLS is enabled on all eight tables. No policies exist, and `anon` and
`authenticated` hold no privilege on any `public` table or sequence; default
privileges keep later tables and sequences the same way.
`supabase/tests/security_invariants.test.sql` checks this across the whole
schema, so a new table or RPC that skips RLS, grants or a pinned search path
fails the suite. Therefore therefore visitors, unjoined users,
participants, and hosts cannot directly read or mutate these tables. This is
deliberate: even a host cannot directly read the roster or invitation verifier.
The API also disables automatic exposure of newly created tables.

The party-update trigger is an invoker function with a fixed `pg_catalog`
search path; it rejects changes to the pinned mystery reference and version
decreases, and refreshes `updated_at`. Browser roles cannot execute it
directly. The host and guest command RPCs are security-definer functions with a fixed
search path and are executable only by `service_role`, not browser roles.
The server verifies the Supabase user for each command or read and supplies
that verified principal to the RPC; the RPC checks the stored host for
party-specific operations. The service key is never sent to the browser.
RPC responses contain only explicitly selected party fields, not invitation
verifiers or private story data. The service-role boundary is trusted: access
to that credential permits impersonation and must be restricted accordingly.

- **Host commands:** host authority does not imply participant or author/solution
  authority. The pinned `blackwood-affair` / `first-playtest-placeholder-v1`
  identifiers are nonsecret placeholders, not validated story content.
- **Guest membership:** `join_party` validates the active stored invite verifier, status,
  expiry, same-principal idempotency, removal tombstones and Blackwood capacity
  under a per-party row lock, and returns the party's pinned mystery ID and
  version on success. `get_guest_membership` returns only the caller's
  safe lobby membership. `list_host_participants` returns the host-safe roster;
  host enrollment, removal, recovery issuance and redemption are separate
  commands.
- **Public characters:** `src/lib/lobby/public-characters.ts` is an immutable server-only
  projection copied only from Blackwood public cast §2. It contains only the
  eight playable IDs, public names, archetypes and descriptions; do not import
  or parse `blackwood-affair.md` at runtime. The catalog explicitly accepts
  only the existing `blackwood-affair` /
  `first-playtest-placeholder-v1` pin. No dossier, culprit marker, solution,
  motive, method or future content is stored or returned.
- Existing parties with that exact pin were backfilled with the eight IDs;
  the party-creation RPC registers them transactionally for new parties. No
  story fields are written.
  `assign_public_character` locks the party row, checks the host, `LOBBY`,
  package pin, participant membership, registered public ID, uniqueness and
  expected party version. An identical request at the current version is an
  idempotent no-op; a changed assignment increments the version once. A
  different existing assignment or clear requires a confirmation flag.
  Conflicts and occupied IDs fail without changing the assignment; the
  participant unique index remains the race backstop.
- Host reads include only participant IDs, names, current public assignments
  and party version. Guest reads return only the authenticated caller's own
  public assignment. The server validates the package pin before projecting
  catalog labels; service-role RPCs remain inaccessible to browser roles.
  Role assignment is `LOBBY`-only. There is no game-start state, dossier
  access, clue release or solution data.

**Seams for private content (not implemented).** The server reads the pin
from the database on every projection (`get_host_party`,
`get_guest_membership`, `join_party`) and validates it in
`public-characters.ts`; `src/lib/supabase/service-client.ts` is the single
service-role entry point. Still hard-coded to the placeholder:
`create_host_party` (the pin it writes), `assign_public_character` (the eight
IDs and the pin check) and the Blackwood capacity of eight. Those change with
the published-version registry, not before.

O-025's backup/restore, retention and preview isolation decisions are not
settled. D-026–D-028 settle future private storage, preserved content versions
and ACT_1 murderer briefing timing; O-033 leaves **existing public spoiler
history** remediation open. Do not infer that PR previews are connected to a
safe dedicated Supabase project.

## Lobby synchronization

The lobby uses authenticated, same-origin polling rather than Supabase
Realtime. There is no channel, publication or browser table grant. Every host poll verifies the current host and
party through the existing service-only roster RPCs and returns only the party
version. A changed version triggers a fresh server-rendered, authorized roster
read; the poll response is not a roster or a source of authority. Every guest
poll verifies the current session and returns only that principal's existing
guest membership projection and public assignment, never the host roster or
credentials. Responses are private and non-cacheable. Knowing a party ID or
invitation code does not grant host access.

Visible, online lobbies poll at five-second intervals, with one active request,
a ten-second timeout, and exponential error backoff capped at thirty seconds.
Polling stops on unmount or lost authorization and pauses while hidden or
offline. Returning online or to the foreground immediately reconciles against
the server; failures show a non-blocking reconnect indicator. Consequently
updates are normally visible within one interval, not instantaneously, and an
offline browser may temporarily display its last public card until it
reconciles. Removal or recovery prevents subsequent authorized reads by the
old principal; polling does not revoke an already issued authentication JWT.
No credentials are replaced automatically. Polling load scales with the number
of visible lobby tabs; monitor service capacity before wider rollout.

Assignment drafts retain the version on which editing began. If another
device changes the party, the host must review the refreshed roster before
reapplying the preserved selection; optimistic database checks still reject
races that happen before the refresh. No automatic retry overwrites another
host's change. Since the version does not identify which operation changed
the party, a displayed rotated invitation is hidden conservatively after any
later version change: it may have been replaced, even if the change was only
an admission or assignment. The host can issue a fresh code if needed.
This does not resolve O-025–O-027 or add post-lobby gameplay, private dossiers,
or clue delivery.

## Invitation lifecycle

A cryptographically random eight-character code uses a 32-character alphabet
without ambiguous characters (40 bits of entropy); only its 32-byte SHA-256
verifier is stored. The host must save or share the code when it is
displayed: a hash cannot be reversed to redisplay it. On returning to a lobby,
the host can explicitly regenerate the code; the old code is revoked in the
same transaction as the replacement. Rotation checks the party version
shown when rotation was confirmed, so a stale concurrent request cannot
silently replace a newer code. Regeneration affects everyone holding the
previous link or code.

The create request uses a party UUID as an idempotency key. A retry of the
same request for the same host returns the existing party rather than creating
another, but cannot redisplay the original code. The key is retained for
retries in the current form, not across a page reload; after a lost response
or reload, check the host's party list before deliberately creating a separate
party with a new UUID. Codes are reusable for multiple guests under D-024,
not recovery tokens. Party status remains `LOBBY`-only, so the current
transaction checks lobby admission but does not simulate a future game-start
transition. Invitation expiry metadata is enforced when present; no automatic
admission-close operation exists until a later lifecycle-state migration.

## Guest identity, rate limits and recovery

The local Supabase config enables anonymous sign-in. A guest receives an
authenticated anonymous principal in an HTTP-only cookie; refreshing the same
browser preserves the membership. A browser already signed in to a non-anonymous
account is never silently switched. If a browser already has an authenticated
session, use a separate browser profile or context to sign in as a host or join
as a guest; host sign-in and its callback refuse to replace an active identity.
Hosts who choose to play use the explicit **Join as a player** action, not host
status or an invitation.

`/join#code=XXXXXXXX` is read in the browser, then the fragment is replaced with
the clean path before the code is submitted. The same form accepts a typed code.
The fragment is not sent in HTTP requests, the app is no-store and sets
`Referrer-Policy: no-referrer`, and this flow adds no third-party scripts or
analytics. The code only travels in the server-action POST body and is never
included in a query string or diagnostic log.

The database rate limiter uses atomic fixed windows shared across serverless
instances: 20 invitation attempts or 10 recovery attempts per 15 minutes, and
five recovery-issuance attempts per host per 15 minutes. The app HMACs the
source key using the server-only service key before it reaches the database.
Vercel's normalized forwarded-client header is used when available; otherwise
the bucket falls back to the authenticated principal. Expired buckets are
deleted opportunistically after one day. The fallback can be evaded by creating
new anonymous identities, and non-Vercel deployments must ensure their reverse
proxy overwrites forwarded-address headers. Supabase Auth's anonymous-signup
limits are an additional layer, not a substitute. Monitor abuse and reassess
limits/retention before public promotion; no third-party limiter is configured.

Recovery requires the host to confirm the guest's identity out of band. It
generates a distinct 256-bit random token, stores only its SHA-256 verifier, and
expires it after 15 minutes. The host sees the bearer once and must deliver it
out of band. Redemption is locked and single-use; it rebinds the existing
participant to a newly authenticated anonymous principal, records nonsecret
audit metadata, and tombstones the previous principal so it cannot rejoin using
the invite. Invalid, expired, revoked, replayed and forged tokens return the
same guest-facing error. The host cannot redeem the token or read participant
private content.

Rebinding removes the previous principal's authority to that membership, but
does not immediately revoke its already-issued Supabase access JWT. Supabase's
admin sign-out API requires the session JWT rather than a user ID, which this
server does not possess for a lost browser. The previous token may remain
authenticated until expiry, but no longer resolves to the recovered participant
in this party; other authority attached to that old account is not revoked.
Review supported Supabase session-revocation APIs before promising global
revocation.

## Local disposable database

From the repository root, use only these local commands:

```sh
npx supabase start
npx supabase db reset --no-seed
npx supabase test db
npx supabase stop --no-backup
```

`db reset` and `test db` are only permitted against the disposable local instance. A production link may exist in a developer Codespace; explicitly verify the target and never use `--remote`/`--linked` for test/reset operations. Review production migration deployments separately in [production operations](../production-operations.md). Local Supabase prints generated
local API credentials at startup; keep them on the local machine and out of
screenshots, logs, artifacts, and issue comments. No seed data is required;
the pgTAP suite creates synthetic rows inside a transaction and rolls them
back.

To inspect RLS locally, open Supabase Studio at
`http://127.0.0.1:54323` after `supabase start`, then inspect the tables'
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
Open the captured message in the private port 54324 interface, follow its link
in the same browser, create a party, and save the displayed invitation
securely. Reload the lobby and confirm it offers regeneration rather than
reconstructing the old code. Use a separate browser context to open the invite,
join with a synthetic display name, and verify the host roster and guest's
waiting lobby. Use only a synthetic guest for recovery; manually verify the
identity out of band and never include the one-time token in screenshots,
logs, or artifacts. Remove that guest and confirm the removed identity cannot
rejoin while a fresh anonymous browser can use the freed slot. Sign out the
host and confirm its lobby is inaccessible. Do not capture invitation codes,
recovery credentials, magic links, local keys, or email addresses in public
screenshots, test artifacts, or logs.

## CI and review checklist

The `Supabase migration and RLS tests` CI job starts a fresh local project on
GitHub-hosted Ubuntu, resets from migrations without seeds, runs pgTAP tests,
and removes its containers and volumes even after a failure. It needs no
hosted Supabase credentials. Startup output remains suppressed; on failure CI
reports only the exit code, Docker-daemon reachability, and status-only output
for matching project containers. A separate local-Supabase browser job tests
the host/guest flow against disposable Supabase on desktop and mobile without
capturing invitation, recovery or authentication data. Its evidence upload is
allowlisted and warns, rather than failing a second time, if an earlier step
failed before screenshots were created. The independent CodeQL, lint/type/
build, and smoke jobs remain separate. See [workflow setup](../workflow-setup.md)
for triggers, permissions, and required-check verification limits.

Reviewers should confirm:

- [ ] Migrations and tests run only against a fresh local disposable database.
- [ ] RLS remains enabled and no browser role has table privileges or policies.
- [ ] Participant/party/character constraints protect uniqueness and scope.
- [ ] The public catalog contains exactly the eight §2 playable IDs and no
  private fields; party references are backfilled and new parties register
  that same pinned roster.
- [ ] Assignment RPC locks and checks the host, party, participant, role,
  status and expected version; only service role can execute it.
- [ ] Host and guest projections contain only their authorized public role
  data; guests cannot enumerate another participant's assignment.
- [ ] Invite storage contains only a verifier, not a raw join code.
- [ ] Capacity is limited only for Blackwood and counted transactionally;
  recovery credentials are hashed, expiring, single-use and audited.
- [ ] Trusted RPC grants, host checks, and safe response projections are
  reviewed independently of browser-side authorization.
