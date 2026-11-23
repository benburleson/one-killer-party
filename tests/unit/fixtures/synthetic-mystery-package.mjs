/**
 * A fully synthetic eight-role mystery package for tests.
 *
 * Every identifier and sentence is fabricated filler. Nothing here is taken
 * from, or modelled on, any real mystery's cast, culprit, method or clues.
 * Each private field carries a unique sentinel so tests can prove that a
 * diagnostic or projection does not contain it.
 */
export const SYNTHETIC_SENTINELS = Object.freeze({
  dossier: "SENTINEL-DOSSIER",
  briefing: "SENTINEL-BRIEFING",
  item: "SENTINEL-ITEM",
  objective: "SENTINEL-OBJECTIVE",
  solution: "SENTINEL-SOLUTION",
});

const roleIds = Array.from({ length: 8 }, (_, index) => `role-${index + 1}`);
const phases = ["ACT_1", "ACT_2", "ACT_3"];

/** Returns a new, independent package on every call so tests can mutate it freely. */
export function syntheticMysteryPackage() {
  const S = SYNTHETIC_SENTINELS;
  return {
    schemaVersion: 1,
    mysteryId: "synthetic-mystery",
    version: "1.0.0-test.1",
    title: "Synthetic Test Mystery",
    publicSynopsis: "Placeholder synopsis for a fabricated test package.",
    supportedPlayerCounts: [8],
    characters: roleIds.map((id, index) => ({
      id,
      publicName: `Test Role ${index + 1}`,
      archetype: `Placeholder Archetype ${index + 1}`,
      description: `Public placeholder description ${index + 1}.`,
    })),
    startingDossiers: roleIds.map((characterId, index) => ({
      characterId,
      biography: `${S.dossier}-${index + 1} placeholder biography.`,
      interpersonalPrompts: [`${S.dossier}-${index + 1} placeholder prompt.`],
      relationships: [{
        characterId: roleIds[(index + 1) % roleIds.length],
        perspective: `${S.dossier}-${index + 1} placeholder perspective.`,
      }],
    })),
    murdererBriefing: {
      characterId: "role-3",
      releasePhase: "ACT_1",
      guiltNotice: `${S.briefing} placeholder notice.`,
      motive: `${S.briefing} placeholder motive.`,
      method: `${S.briefing} placeholder method.`,
      timeline: `${S.briefing} placeholder timeline.`,
      coverStory: `${S.briefing} placeholder cover story.`,
    },
    items: [
      ...phases.map((releasePhase, index) => ({
        id: `public-item-${index + 1}`,
        releasePhase,
        audience: { kind: "PUBLIC" },
        kind: "EVIDENCE",
        text: `${S.item} placeholder public artifact ${index + 1}.`,
        essential: true,
        provenance: "Placeholder provenance.",
      })),
      {
        id: "private-item-1",
        releasePhase: "ACT_2",
        audience: { kind: "CHARACTER", characterId: "role-5" },
        kind: "PERSONAL_KNOWLEDGE",
        text: `${S.item} placeholder recollection.`,
        essential: false,
        provenance: "Placeholder provenance.",
      },
      {
        id: "private-item-2",
        releasePhase: "ACT_3",
        audience: { kind: "CHARACTER", characterId: "role-7" },
        kind: "RUMOR",
        text: `${S.item} placeholder hearsay.`,
        essential: false,
        provenance: "Placeholder provenance.",
      },
    ],
    publicEvents: [
      { id: "event-1", releasePhase: "ACT_1", order: 1, script: "Placeholder announcement one." },
      { id: "event-2", releasePhase: "ACT_2", order: 1, script: "Placeholder announcement two." },
      { id: "event-3", releasePhase: "ACT_2", order: 2, script: "Placeholder announcement three." },
      { id: "event-4", releasePhase: "ACT_3", order: 1, script: "Placeholder announcement four." },
    ],
    objectives: [
      {
        id: "objective-1",
        characterId: "role-1",
        releasePhase: "ACT_1",
        description: `${S.objective} placeholder prompt with a target.`,
        targetCharacterId: "role-2",
      },
      {
        id: "objective-2",
        characterId: "role-4",
        releasePhase: "ACT_2",
        description: `${S.objective} placeholder prompt without a target.`,
      },
    ],
    solution: {
      culpritCharacterId: "role-3",
      motiveId: "motive-b",
      methodId: "method-a",
      narrative: `${S.solution} placeholder narrative.`,
      timeline: `${S.solution} placeholder timeline.`,
      supportingItemIds: ["public-item-2", "public-item-3"],
    },
    motiveIds: ["motive-a", "motive-b", "motive-c"],
    methodIds: ["method-a", "method-b"],
  };
}
