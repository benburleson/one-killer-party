import { Suspense } from "react";
import { connection } from "next/server";
import { lobbyService, signedInUser, type GuestMembership } from "@/lib/lobby/service";
import { GuestEntry } from "./forms";

async function JoinContent() {
  await connection();
  let user = null;
  let memberships: GuestMembership[] = [];
  let membershipUnavailable = false;
  try {
    user = await signedInUser();
    if (user) memberships = await lobbyService().myMemberships(user.id);
  } catch {
    membershipUnavailable = !!user?.isAnonymous;
  }
  return <main className="min-h-screen bg-[#171923] px-6 py-12 text-white">
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold">Join the Blackwood Affair</h1>
      <p className="mt-4">Use the host’s invitation link or enter its eight-character code.</p>
      <GuestEntry existingMemberships={memberships} hostSession={!!user && !user.isAnonymous}
        membershipUnavailable={membershipUnavailable} />
    </div>
  </main>;
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#171923] px-6 py-12 text-white">Loading lobby…</main>}>
      <JoinContent />
    </Suspense>
  );
}
