import { lobbyService, syncUser } from "@/lib/lobby/service";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    const user = await syncUser();
    if (!user) return new Response(null, { status: 401, headers });
    const memberships = await lobbyService().myMemberships(user.id);
    const confirmed = await syncUser();
    if (!confirmed || confirmed.id !== user.id || confirmed.context !== user.context) {
      return new Response(null, { status: 503, headers });
    }
    return Response.json({ memberships, context: user.context }, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
