"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { joinParty, redeemRecovery, type GuestFormState } from "./actions";
import { ClearFragment } from "./clear-fragment";
import { TurnstileWidget } from "../turnstile-widget";
import { useLobbySync } from "../lobby-sync";
type GuestMembership = NonNullable<GuestFormState["membership"]>;

const button = "rounded bg-amber-300 px-4 py-2 font-semibold text-gray-950 disabled:opacity-50";
const field = "w-full rounded border border-gray-500 bg-gray-900 p-2 text-white";

function validMembership(value: unknown): value is GuestMembership {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.partyId !== "string" || typeof item.participantId !== "string" ||
      typeof item.displayName !== "string" || item.status !== "LOBBY" ||
      !Number.isSafeInteger(item.participantCount)) return false;
  if (item.assignedCharacterId === null) return item.assignedCharacter === null;
  if (typeof item.assignedCharacterId !== "string" ||
      !item.assignedCharacter || typeof item.assignedCharacter !== "object") return false;
  const card = item.assignedCharacter as Record<string, unknown>;
  return card.id === item.assignedCharacterId && typeof card.publicName === "string" &&
    typeof card.archetype === "string" && typeof card.description === "string";
}

function WaitingLobby({ membership, refresh }: { membership: GuestMembership; refresh: () => void }) {
  return (
    <section className="mt-8 space-y-3 rounded border border-gray-600 p-4" aria-label="Your guest lobby">
      <h2 className="text-xl font-semibold">You’re in the lobby</h2>
      <p>Party: {membership.partyId}</p>
      <p>Status: {membership.status}</p>
      <p>Your display name: {membership.displayName}</p>
      {membership.assignedCharacter ? (
        <article className="rounded border border-amber-300 p-3" aria-label="Your assigned public character">
          <h3 className="text-xl font-semibold">{membership.assignedCharacter.publicName}</h3>
          <p className="text-amber-200">{membership.assignedCharacter.archetype}</p>
          <p>{membership.assignedCharacter.description}</p>
        </article>
      ) : <p>Waiting for the host to assign your character.</p>}
      <button
        type="button"
        className="text-sm text-amber-300 underline"
        onClick={refresh}
      >
        Refresh assignment
      </button>
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
  const [memberships, setMemberships] = useState(existingMemberships);
  const [lostMembership, setLostMembership] = useState(false);
  const hadMembership = useRef(existingMemberships.length > 0);
  const [recovering, setRecovering] = useState(false);
  const joined = useCallback((membership: GuestMembership) => {
    hadMembership.current = true;
    setLostMembership(false);
    setMemberships([membership]);
  }, []);
  const { reconnecting, refresh } = useLobbySync(
    memberships.length ? "/join/sync" : null,
    (data) => {
      if (!data || typeof data !== "object" || !("memberships" in data) ||
          !Array.isArray(data.memberships) || !data.memberships.every(validMembership)) {
        throw new Error("Invalid lobby snapshot");
      }
      if (hadMembership.current && data.memberships.length === 0) setLostMembership(true);
      hadMembership.current = data.memberships.length > 0;
      setMemberships(data.memberships);
    },
    () => {
      setMemberships([]);
      setLostMembership(true);
      hadMembership.current = false;
    },
  );
  return (
    <>
      <ClearFragment onCode={setInviteCode} />
      {reconnecting && memberships.length > 0 && <p role="status" className="mt-4 text-sm">Reconnecting to the lobby…</p>}
      {lostMembership && <p role="status" className="mt-4">This browser no longer has access to that lobby. Ask the host for help.</p>}
      {memberships.length ? (
        <div className="mt-8 space-y-4">
          {memberships.map((membership) => (
            <WaitingLobby key={membership.participantId} membership={membership} refresh={refresh} />
          ))}
        </div>
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
            <RecoveryForm onRecovered={joined} />
          ) : (
            <JoinForm code={inviteCode} setCode={setInviteCode} onJoined={joined} />
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
