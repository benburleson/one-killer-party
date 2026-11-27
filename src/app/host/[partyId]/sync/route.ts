import { lobbyService, syncUser } from "@/lib/lobby/service";

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    const user = await syncUser();
    if (!user?.isHost) return new Response(null, { status: 401, headers });
    const { partyId } = await params;
    const roster = await lobbyService().hostRoster(user.id, partyId);
    const confirmed = await syncUser();
    if (!confirmed?.isHost || confirmed.id !== user.id || confirmed.context !== user.context) {
      return new Response(null, { status: 503, headers });
    }
    return Response.json({ version: roster.version, context: user.context }, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
