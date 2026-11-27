"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DossierLifecycle, dossierContextKey, type DossierProjection } from "./dossier-client";

export const INVALIDATE_PRIVATE_UI = "lobby-private-invalidate";

export function invalidatePrivateUI(reset = false) {
  window.dispatchEvent(new CustomEvent(INVALIDATE_PRIVATE_UI, { detail: { reset } }));
}

export function MyCharacter({ partyId, participantId, characterId, available, validated, contextVersion, reconciliation }: {
  partyId: string;
  participantId: string;
  characterId: string | null;
  available: boolean;
  validated: boolean;
  contextVersion?: number;
  reconciliation: number;
}) {
  const [lifecycle] = useState(() => new DossierLifecycle());
  const [state, setState] = useState<{ key: string; generation: number; loading: boolean; dossier: DossierProjection | null; error: boolean } | null>(null);
  const privateContent = useRef<HTMLElement>(null);
  const key = dossierContextKey(partyId, participantId, characterId, available, contextVersion);
  const close = useCallback(() => {
    if (privateContent.current) privateContent.current.hidden = true;
    lifecycle.close();
    setState(null);
  }, [lifecycle]);

  useLayoutEffect(() => {
    const suspend = () => {
      if (privateContent.current) privateContent.current.hidden = true;
      if (lifecycle.suspend()) {
        setState({ key, generation: lifecycle.token(), loading: true, dossier: null, error: false });
      }
    };
    const invalidate = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.reset) close();
      else suspend();
    };
    window.addEventListener(INVALIDATE_PRIVATE_UI, invalidate);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", suspend);
    window.addEventListener("popstate", suspend);
    const visibility = () => { if (document.visibilityState !== "visible") suspend(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", suspend);
    return () => {
      window.removeEventListener(INVALIDATE_PRIVATE_UI, invalidate);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", suspend);
      window.removeEventListener("popstate", suspend);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", suspend);
      lifecycle.close();
    };
  }, [lifecycle, close, key]);

  const current = state?.key === key && lifecycle.isCurrent(state.generation) ? state : null;
  const open = useCallback(async () => {
    if (!validated || !available || !characterId ||
        document.visibilityState !== "visible" || !navigator.onLine) return;
    const currentGeneration = lifecycle.begin();
    setState({ key, generation: currentGeneration, loading: true, dossier: null, error: false });
    const dossier = await lifecycle.request.open(partyId, characterId);
    if (!lifecycle.isCurrent(currentGeneration)) return;
    setState({ key, generation: currentGeneration, loading: false, dossier, error: !dossier });
  }, [available, characterId, key, partyId, lifecycle, validated]);
  useEffect(() => {
    if (validated && lifecycle.shouldResume()) {
      void Promise.resolve().then(() => {
        if (lifecycle.shouldResume()) void open();
      });
    }
  }, [validated, open, reconciliation, lifecycle]);
  if (!available || !characterId) return null;
  return <section className="mt-4 space-y-3" aria-label="My Character">
    {!current ? <button type="button" className="rounded bg-amber-300 px-4 py-2 font-semibold text-gray-950 disabled:opacity-50" disabled={!validated} onClick={open}>My Character</button> : <>
      <button type="button" className="underline" onClick={close}>Close</button>
      {current.loading && <p role="status">{validated ? "Loading your character…" : "Waiting to reconnect…"}</p>}
      {current.error && <div role="status"><p>Your character is unavailable.</p>
        <button type="button" className="underline" onClick={open}>Retry</button></div>}
      {validated && current.dossier && <article ref={privateContent} className="space-y-3 rounded border border-amber-300 p-4">
        <h3 className="text-xl font-semibold">{current.dossier.character.publicName}</h3>
        <p>{current.dossier.character.archetype}</p>
        <h4 className="font-semibold">Biography</h4>
        <p className="whitespace-pre-wrap">{current.dossier.biography}</p>
        <h4 className="font-semibold">Relationships</h4>
        <ul className="space-y-2">{current.dossier.relationships.map((relationship) =>
          <li key={relationship.characterId}><strong>{relationship.publicName}</strong><p className="whitespace-pre-wrap">{relationship.perspective}</p></li>)}</ul>
        <h4 className="font-semibold">Prompts</h4>
        <ul className="list-disc space-y-2 pl-5">{current.dossier.interpersonalPrompts.map((prompt, index) =>
          <li key={index} className="whitespace-pre-wrap">{prompt}</li>)}</ul>
      </article>}
    </>}
  </section>;
}
