import { validPartyId } from "../host/core.ts";
import { isCanonicalId } from "./ids.ts";
import { publishedVersionRefSchema, type MysteryDefinition, type PublishedVersionRef } from "./schema.ts";
import type { TrustedPackageLoadResult } from "./trusted-loader-core.ts";

export type DossierProjection = Readonly<{
  character: Readonly<{ id: string; publicName: string; archetype: string; description: string }>;
  biography: string;
  relationships: readonly Readonly<{ characterId: string; publicName: string; perspective: string }>[];
  interpersonalPrompts: readonly string[];
}>;

type Identity = Readonly<{ principalId: string; sessionId: string }>;
type Snapshot = Readonly<{
  partyId: string; principalId: string; participantId: string; characterId: string;
  status: "LOBBY"; partyVersion: number; pin: PublishedVersionRef;
}>;
type Dependencies = Readonly<{
  identity(): Promise<Identity | null>;
  snapshot(partyId: string, principalId: string): Promise<unknown>;
  load(pin: PublishedVersionRef): Promise<TrustedPackageLoadResult>;
}>;

function parseSnapshot(raw: unknown, partyId: string, principalId: string): Snapshot | null {
  if (!Array.isArray(raw) || raw.length !== 1 || !raw[0] || typeof raw[0] !== "object") return null;
  const row = raw[0] as Record<string, unknown>;
  const pin = publishedVersionRefSchema.safeParse({
    mysteryId: row.mystery_id, version: row.mystery_version,
    schemaVersion: row.schema_version, digestSha256: row.digest_sha256,
  });
  if (row.party_id !== partyId || row.principal_id !== principalId ||
      !validPartyId(row.participant_id) || typeof row.assigned_character_id !== "string" ||
      !isCanonicalId(row.assigned_character_id) || row.status !== "LOBBY" ||
      typeof row.party_version !== "number" || !Number.isSafeInteger(row.party_version) ||
      row.party_version < 0 || !pin.success) return null;
  return {
    partyId, principalId, participantId: row.participant_id,
    characterId: row.assigned_character_id, status: "LOBBY",
    partyVersion: row.party_version, pin: pin.data,
  };
}

function project(definition: MysteryDefinition, characterId: string): DossierProjection | null {
  const character = definition.characters.find((entry) => entry.id === characterId);
  const dossier = definition.startingDossiers.find((entry) => entry.characterId === characterId);
  if (!character || !dossier) return null;
  const relationships: { characterId: string; publicName: string; perspective: string }[] = [];
  for (const relationship of dossier.relationships) {
    const target = definition.characters.find((entry) => entry.id === relationship.characterId);
    if (!target) return null;
    relationships.push({ characterId: target.id, publicName: target.publicName, perspective: relationship.perspective });
  }
  return {
    character: { id: character.id, publicName: character.publicName, archetype: character.archetype, description: character.description },
    biography: dossier.biography,
    relationships,
    interpersonalPrompts: [...dossier.interpersonalPrompts],
  };
}

/** Dependencies are trusted server adapters; callers never supply an identity or role. */
export async function getOwnDossier(partyId: unknown, dependencies: Dependencies): Promise<DossierProjection | null> {
  if (!validPartyId(partyId)) return null;
  const canonicalPartyId = partyId.toLowerCase();
  try {
    const identity = await dependencies.identity();
    if (!identity || !validPartyId(identity.principalId) || !validPartyId(identity.sessionId)) return null;
    const before = parseSnapshot(await dependencies.snapshot(canonicalPartyId, identity.principalId), canonicalPartyId, identity.principalId);
    if (!before) return null;
    const loaded = await dependencies.load(before.pin);
    if (!loaded.ok) return null;
    const afterIdentity = await dependencies.identity();
    if (!afterIdentity || afterIdentity.principalId !== identity.principalId ||
        afterIdentity.sessionId !== identity.sessionId) return null;
    const after = parseSnapshot(await dependencies.snapshot(canonicalPartyId, identity.principalId), canonicalPartyId, identity.principalId);
    if (!after || JSON.stringify(after) !== JSON.stringify(before)) return null;
    return project(loaded.definition, before.characterId);
  } catch {
    return null;
  }
}
