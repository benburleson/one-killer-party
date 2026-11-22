"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { joinParty, redeemRecovery, type GuestFormState } from "./actions";
import { ClearFragment } from "./clear-fragment";
import { TurnstileWidget } from "../turnstile-widget";

const button = "rounded bg-amber-300 px-4 py-2 font-semibold text-gray-950 disabled:opacity-50";
const field = "w-full rounded border border-gray-500 bg-gray-900 p-2 text-white";

function WaitingLobby({ membership }: { membership: NonNullable<GuestFormState["membership"]> }) {
  return (
    <section className="mt-8 space-y-3 rounded border border-gray-600 p-4" aria-label="Your guest lobby">
      <h2 className="text-xl font-semibold">You’re in the lobby</h2>
      <p>Party: {membership.partyId}</p>
      <p>Status: {membership.status}</p>
      <p>Your display name: {membership.displayName}</p>
      <p>Waiting for the host to assign characters.</p>
    </section>
  );
}

function JoinForm({
  code,
  setCode,
  onJoined,
}: {
  code: string;
  setCode: (value: string) => void;
  onJoined: (membership: NonNullable<GuestFormState["membership"]>) => void;
}) {
  const [state, action, pending] = useActionState(joinParty, {});
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    if (state.membership) {
      setCode("");
      onJoined(state.membership);
    }
  }, [state.membership, setCode, onJoined]);
  return (
    <>
      {!state.membership && (
        <form action={action} className="mt-6 space-y-4">
          <label className="block">Eight-character invitation code
            <input
              className={field}
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={8}
              required
            />
          </label>
          <label className="block">Your display name
            <input className={field} name="displayName" autoComplete="nickname" maxLength={50} required />
          </label>
          <TurnstileWidget action="guest_join" pending={pending} onVerifiedChange={setVerified} />
          <button className={button} disabled={pending || !verified}>Join party</button>
          {state.message && <p role="status">{state.message}</p>}
        </form>
      )}
    </>
  );
}

function RecoveryForm({
  onRecovered,
}: {
  onRecovered: (membership: NonNullable<GuestFormState["membership"]>) => void;
}) {
  const [state, action, pending] = useActionState(redeemRecovery, {});
  const [verified, setVerified] = useState(false);
  const [token, setToken] = useState("");
  useEffect(() => {
    if (state.membership) onRecovered(state.membership);
  }, [state.membership, onRecovered]);
  if (state.membership) return null;
  return (
    <form action={action} className="mt-8 space-y-4 border-t border-gray-600 pt-6">
      <h2 className="text-xl font-semibold">Recover a guest session</h2>
      <p>Use the one-time credential given to you by the host after they verified your identity.</p>
      <label className="block">Recovery credential
        <input
          className={field}
          name="recoveryToken"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <TurnstileWidget action="guest_recovery" pending={pending} onVerifiedChange={setVerified} />
      <button className={button} disabled={pending || !verified}>Recover membership</button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}

export function GuestEntry({ existingMemberships, hostSession = false }: {
  existingMemberships: NonNullable<GuestFormState["membership"]>[];
  hostSession?: boolean;
}) {
  const [inviteCode, setInviteCode] = useState("");
  const [currentMembership, setCurrentMembership] = useState<NonNullable<GuestFormState["membership"]> | null>(null);
  const [recovering, setRecovering] = useState(false);
  return (
    <>
      <ClearFragment onCode={setInviteCode} />
      {existingMemberships.length ? (
        <div className="mt-8 space-y-4">
          {existingMemberships.map((membership) => (
            <WaitingLobby key={membership.participantId} membership={membership} />
          ))}
        </div>
      ) : currentMembership ? (
        <WaitingLobby membership={currentMembership} />
      ) : hostSession ? (
        <section className="mt-8 space-y-4 rounded border border-amber-300 p-4" role="status">
          <h2 className="text-xl font-semibold">Open this invitation in a private window</h2>
          <p>You’re signed in as a host in this browser. To join as a guest without replacing your host session, open the invitation in a private/incognito window or a different browser.</p>
          <p>Your host session here will stay signed in.</p>
          <Link href="/host" className="inline-block underline">Return to host dashboard</Link>
        </section>
      ) : (
        <section className="mt-6 space-y-4">
          {recovering ? (
            <RecoveryForm onRecovered={setCurrentMembership} />
          ) : (
            <JoinForm code={inviteCode} setCode={setInviteCode} onJoined={setCurrentMembership} />
          )}
          <button
            type="button"
            className="text-sm text-amber-300 underline"
            onClick={() => setRecovering((value) => !value)}
          >
            {recovering ? "Join with an invitation code instead" : "Lost access to your guest session? Recover it"}
          </button>
        </section>
      )}
    </>
  );
}
