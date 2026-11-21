export type LobbyStatus = "LOBBY";

export interface LobbyPartyRecord {
  readonly id: string;
  readonly mysteryId: string;
  readonly mysteryVersion: string;
  readonly hostPrincipalId: string;
  readonly status: LobbyStatus;
  readonly version: number;
  readonly joinCodeReference: string;
}

export interface LobbyParticipantRecord {
  readonly id: string;
  readonly principalId: string;
  readonly displayName: string;
  readonly partyId: string;
  readonly assignedCharacterId?: string | null;
}

export interface PublicCharacterRosterEntry {
  readonly id: string;
  readonly publicName: string;
  readonly publicArchetype: string;
}

export type LobbyDomainErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_PARTY"
  | "DUPLICATE_MEMBERSHIP"
  | "CAPACITY_REACHED"
  | "CONFLICTING_ASSIGNMENT"
  | "INVALID_STATE";

export class LobbyProjectionError extends Error {
  readonly code: LobbyDomainErrorCode;

  constructor(code: LobbyDomainErrorCode) {
    super(code);
    this.name = "LobbyProjectionError";
    this.code = code;
  }
}

export interface LobbyMetadata {
  readonly id: string;
  readonly mysteryId: string;
  readonly mysteryVersion: string;
  readonly status: LobbyStatus;
  readonly version: number;
}

export interface HostLobbyParticipantView {
  readonly id: string;
  readonly displayName: string;
  readonly assignedCharacterId: string | null;
  readonly assignedCharacter: PublicCharacterRosterEntry | null;
}

export interface HostLobbyView {
  readonly party: LobbyMetadata;
  readonly characterRoster: readonly PublicCharacterRosterEntry[];
  readonly participants: readonly HostLobbyParticipantView[];
}

export interface ParticipantLobbyView {
  readonly party: LobbyMetadata;
  readonly participant: {
    readonly id: string;
    readonly displayName: string;
    readonly assignedCharacterId: string | null;
    readonly assignedCharacter: PublicCharacterRosterEntry | null;
  };
}

export interface HostViewerContext {
  readonly principalId: string;
}

export interface ParticipantViewerContext {
  readonly principalId: string;
}

function projectLobbyMetadata(party: LobbyPartyRecord): LobbyMetadata {
  return {
    id: party.id,
    mysteryId: party.mysteryId,
    mysteryVersion: party.mysteryVersion,
    status: party.status,
    version: party.version,
  };
}

function projectPublicCharacter(
  character: PublicCharacterRosterEntry,
): PublicCharacterRosterEntry {
  return {
    id: character.id,
    publicName: character.publicName,
    publicArchetype: character.publicArchetype,
  };
}

function projectAssignment(
  assignedCharacterId: string | null | undefined,
  charactersById: ReadonlyMap<string, PublicCharacterRosterEntry>,
): {
  assignedCharacterId: string | null;
  assignedCharacter: PublicCharacterRosterEntry | null;
} {
  const characterId = assignedCharacterId ?? null;
  const character =
    characterId === null ? undefined : charactersById.get(characterId);

  return {
    assignedCharacterId: characterId,
    assignedCharacter: character ? projectPublicCharacter(character) : null,
  };
}

function compareIds(left: { readonly id: string }, right: { readonly id: string }) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Projects trusted lobby records for a host after the server has authorized
 * the viewer. This equality check is defense in depth, not server authorization.
 */
export function projectAuthorizedHostLobby(
  party: LobbyPartyRecord,
  participants: readonly LobbyParticipantRecord[],
  characterRoster: readonly PublicCharacterRosterEntry[],
  viewer: HostViewerContext,
): HostLobbyView {
  if (viewer.principalId !== party.hostPrincipalId) {
    throw new LobbyProjectionError("UNAUTHORIZED");
  }

  const charactersById = new Map(
    characterRoster.map((character) => [character.id, character]),
  );
  const projectedRoster = characterRoster
    .map(projectPublicCharacter)
    .sort(compareIds);
  const projectedParticipants = participants
    .filter((participant) => participant.partyId === party.id)
    .map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      ...projectAssignment(participant.assignedCharacterId, charactersById),
    }))
    .sort(compareIds);

  return {
    party: projectLobbyMetadata(party),
    characterRoster: projectedRoster,
    participants: projectedParticipants,
  };
}

/**
 * Projects trusted lobby records for the matching participant after the server
 * has authorized the viewer. This membership check is not server authorization.
 */
export function projectAuthorizedParticipantLobby(
  party: LobbyPartyRecord,
  participants: readonly LobbyParticipantRecord[],
  characterRoster: readonly PublicCharacterRosterEntry[],
  viewer: ParticipantViewerContext,
): ParticipantLobbyView {
  const participant = participants.find(
    (candidate) =>
      candidate.partyId === party.id &&
      candidate.principalId === viewer.principalId,
  );

  if (!participant) {
    throw new LobbyProjectionError("UNAUTHORIZED");
  }

  const charactersById = new Map(
    characterRoster.map((character) => [character.id, character]),
  );

  return {
    party: projectLobbyMetadata(party),
    participant: {
      id: participant.id,
      displayName: participant.displayName,
      ...projectAssignment(participant.assignedCharacterId, charactersById),
    },
  };
}
