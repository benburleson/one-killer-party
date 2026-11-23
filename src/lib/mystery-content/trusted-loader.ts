import "server-only";
import type { PublishedVersionRef } from "./schema.ts";
import { loadTrustedPublishedMystery } from "./trusted-loader-core.ts";
import { serviceRoleClient } from "@/lib/supabase/service-client";

export async function loadPublishedMysteryDefinition(ref: PublishedVersionRef) {
  try {
    const client = serviceRoleClient();
    return await loadTrustedPublishedMystery(ref, {
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
        const { data, error } = await client.storage.from("private-mystery-packages").download(path);
        if (error || !data) throw new Error("unavailable");
        return new Uint8Array(await data.arrayBuffer());
      },
    });
  } catch {
    return { ok: false, code: "CONTENT_UNAVAILABLE" } as const;
  }
}
