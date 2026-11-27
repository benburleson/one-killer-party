import { getMyStartingDossier } from "@/lib/mystery-content/dossier";
import { dossierMethodResponse, dossierRequest } from "@/lib/mystery-content/dossier-request";
import { sameOrigin } from "@/lib/request";

export async function POST(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  return dossierRequest(params, { sameOrigin, getDossier: getMyStartingDossier });
}

export function OPTIONS() { return dossierMethodResponse(true); }
export function GET() { return dossierMethodResponse(); }
export function HEAD() { return dossierMethodResponse(); }
export function PUT() { return dossierMethodResponse(); }
export function PATCH() { return dossierMethodResponse(); }
export function DELETE() { return dossierMethodResponse(); }
