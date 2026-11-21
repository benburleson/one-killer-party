import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { service } from "@/lib/host/service";
import { RotateForm } from "../forms";
import { signOut } from "../actions";

async function Party({ params }: { params: Promise<{ partyId: string }> }) {
  await connection();
  const { partyId } = await params;
  let party;
  try { party = await service().get(partyId); } catch { redirect("/host"); }
  if (!party) redirect("/host");
  return <>
    <div className="flex justify-between gap-4">
      <h1 className="text-3xl font-bold">Blackwood Affair</h1>
      <form action={signOut}><button className="underline">Sign out</button></form>
    </div>
    <p className="mt-4">Party: {party.partyId}</p>
    <p>Status: {party.status} · Version: {party.version}</p>
    <p className="mt-4">No guests yet. Guest joining is not available yet.</p>
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
