import type { DossierProjection } from "./dossier-core.ts";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const unavailable = (status: number) => Response.json({ error: "Dossier unavailable" }, { status, headers });

export async function dossierRequest(
  partyId: Promise<{ partyId: string }>,
  dependencies: Readonly<{
    sameOrigin(): Promise<boolean>;
    getDossier(partyId: string): Promise<DossierProjection | null>;
  }>,
): Promise<Response> {
  try {
    if (!await dependencies.sameOrigin()) return unavailable(403);
    const dossier = await dependencies.getDossier((await partyId).partyId);
    return dossier ? Response.json({ dossier }, { headers }) : unavailable(404);
  } catch {
    return unavailable(404);
  }
}

export function dossierMethodResponse(options = false): Response {
  return new Response(null, {
    status: options ? 204 : 405,
    headers: { ...headers, Allow: "POST, OPTIONS" },
  });
}
