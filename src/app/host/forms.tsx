"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createParty, rotateInvite, signIn, type FormState } from "./actions";

const button = "rounded bg-amber-300 px-4 py-2 font-semibold text-gray-950 disabled:opacity-50";
const field = "w-full rounded border border-gray-500 bg-gray-900 p-2 text-white";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block">Email address
        <input className={field} name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>
      <button className={button} disabled={pending}>Send sign-in link</button>
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
        <p>No guests yet. Guest joining is not available yet.</p>
      </>}
      <p>Save this invite now. It cannot be shown again after you leave or reload.</p>
      <p>Invite code: <strong>{state.result.code}</strong></p>
      <label className="block">Reusable invite link
        <input className={field} readOnly value={state.link ?? ""} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <p>Guest joining is not available yet; this link is for a future release.</p>
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
