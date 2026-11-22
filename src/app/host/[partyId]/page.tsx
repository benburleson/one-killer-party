import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { service } from "@/lib/host/service";
import { currentUserId } from "@/lib/host/auth";
import { lobbyService } from "@/lib/lobby/service";
import { EnrollHostForm, RecoveryForm, RemoveParticipantForm, RotateForm } from "../forms";
import { signOut } from "../actions";

async function Party({ params }: { params: Promise<{ partyId: string }> }) {
  await connection();
  const { partyId } = await params;
  let party;
  try { party = await service().get(partyId); } catch { redirect("/host"); }
  if (!party) redirect("/host");
  let participants;
  try {
    const host = await currentUserId();
    if (!host) redirect("/host");
    participants = await lobbyService().hostRoster(host, party.partyId);
  } catch { redirect("/host"); }
  const hostIsPlaying = participants.some((participant) => participant.isHost);
  const capacity = party.mysteryId === "blackwood-affair" ? 8 : null;
  return <>
    <div className="flex justify-between gap-4">
      <h1 className="text-3xl font-bold">Blackwood Affair</h1>
      <form action={signOut}><button className="underline">Sign out</button></form>
    </div>
    <p className="mt-4">Party: {party.partyId}</p>
    <p>Status: {party.status} · Version: {party.version}</p>
    <h2 className="mb-3 mt-8 text-xl font-semibold">
      Players ({participants.length}{capacity === null ? "" : `/${capacity}`})
    </h2>
    {participants.length === 0 ? <p>No players have joined yet.</p> : (
      <ul className="space-y-4">
        {participants.map((participant) => (
          <li key={participant.participantId} className="rounded border border-gray-600 p-3">
            <p className="font-semibold">{participant.displayName}{participant.isHost ? " (host)" : ""}</p>
            <p className="break-all font-mono text-sm text-gray-300">Participant ID: {participant.participantId}</p>
            {!participant.isHost && <>
              <RemoveParticipantForm partyId={party.partyId} participantId={participant.participantId} />
              <RecoveryForm partyId={party.partyId} participantId={participant.participantId} />
            </>}
          </li>
        ))}
      </ul>
    )}
    <p className="mt-4">Players are waiting for the host to assign characters.</p>
    <h2 className="mb-3 mt-8 text-xl font-semibold">Play in this party</h2>
    {hostIsPlaying ? <p>You are enrolled as a player.</p> : (
      <EnrollHostForm partyId={party.partyId} />
    )}
    <h2 className="mb-3 mt-8 text-xl font-semibold">Invite</h2>
    <p className="mb-4">Invite codes cannot be recovered. Rotate to issue a new code and invalidate the previous one.</p>
    <RotateForm partyId={party.partyId} version={party.version} />
    <p className="mt-8"><Link prefetch={false} className="underline" href="/host">Your parties</Link></p>
  </>;
}

export default function PartyPage({ params }: { params: Promise<{ partyId: string }> }) {
  return <main className="min-h-screen bg-[#171923] px-6 py-12 text-white">
    <div className="mx-auto max-w-2xl"><Link href="/" prefetch={false} className="text-amber-300">ONE KILLER PARTY</Link>
      <div className="mt-8"><Suspense fallback={<p>Loading party…</p>}><Party params={params} /></Suspense></div>
    </div>
  </main>;
}
