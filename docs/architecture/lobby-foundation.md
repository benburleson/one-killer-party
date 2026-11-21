# Multiplayer lobby domain foundation

This module establishes provisional TypeScript contracts and safe projections for
the `LOBBY` phase. It contains no database, authentication, API, or UI integration
and does not choose an unresolved product policy.

## Contracts and projections

`src/lib/lobby/` models a party pinned to a mystery ID and version, its host
principal, lobby state/version, and an opaque join-code reference. A participant
has a separate identity and owning auth principal; the host becomes a participant
only when an explicit participant record exists. The public character roster
contains only a stable ID, public name, and public archetype.

`HostLobbyView` contains safe party metadata, the public roster, and the party's
participant names and safe assignments. `ParticipantLobbyView` contains the same
safe party metadata and only the requesting participant's own name and safe
assignment. Both are constructed with explicit property allowlists. In particular,
principal IDs and the join-code reference are not included in either view.

The projection functions are pure filters over trusted records. Their explicit
viewer context checks help prevent accidental scope mix-ups, but **are not
authentication or server authorization**. Every server entry point must
authenticate the caller and authorize party/host/participant membership against
durable server state before invoking a projection. Never send a complete domain
or authored mystery object to a client and depend on the UI to hide fields.

## Persistence and trust-boundary follow-up

When persistence is designed, enforce unique `(party_id, principal_id)` membership
and unique `(party_id, character_id)` assignment constraints in the database, not
only in client or application checks. Host operations require a server-verified
host principal. Participant reads must be constrained to their authenticated
membership and own assignment; a join code is an entry reference, not authority to
read another participant's data or host controls.

Assignment and party mutations should use transactions or equivalent atomic
operations with an optimistic party-version check to reject conflicting writes.
Reconnect should re-establish identity from authenticated membership and reload
canonical state; a party code alone must not recover a participant session or
host privilege. A future Supabase implementation needs reviewed server-side query
boundaries and RLS policies that preserve these rules. No schema, RLS policy, or
Supabase integration is introduced here.

## Provisional choices and open decisions

These shapes, string IDs, `LOBBY`-only status, and safe roster fields are
implementation contracts for this slice, not finalized API/database schemas.
Open decisions include host authentication and guest-session recovery (O-001,
O-002); whether a host plays, capacity, names, invite/expiry rules, and late
joining (O-003–O-005); when role-private content becomes visible (O-006); and
content storage/versioning and public-repository boundaries (O-025–O-027).

The eight-player Blackwood playtest is a baseline proposal (P-001), not a
platform-wide capacity limit. The proposed auth modes (P-008/P-009), state-machine
details (P-011), and storage/runtime fields remain provisional. Nothing here
settles those choices or exposes private role data, a solution, or killer markers.
