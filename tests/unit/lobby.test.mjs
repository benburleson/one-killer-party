import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LobbyProjectionError,
  projectAuthorizedHostLobby,
  projectAuthorizedParticipantLobby,
} from "../../src/lib/lobby/index.ts";

const party = {
  id: "party-1",
  mysteryId: "mystery-1",
  mysteryVersion: "1.0.0",
  hostPrincipalId: "host-principal",
  status: "LOBBY",
  version: 3,
  joinCodeReference: "opaque-reference",
  solution: "The killer is hidden",
  isMurderer: true,
  privateDossier: "Never show this",
  accessToken: "host-session-token",
};

const participants = [
  {
    id: "participant-host",
    principalId: "host-principal",
    displayName: "Host",
    partyId: "party-1",
    assignedCharacterId: "character-a",
    solution: "participant secret",
    isMurderer: true,
    privateDossier: "host dossier",
    sessionToken: "host-session",
  },
  {
    id: "participant-guest",
    principalId: "guest-principal",
    displayName: "Guest",
    partyId: "party-1",
    assignedCharacterId: "character-b",
    solution: "guest secret",
    isMurderer: false,
    privateDossier: "guest dossier",
    authToken: "guest-session",
  },
  {
    id: "participant-other-party",
    principalId: "other-principal",
    displayName: "Other party",
    partyId: "party-2",
    assignedCharacterId: "character-c",
  },
];

const characterRoster = [
  {
    id: "character-b",
    publicName: "Beatrice Vale",
    publicArchetype: "The confidante",
    solution: "hidden truth",
    isMurderer: true,
    privateDossier: "character dossier",
  },
  {
    id: "character-a",
    publicName: "Arthur Vale",
    publicArchetype: "The heir",
    roleType: "murderer",
    secret: "character secret",
  },
];

test("host projection includes safe attendance, roster, and assignments only", () => {
  const view = projectAuthorizedHostLobby(
    party,
    participants,
    characterRoster,
    { principalId: "host-principal" },
  );

  assert.deepEqual(view.party, {
    id: "party-1",
    mysteryId: "mystery-1",
    mysteryVersion: "1.0.0",
    status: "LOBBY",
    version: 3,
  });
  assert.deepEqual(
    view.characterRoster.map(({ id }) => id),
    ["character-a", "character-b"],
  );
  assert.deepEqual(view.participants, [
    {
      id: "participant-guest",
      displayName: "Guest",
      assignedCharacterId: "character-b",
      assignedCharacter: {
        id: "character-b",
        publicName: "Beatrice Vale",
        publicArchetype: "The confidante",
      },
    },
    {
      id: "participant-host",
      displayName: "Host",
      assignedCharacterId: "character-a",
      assignedCharacter: {
        id: "character-a",
        publicName: "Arthur Vale",
        publicArchetype: "The heir",
      },
    },
  ]);
  assert.equal("hostPrincipalId" in view.party, false);
  assert.equal("joinCodeReference" in view.party, false);
  assert.equal("principalId" in view.participants[0], false);
});

test("participant projection includes only the viewer's own public assignment", () => {
  const view = projectAuthorizedParticipantLobby(
    party,
    participants,
    characterRoster,
    { principalId: "guest-principal" },
  );

  assert.deepEqual(view.participant, {
    id: "participant-guest",
    displayName: "Guest",
    assignedCharacterId: "character-b",
    assignedCharacter: {
      id: "character-b",
      publicName: "Beatrice Vale",
      publicArchetype: "The confidante",
    },
  });
  assert.deepEqual(view.party, {
    id: "party-1",
    mysteryId: "mystery-1",
    mysteryVersion: "1.0.0",
    status: "LOBBY",
    version: 3,
  });
  assert.equal(JSON.stringify(view).includes("Host"), false);
  assert.equal(JSON.stringify(view).includes("principalId"), false);
});

test("a host is a participant only when a separate participant record exists", () => {
  const withoutHostMembership = participants.filter(
    (participant) => participant.principalId !== "host-principal",
  );

  assert.deepEqual(
    projectAuthorizedHostLobby(
      party,
      withoutHostMembership,
      characterRoster,
      { principalId: "host-principal" },
    ).participants.map(({ id }) => id),
    ["participant-guest"],
  );
  assert.throws(
    () =>
      projectAuthorizedParticipantLobby(
        party,
        withoutHostMembership,
        characterRoster,
        { principalId: "host-principal" },
      ),
    (error) =>
      error instanceof LobbyProjectionError && error.code === "UNAUTHORIZED",
  );
});

test("projections omit contaminated fields and are deterministic without mutating inputs", () => {
  const inputBefore = JSON.stringify({ party, participants, characterRoster });
  const hostView = projectAuthorizedHostLobby(
    party,
    participants,
    characterRoster,
    { principalId: "host-principal" },
  );
  const participantView = projectAuthorizedParticipantLobby(
    party,
    participants,
    characterRoster,
    { principalId: "guest-principal" },
  );
  const serialized = JSON.stringify({ hostView, participantView });

  assert.equal(
    JSON.stringify(hostView),
    JSON.stringify(
      projectAuthorizedHostLobby(
        party,
        participants,
        characterRoster,
        { principalId: "host-principal" },
      ),
    ),
  );
  assert.equal(
    JSON.stringify(participantView),
    JSON.stringify(
      projectAuthorizedParticipantLobby(
        party,
        participants,
        characterRoster,
        { principalId: "guest-principal" },
      ),
    ),
  );
  assert.equal(inputBefore, JSON.stringify({ party, participants, characterRoster }));
  for (const secret of [
    "solution",
    "isMurderer",
    "privateDossier",
    "roleType",
    "accessToken",
    "sessionToken",
    "authToken",
    "opaque-reference",
  ]) {
    assert.equal(serialized.includes(secret), false, `unexpected ${secret}`);
  }
});

test("projection rejects a host or participant outside the supplied authorization scope", () => {
  assert.throws(
    () =>
      projectAuthorizedHostLobby(
        party,
        participants,
        characterRoster,
        { principalId: "guest-principal" },
      ),
    (error) =>
      error instanceof LobbyProjectionError && error.code === "UNAUTHORIZED",
  );
  assert.throws(
    () =>
      projectAuthorizedParticipantLobby(
        party,
        participants,
        characterRoster,
        { principalId: "unknown-principal" },
      ),
    (error) =>
      error instanceof LobbyProjectionError && error.code === "UNAUTHORIZED",
  );
});
