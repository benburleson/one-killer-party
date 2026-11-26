import "server-only";
import type { PublishedVersionRef } from "./schema.ts";
import { loadTrustedPublicMystery, loadTrustedPublishedMystery, PRIVATE_BUCKET, type TrustedPackageStore } from "./trusted-loader-core.ts";
import { serviceRoleClient } from "@/lib/supabase/service-client";

function packageStore(): TrustedPackageStore {
  const client = serviceRoleClient();
  return {
      async lookup(expected) {
        const { data, error } = await client.rpc("get_published_mystery", {
          p_mystery_id: expected.mysteryId,
          p_version: expected.version,
          p_schema_version: expected.schemaVersion,
          p_digest_sha256: expected.digestSha256,
        });
        if (error) throw new Error("unavailable");
        return data;
      },
      async download(path) {
        const { data, error } = await client.storage.from(PRIVATE_BUCKET).download(path);
        if (error || !data) throw new Error("unavailable");
        return new Uint8Array(await data.arrayBuffer());
      },
  };
}

export async function loadPublishedMysteryDefinition(ref: PublishedVersionRef) {
  try {
    return await loadTrustedPublishedMystery(ref, packageStore());
  } catch {
    return { ok: false, code: "CONTENT_UNAVAILABLE" } as const;
  }
}

export async function loadPublishedPublicMystery(ref: PublishedVersionRef) {
  try {
    return await loadTrustedPublicMystery(ref, packageStore());
  } catch {
    return { ok: false, code: "CONTENT_UNAVAILABLE" } as const;
  }
}
