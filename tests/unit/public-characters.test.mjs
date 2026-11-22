import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../src/lib/lobby/public-characters.ts", import.meta.url),
  "utf8",
);

test("the server-only catalog contains exactly the authored public Blackwood roles", () => {
  const entries = [...source.matchAll(
    /^\s+id: "([^"]+)",\n\s+publicName: "([^"]+)",\n\s+archetype: "([^"]+)",\n\s+description: "([^"]+)",$/gm,
  )].map(([, id, publicName, archetype, description]) => ({
    id,
    publicName,
    archetype,
    description,
  }));
  assert.deepEqual(entries, [
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
  ]);
  assert.match(source, /import "server-only";/);
  assert.match(source, /Object\.freeze\(\s*blackwoodPublicCharacterEntries\.map\(\(character\) => Object\.freeze\(character\)\)/);
});

test("catalog package validation accepts only the pinned placeholder version", () => {
  assert.match(source, /BLACKWOOD_MYSTERY_ID = "blackwood-affair"/);
  assert.match(source, /BLACKWOOD_MYSTERY_VERSION = "first-playtest-placeholder-v1"/);
  assert.match(source, /return mysteryId === BLACKWOOD_MYSTERY_ID && mysteryVersion === BLACKWOOD_MYSTERY_VERSION/);
  assert.doesNotMatch(source, /\b(?:isMurderer|is_murderer|privateDossier|solution|motive|method|futureClue)\b/);
});
