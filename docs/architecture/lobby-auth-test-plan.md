# Lobby authentication and persistence test plan

**Status: lobby coverage implemented; this matrix is the reference for what each test must prove.**

Use synthetic accounts, parties and mystery fixtures only. Tests must exercise
the same authorization and database paths the app uses; mock-only tests cannot
establish that boundary. Do not use production credentials or data.

Where the coverage lives:

- **pgTAP (`supabase/tests/`):** schema constraints, RLS, grants, every
  service-role RPC, cross-host and cross-party denial, and the schema-wide
  deny-by-default guard in `security_invariants.test.sql`.
- **Unit (`tests/unit/`):** validation, host command mapping, the public
  catalog, server/client import boundaries and CI workflow safety.
- **Playwright (`tests/e2e/host.integration.spec.ts`):** host sign-in, party
  creation, guest join, assignment with stale-version conflict, recovery,
  removal, last-slot race and isolation, on desktop and mobile against
  disposable Supabase.

Not applicable or not yet built: the lobby synchronizes by authenticated
polling, so the Realtime rows (T-20, T-21) have no subject; dossier, clue and
solution cases (parts of T-08, T-10–T-12, T-24) wait for private content. The
"Target follow-on" column keeps the original milestone labels (M1.3 schema,
M1.4 host, M1.5 guest, M1.6 assignment, M1.7 synchronization) for
traceability only.

## Test matrix

| ID | Scenario | Expected outcome | Test layer | Target follow-on |
|---|---|---|---|---|
| T-01 | Host signs in through the owner-approved valid identity flow; callback is on the configured environment allowlist. | Valid host principal is established and can create only its own party. No auth token or solution appears in the browser response. | Playwright + DB integration | M1.4 |
| T-02 | Invalid, expired, unverified or wrong-environment host callback/credential; repeated sign-in requests. | Sign-in/party creation is denied safely; generic user-facing error and configured throttling; no party is created and no token leaks to logs. | Unit + Playwright (provider-independent invalid cases) | M1.4 |
| T-03 | Guest joins with approved anonymous-auth flow and refreshes the same browser, including an ordinary session refresh. | The same authenticated principal resolves to the same participant and own assignment; no duplicate membership is created. | DB integration + Playwright | M1.5 |
| T-04 | Guest opens the party in a new browser, clears storage, logs out, or returns after configured session expiry without a recovery credential. | A different/missing principal cannot claim the old participant by party code, display name, participant ID or character ID. Recovery occurs only through the owner-approved explicit path. | DB integration + Playwright | M1.5 |
| T-05 | Guest uses the approved recovery flow with valid, expired, consumed, revoked and replayed recovery credentials. | Only a valid single-use credential restores the intended membership; consumption/revocation is atomic; previous credential cannot be replayed; errors disclose no participant secrets. | Unit + DB integration + Playwright | M1.5 |
| T-06 | Visitor or unjoined invite recipient requests party roster, host controls, participant list, or another participant's private data before joining. | No private party/roster data is returned; invitation can authorize only the minimum approved join operation. | DB integration | M1.3, M1.5 |
| T-07 | Authenticated party member supplies another party's ID, participant ID, role ID or content ID directly in a read or write request. | Cross-party IDOR is denied by server authorization and RLS; no data or mutation crosses party scope. | DB integration + Playwright direct-request coverage | M1.3, M1.5 |
| T-08 | One participant requests another participant's dossier, private clues, session, or assignment by changing a URL/API parameter. | Access is denied regardless of common party membership; only own participant-private projection is returned. | DB integration + Playwright | M1.3, M1.5 |
| T-09 | Non-host party member attempts host-only create/configure/assign/start/control operations; unrelated authenticated user attempts them too. | Server rejects both; hiding buttons is not considered sufficient. No state/version change occurs. | DB integration + Playwright direct-request coverage | M1.3, M1.4, M1.6 |
| T-10 | Host fetches the host-safe roster, assignments and operational status before reveal, with a non-culprit role assigned or no participant membership. | Host receives only the safe allowlisted host projection. No killer marker, solution, private dossier, secret role fields or other-player private content is in data, errors, HTML, bundled assets or logs. Host is not a participant unless a separate membership exists. | Unit + DB integration + Playwright/build inspection | M1.4, M1.6 |
| T-11 | Host is explicitly enrolled as a participant, then reads host controls and their own participant view. | Each scope is authorized independently. Host operations expose no secret; participant view contains only own approved/released role data. A nonplaying host remains governed by the approved O-003 policy. | DB integration + Playwright | M1.4, M1.6 |
| T-12 | Host tries to read another participant's private dossier or solution through host endpoints, direct database APIs, RPC or Realtime. | Denied. Host authority is not author/editor authority. Solution is unavailable until an approved reveal boundary and never returned through routine host operations. | DB integration + Playwright | M1.3, M1.6, M1.7 |
| T-13 | Guest guesses valid-looking, invalid, expired, revoked and consumed invitation codes at a controlled rate and above configured rate limits. | Valid active credential permits only the approved join flow; invalid responses are nonrevealing; rate limits activate; raw credentials are absent from storage/logs. No participant takeover occurs. | Unit + DB integration + Playwright | M1.4, M1.5 |
| T-14 | Two guests submit the same active invitation concurrently, then one guest retries after a lost response. | Invitation consumption and membership behavior match approved policy, with no duplicate participant or unintended credential reuse. Retries are idempotent or receive the original safe result. | DB integration | M1.5 |
| T-15 | Two host requests concurrently assign the same character to different participants; two characters are assigned concurrently to one participant; writes race across stale party versions. | Unique constraints and atomic version checks permit at most one consistent assignment per participant/character. Loser receives safe conflict and refetches authoritative roster. | DB integration | M1.3, M1.6 |
| T-16 | Two requests concurrently create a party/invitation or join the same principal to a party. | Constraints and idempotency prevent duplicate active records or duplicate `(party_id, principal_id)` membership; no partial party is left after failure. | DB integration | M1.3–M1.5 |
| T-17 | Participant disconnects and reconnects with a valid same-device session after roster/phase changes. | Reconnect refetches canonical current version and only that participant's currently authorized/released content; no duplicate join or stale private content. | DB integration + Playwright multi-context | M1.7 |
| T-18 | Session is lost or revoked while disconnected; client attempts reconnect with cached party/participant IDs and stale local state. | Cached IDs alone grant no access. Client is denied until reauthentication/approved recovery, then refetches canonical state. | DB integration + Playwright | M1.5, M1.7 |
| T-19 | Client submits a mutation using an old expected party version after another authorized mutation commits. | Mutation is rejected as stale without partial effects; response contains no secrets and client can fetch the safe authoritative state. | Unit + DB integration | M1.3, M1.6, M1.7 |
| T-20 | Realtime subscription receives a change for the same party, a different party, and a participant-private change. Inspect every payload. | Only approved nonsecret change signals reach authorized subscribers; no invitation, name/assignment, dossier, clue text, recipient list, solution or unreleased content is broadcast. Different-party event is not observable. | DB integration + Playwright | M1.3, M1.7 |
| T-21 | Realtime event is duplicated, delayed, delivered out of order or missed during reconnect. | Event is a notification only; client refetches canonical state under its current identity. Retries do not duplicate joins, assignments, releases or phase transitions. | Unit + DB integration + Playwright | M1.7 |
| T-22 | RLS regression: run table/view/RPC reads and writes as visitor, unjoined invitee, guest, other party member, host, and privileged server in intended scopes. | All unspecified access is denied. Only documented minimum permissions succeed. Service-role paths are separately authorized and never exposed to browser clients. | DB integration | M1.3 |
| T-23 | Reset the isolated test database from an empty state, apply all migrations, load synthetic fixtures, run security tests, then reset again. | Reproducible clean setup; no production/shared target; no live party/story data; no generated credentials in artifacts/logs; migration failure stops the run. | DB integration + CI | M1.3 |
| T-24 | Inspect browser network responses, rendered HTML/client bundles, public metadata, errors, logs and Playwright evidence using unique synthetic secret markers. | No solution, culprit marker, other-player dossier, raw invite/recovery credential, auth token or production data appears outside its explicitly authorized boundary. | Unit/build inspection + DB integration + Playwright | M1.3, M1.6, M1.7 |

## Execution and evidence requirements

- No DB test should point to production or an unverified shared development
  project.
- Prefer stable synthetic IDs and secret-marker strings in test fixtures so
  accidental disclosure can be detected without real mystery or participant
  data. Never print secrets to explain a failure.
- Unit tests cover pure projections, validation, version conflict mapping,
  retry/idempotency behavior and response allowlists. They do not prove RLS.
- DB integration tests assert the database role, authenticated principal,
  RLS behavior, uniqueness and transaction outcomes using isolated test
  resources. Include both allowed and denied cases.
- There are intentionally no browser-role allowed table reads: all
  `anon`/`authenticated` privileges are revoked and access goes through
  service-role RPCs. Tests assert RLS remains enabled so removing RLS cannot
  silently pass merely because grants are also absent.
- Playwright tests should use separate browser contexts for host, guest A,
  guest B, visitor and (where needed) a second party. Assert denial through
  direct routes/requests as well as visible controls. Use only synthetic
  content, and inspect screenshot/trace/report outputs before uploading.
- Record each actual command and outcome, CI run and artifact link, preview
  availability, manual browser steps, interventions/retries, and remaining
  failures in the relevant PR. A passing landing-page screenshot is regression
  evidence only; it is not proof of lobby behavior.
