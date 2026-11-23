import { loadVerifiedMysteryDefinition } from "./integrity.ts";
import { publishedVersionRefSchema, type MysteryDefinition, type PublishedVersionRef } from "./schema.ts";
import { EIGHT_ROLE_PROTOTYPE_RULES } from "./validate.ts";

const PRIVATE_BUCKET = "private-mystery-packages";

type RegistryRecord = Readonly<{
  mystery_id: string;
  version: string;
  schema_version: number;
  digest_sha256: string;
  object_path: string;
  rule_set_id: string;
}>;

export type TrustedPackageStore = Readonly<{
  lookup(ref: PublishedVersionRef): Promise<unknown>;
  download(path: string): Promise<Uint8Array>;
}>;

export type TrustedPackageLoadResult =
  | Readonly<{ ok: true; definition: MysteryDefinition }>
  | Readonly<{ ok: false; code: "CONTENT_UNAVAILABLE" }>;

function isRegistryRecord(value: unknown): value is RegistryRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.mystery_id === "string" &&
    typeof record.version === "string" &&
    typeof record.schema_version === "number" &&
    typeof record.digest_sha256 === "string" &&
    typeof record.object_path === "string" &&
    typeof record.rule_set_id === "string";
}

export async function loadTrustedPublishedMystery(
  expected: unknown,
  store: TrustedPackageStore,
): Promise<TrustedPackageLoadResult> {
  const parsedRef = publishedVersionRefSchema.safeParse(expected);
  if (!parsedRef.success) return { ok: false, code: "CONTENT_UNAVAILABLE" };
  const ref = parsedRef.data;
  if (ref.mysteryId === "blackwood-affair" && ref.version === "first-playtest-placeholder-v1") {
    return { ok: false, code: "CONTENT_UNAVAILABLE" };
  }

  try {
    const raw = await store.lookup(ref);
    if (!Array.isArray(raw) || raw.length !== 1 || !isRegistryRecord(raw[0])) {
      return { ok: false, code: "CONTENT_UNAVAILABLE" };
    }
    const record = raw[0];
    const path = `${ref.mysteryId}/${ref.version}/${ref.digestSha256}.json`;
    if (record.mystery_id !== ref.mysteryId ||
        record.version !== ref.version ||
        record.schema_version !== ref.schemaVersion ||
        record.digest_sha256 !== ref.digestSha256 ||
        record.object_path !== path ||
        record.rule_set_id !== EIGHT_ROLE_PROTOTYPE_RULES.id) {
      return { ok: false, code: "CONTENT_UNAVAILABLE" };
    }
    const bytes = await store.download(path);
    const verified = loadVerifiedMysteryDefinition(bytes, ref, EIGHT_ROLE_PROTOTYPE_RULES);
    if (!verified.ok) return { ok: false, code: "CONTENT_UNAVAILABLE" };
    return { ok: true, definition: verified.definition };
  } catch {
    return { ok: false, code: "CONTENT_UNAVAILABLE" };
  }
}

export { PRIVATE_BUCKET };
