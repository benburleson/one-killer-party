export type DossierProjection = Readonly<{
  character: Readonly<{ id: string; publicName: string; archetype: string; description: string }>;
  biography: string;
  relationships: readonly Readonly<{ characterId: string; publicName: string; perspective: string }>[];
  interpersonalPrompts: readonly string[];
}>;

export function dossierContextKey(partyId: string, participantId: string, characterId: string | null, available: boolean, version?: number) {
  return JSON.stringify([partyId, participantId, characterId, available, version]);
}

export function membershipContextKey(memberships: readonly {
  partyId: string; participantId: string; assignedCharacterId: string | null; dossierAvailable: boolean; version: number;
}[]) {
  return JSON.stringify(memberships.map(({ partyId, participantId, assignedCharacterId, dossierAvailable, version }) =>
    [partyId, participantId, assignedCharacterId, dossierAvailable, version]).sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function syncIdentityChanged(previous: string | null, current: string) {
  return previous !== null && previous !== current;
}

export function hostVersionMatches(current: number, snapshot: number) {
  return current === snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseDossier(value: unknown, characterId: string): DossierProjection | null {
  if (!isRecord(value) || !isRecord(value.dossier)) return null;
  const dossier = value.dossier;
  const character = dossier.character;
  if (!isRecord(character) || character.id !== characterId ||
      typeof character.publicName !== "string" || typeof character.archetype !== "string" ||
      typeof character.description !== "string" || typeof dossier.biography !== "string" ||
      !Array.isArray(dossier.relationships) || !Array.isArray(dossier.interpersonalPrompts) ||
      !dossier.interpersonalPrompts.every((item: unknown) => typeof item === "string") ||
      !dossier.relationships.every((item: unknown) => isRecord(item) &&
        typeof item.characterId === "string" && typeof item.publicName === "string" &&
        typeof item.perspective === "string")) return null;
  return {
    character: { id: characterId, publicName: character.publicName, archetype: character.archetype, description: character.description },
    biography: dossier.biography,
    relationships: dossier.relationships.map((item) => ({
      characterId: item.characterId, publicName: item.publicName, perspective: item.perspective,
    })),
    interpersonalPrompts: [...dossier.interpersonalPrompts],
  };
}

export class DossierRequest {
  private generation = 0;
  private controller: AbortController | null = null;

  invalidate() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  async open(partyId: string, characterId: string, fetcher: typeof fetch = fetch): Promise<DossierProjection | null> {
    this.invalidate();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await fetcher(`/api/lobby/${encodeURIComponent(partyId)}/dossier`, {
        method: "POST", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) return null;
      const result = parseDossier(await response.json(), characterId);
      return generation === this.generation && !controller.signal.aborted ? result : null;
    } catch {
      return null;
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }

}

export class DossierLifecycle {
  readonly request = new DossierRequest();
  private generation = 0;
  private intent = false;
  private suspended = false;

  begin() {
    this.intent = true;
    this.suspended = false;
    return ++this.generation;
  }

  isCurrent(generation: number) {
    return this.generation === generation;
  }

  token() {
    return this.generation;
  }

  suspend() {
    this.generation++;
    this.request.invalidate();
    this.suspended = this.intent;
    return this.intent;
  }

  close() {
    this.suspend();
    this.intent = false;
    this.suspended = false;
  }

  shouldResume() {
    return this.intent && this.suspended;
  }
}
