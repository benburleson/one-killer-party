import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/host/auth";
import { lobbyService } from "@/lib/lobby/service";
import { BLACKWOOD_PUBLIC_CHARACTERS } from "@/lib/lobby/public-characters";
import { AssignCharacterForm, EnrollHostForm, RecoveryForm, RemoveParticipantForm, RotateForm } from "../forms";
import { signOut } from "../actions";
import { HostLobbySync } from "../../lobby-sync";

async function Party({ params }: { params: Promise<{ partyId: string }> }) {
  await connection();
  const { partyId } = await params;
  // hostRoster re-verifies the host and reads the party once; a missing,
  // foreign or malformed party is indistinguishable and returns to the list.
  let roster;
  try {
    const host = await currentUserId();
    if (!host) redirect("/host");
    roster = await lobbyService().hostRoster(host, partyId);
  } catch { redirect("/host"); }
  const party = roster;
  const participants = roster.participants;
  const hostIsPlaying = participants.some((participant) => participant.isHost);
  // Client components receive explicit allowlisted props, never whole server records.
  const assignmentRoster = participants.map(({ participantId, displayName, assignedCharacterId }) =>
    ({ participantId, displayName, assignedCharacterId }));
  const characterOptions = BLACKWOOD_PUBLIC_CHARACTERS.map(({ id, publicName, archetype }) =>
    ({ id, publicName, archetype }));
  const capacity = party.mysteryId === "blackwood-affair" ? 8 : null;
  return <>
    <div className="flex justify-between gap-4">
      <h1 className="text-3xl font-bold">Blackwood Affair</h1>
      <form action={signOut}><button className="underline">Sign out</button></form>
    </div>
    <p className="mt-4">Party: {party.partyId}</p>
    <p>Status: {party.status} · Version: {roster.version}</p>
    <HostLobbySync partyId={party.partyId} version={roster.version} />
    <h2 className="mb-3 mt-8 text-xl font-semibold">Public character roster</h2>
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Public character roster">
      {BLACKWOOD_PUBLIC_CHARACTERS.map((character) => {
        const occupant = participants.find((participant) =>
          participant.assignedCharacterId === character.id);
        return (
          <li key={character.id} className="rounded border border-gray-600 p-3">
            <h3 className="font-semibold">{character.publicName}</h3>
            <p className="text-sm text-amber-200">{character.archetype}</p>
            <p className="mt-2 text-sm">{character.description}</p>
            {occupant ? (
              <p className="mt-2 text-sm">Assigned to {occupant.displayName} · Participant ID: {occupant.participantId}</p>
            ) : <p className="mt-2 text-sm">Available</p>}
          </li>
        );
      })}
    </ul>
    <h2 className="mb-3 mt-8 text-xl font-semibold">
      Players ({participants.length}{capacity === null ? "" : `/${capacity}`})
    </h2>
    {participants.length === 0 ? <p>No players have joined yet.</p> : (
      <ul className="space-y-4">
        {participants.map((participant) => (
          <li key={participant.participantId} className="rounded border border-gray-600 p-3">
            <p className="font-semibold">{participant.displayName}{participant.isHost ? " (host)" : ""}</p>
            <p className="break-all font-mono text-sm text-gray-300">Participant ID: {participant.participantId}</p>
            <AssignCharacterForm
              key={participant.participantId}
              partyId={party.partyId}
              version={roster.version}
              participant={{
                participantId: participant.participantId,
                assignedCharacterId: participant.assignedCharacterId,
              }}
              participants={assignmentRoster}
              characters={characterOptions}
            />
            {!participant.isHost && <>
              <RemoveParticipantForm partyId={party.partyId} participantId={participant.participantId} />
              <RecoveryForm partyId={party.partyId} participantId={participant.participantId} />
            </>}
          </li>
        ))}
      </ul>
    )}
    {participants.some((participant) => participant.assignedCharacterId === null) && (
      <p className="mt-4">Players are waiting for the host to assign characters.</p>
    )}
    <h2 className="mb-3 mt-8 text-xl font-semibold">Play in this party</h2>
    {hostIsPlaying ? <p>You are enrolled as a player.</p> : (
      <EnrollHostForm partyId={party.partyId} />
    )}
    <h2 className="mb-3 mt-8 text-xl font-semibold">Invite</h2>
    <p className="mb-4">Invite codes cannot be recovered. Rotate to issue a new code and invalidate the previous one.</p>
    <RotateForm partyId={party.partyId} version={roster.version} />
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
