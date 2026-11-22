import "server-only";

export const BLACKWOOD_MYSTERY_ID = "blackwood-affair";
export const BLACKWOOD_MYSTERY_VERSION = "first-playtest-placeholder-v1";

const blackwoodPublicCharacterEntries = [
  {
    id: "vivienne",
    publicName: "Vivienne Blackwood",
    archetype: "The Disgraced Heiress",
    description: "Edmund's estranged daughter, recently returned to reclaim her place in the family.",
  },
  {
    id: "theodore",
    publicName: "Theodore Vale",
    archetype: "The Ambitious Partner",
    description: "Edmund's business associate, whose fortunes are closely tied to the Blackwood empire.",
  },
  {
    id: "margot",
    publicName: "Margot Sinclair",
    archetype: "The Society Darling",
    description: "A glamorous guest whose connection to Edmund has long fueled rumors.",
  },
  {
    id: "arthur",
    publicName: "Arthur Pembroke",
    archetype: "The Family Solicitor",
    description: "Keeper of the Blackwood family's legal affairs and uncomfortable secrets.",
  },
  {
    id: "clara",
    publicName: "Clara Whitmore",
    archetype: "The Loyal Housekeeper",
    description: "Keeper of the manor for twenty years, with knowledge of everyone's habits.",
  },
  {
    id: "julian",
    publicName: "Julian Cross",
    archetype: "The Investigative Journalist",
    description: "A newspaper reporter invited under circumstances nobody quite understands.",
  },
  {
    id: "eleanor",
    publicName: "Dr. Eleanor Finch",
    archetype: "The Family Physician",
    description: "Edmund's longtime doctor, familiar with his declining health and personal affairs.",
  },
  {
    id: "sebastian",
    publicName: "Sebastian Reed",
    archetype: "The Decorated Veteran",
    description: "A family friend whose loyalty to Edmund has recently come into question.",
  },
] as const;

export const BLACKWOOD_PUBLIC_CHARACTERS = Object.freeze(
  blackwoodPublicCharacterEntries.map((character) => Object.freeze(character)),
);

export type PublicCharacter = (typeof BLACKWOOD_PUBLIC_CHARACTERS)[number];
export type PublicCharacterId = PublicCharacter["id"];

export function isBlackwoodPackage(mysteryId: unknown, mysteryVersion: unknown): boolean {
  return mysteryId === BLACKWOOD_MYSTERY_ID && mysteryVersion === BLACKWOOD_MYSTERY_VERSION;
}

export function publicCharacterById(id: unknown): PublicCharacter | null {
  return BLACKWOOD_PUBLIC_CHARACTERS.find((character) => character.id === id) ?? null;
}
