"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { TurnstileWidget } from "../turnstile-widget";
import {
  createParty,
  enrollAsPlayer,
  initiateRecovery,
  removeParticipant,
  rotateInvite,
  signIn,
  type FormState,
  type LobbyActionState,
} from "./actions";

const button = "rounded bg-amber-300 px-4 py-2 font-semibold text-gray-950 disabled:opacity-50";
const field = "w-full rounded border border-gray-500 bg-gray-900 p-2 text-white";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, {});
  const [verified, setVerified] = useState(false);
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">Email address
        <input className={field} name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>
      <TurnstileWidget action="host_login" pending={pending} onVerifiedChange={setVerified} />
      <button className={button} disabled={pending || !verified}>Send sign-in link</button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}

function InviteResult({ state, initialLobby = false }: { state: FormState; initialLobby?: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const hide = () => setVisible(false);
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, []);
  if (state.result?.kind === "existing") {
    return <p role="status">This party already exists. The original code cannot be recovered. <a className="underline" href={`/host/${state.result.partyId}`}>Open party</a> to rotate it.</p>;
  }
  if (state.result?.kind !== "issued" || !visible) return null;
  return (
    <section className="space-y-3 rounded border border-amber-300 p-4" aria-label="New invite">
      {initialLobby && <>
        <h2 className="text-xl font-semibold">Blackwood Affair</h2>
        <p>Party: {state.result.partyId}</p>
        <p>Status: LOBBY · Version: 0</p>
        <p>No players have joined yet.</p>
      </>}
      <p>Save this invite now. It cannot be shown again after you leave or reload.</p>
      <p>Invite code: <strong>{state.result.code}</strong></p>
      <label className="block">Reusable invite link
        <input className={field} readOnly value={state.link ?? ""} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <p>Guests can use this code or link to join while admission is open.</p>
      <a className="underline" href={`/host/${state.result.partyId}`}>Open party</a>
    </section>
  );
}

function CreateForm() {
  const [state, action, pending] = useActionState(createParty, {});
  const id = useRef<HTMLInputElement>(null);
  const commandId = useRef("");
  return (
    <form action={action} className="space-y-4" onSubmit={() => {
      if (!commandId.current) commandId.current = crypto.randomUUID();
      if (id.current) id.current.value = commandId.current;
    }}>
      <input ref={id} type="hidden" name="partyId" defaultValue="" />
      {!state.result && <button className={button} disabled={pending}>Create a Blackwood Affair party</button>}
      {state.message && <p role="status">{state.message}</p>}
      <InviteResult state={state} initialLobby />
    </form>
  );
}

export function CreatePartyForm() {
  const [formKey, setFormKey] = useState(0);
  return (
    <div className="space-y-4">
      <CreateForm key={formKey} />
      <button className="underline" type="button" onClick={() => setFormKey((key) => key + 1)}>
        Start a separate party
      </button>
    </div>
  );
}

export function RotateForm({ partyId, version }: { partyId: string; version: number }) {
  const [state, action, pending] = useActionState(rotateInvite, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="partyId" value={partyId} />
      <input type="hidden" name="version" value={version} />
      {!state.result && <>
        <label className="flex gap-2">
          <input type="checkbox" name="confirm" value="yes" required />
          I understand the previous invite code will stop working.
        </label>
        <button className={button} disabled={pending}>Rotate invite</button>
      </>}
      {state.message && <p role="status">{state.message}</p>}
      <InviteResult state={state} />
    </form>
  );
}

export function EnrollHostForm({ partyId }: { partyId: string }) {
  const [state, action, pending] = useActionState(enrollAsPlayer, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="partyId" value={partyId} />
      <label className="block">Player display name
        <input className={field} name="displayName" required maxLength={50} />
      </label>
      <button className={button} disabled={pending}>Join as a player</button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}

export function RemoveParticipantForm({
  partyId,
  participantId,
}: {
  partyId: string;
  participantId: string;
}) {
  const [state, action, pending] = useActionState(removeParticipant, {});
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="partyId" value={partyId} />
      <input type="hidden" name="participantId" value={participantId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" required />
        I confirm removing this participant before the game starts.
      </label>
      <button className={button} disabled={pending}>Remove participant</button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}

export function RecoveryForm({
  partyId,
  participantId,
}: {
  partyId: string;
  participantId: string;
}) {
  const [state, action, pending] = useActionState<LobbyActionState, FormData>(initiateRecovery, {});
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!state.token) return;
    const hide = () => setVisible(false);
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, [state.token]);
  if (state.token && visible) {
    return (
      <section className="mt-3 rounded border border-amber-300 p-3" aria-label="Guest recovery credential">
        <p>Give this one-time credential to the verified guest out of band. It expires in 15 minutes and is shown only once.</p>
        <p className="mt-2 break-all font-mono" data-testid="recovery-credential">{state.token}</p>
      </section>
    );
  }
  if (state.token) return <p role="status">This one-time credential is no longer available. Start a new recovery after confirming the guest again.</p>;
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="partyId" value={partyId} />
      <input type="hidden" name="participantId" value={participantId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirmIdentity" value="yes" required />
        I have deliberately confirmed this guest’s identity out of band.
      </label>
      <button className={button} disabled={pending}>Start guest recovery</button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
