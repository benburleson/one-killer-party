import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { currentUserId } from "@/lib/host/auth";
import { service } from "@/lib/host/service";
import { signOut } from "./actions";
import { CreatePartyForm, SignInForm } from "./forms";

async function Dashboard() {
  await connection();
  let user: string | null = null;
  try { user = await currentUserId(); } catch { /* Show sign in when unavailable. */ }
  if (!user) {
    return <><h1 className="text-3xl font-bold">Host sign in</h1>
      <p className="mt-3">Sign in with an email magic link.</p>
      <SignInForm />
    </>;
  }
  let parties;
  try { parties = await service().list(); } catch {
    return <><h1 className="text-3xl font-bold">Host lobby</h1>
      <p className="mt-4">Party service is unavailable. Please try again later.</p>
      <form action={signOut}><button className="mt-4 underline">Sign out</button></form>
    </>;
  }
  return <>
    <div className="flex justify-between gap-4">
      <h1 className="text-3xl font-bold">Host lobby</h1>
      <form action={signOut}><button className="underline">Sign out</button></form>
    </div>
    <p className="my-4">Guest joining is not available yet.</p>
    <h2 className="mb-3 mt-8 text-xl font-semibold">Your parties</h2>
    {parties.length === 0 ? <p>No parties yet.</p> :
      <ul className="space-y-2">{parties.map((party) =>
        <li key={party.partyId}><a className="underline" href={`/host/${party.partyId}`}>Blackwood Affair · {party.partyId}</a> ({party.status})</li>)}</ul>}
    <h2 className="mb-3 mt-8 text-xl font-semibold">Create a party</h2>
    <p className="mb-4">If a response is lost, check your parties before creating another. Retrying this form uses the same request; reloading starts a new request.</p>
    <CreatePartyForm />
  </>;
}

export default function HostPage() {
  return <main className="min-h-screen bg-[#171923] px-6 py-12 text-white">
    <div className="mx-auto max-w-2xl">
      <Link href="/" prefetch={false} className="text-amber-300">ONE KILLER PARTY</Link>
      <div className="mt-8"><Suspense fallback={<p>Loading host lobby…</p>}><Dashboard /></Suspense></div>
    </div>
  </main>;
}
