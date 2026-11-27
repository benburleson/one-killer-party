"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { invalidatePrivateUI, MyCharacter } from "./my-character";
import { hostVersionMatches, syncIdentityChanged } from "./dossier-client";

const INTERVAL = 5000;
const MAX_INTERVAL = 30000;

export function useLobbySync(
  url: string | null,
  onSnapshot: (snapshot: unknown) => void,
  onUnauthorized: () => void,
  onUnavailable: () => void,
) {
  const handlers = useRef({ onSnapshot, onUnauthorized, onUnavailable });
  useEffect(() => { handlers.current = { onSnapshot, onUnauthorized, onUnavailable }; }, [onSnapshot, onUnauthorized, onUnavailable]);
  const trigger = useRef<() => void>(() => {});
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!url) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let sequence = 0;
    let delay = INTERVAL;
    let identity: string | null = null;

    const invalidate = () => {
      invalidatePrivateUI();
      handlers.current.onUnavailable();
    };

    const cancel = () => {
      clearTimeout(timer);
      controller?.abort();
      sequence++;
    };
    const poll = async () => {
      cancel();
      if (stopped || document.visibilityState !== "visible" || !navigator.onLine) return;
      const current = sequence;
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const response = await fetch(url, { cache: "no-store", signal: request.signal });
        if (stopped || current !== sequence) return;
        if (response.status === 401 || response.status === 403) {
          stopped = true;
          invalidate();
          handlers.current.onUnauthorized();
          return;
        }
        if (!response.ok) throw new Error("Lobby unavailable");
        const data: unknown = await response.json();
        if (stopped || current !== sequence) return;
        if (!data || typeof data !== "object" || !("context" in data) ||
            typeof data.context !== "string" || !/^[0-9a-f]{64}$/.test(data.context)) {
          throw new Error("Invalid lobby context");
        }
        if (syncIdentityChanged(identity, data.context)) {
          invalidatePrivateUI(true);
          handlers.current.onUnavailable();
        }
        identity = data.context;
        handlers.current.onSnapshot(data);
        delay = INTERVAL;
        setReconnecting(false);
      } catch {
        if (stopped || current !== sequence) return;
        invalidate();
        setReconnecting(true);
        delay = Math.min(delay * 2, MAX_INTERVAL);
      } finally {
        clearTimeout(timeout);
        if (!stopped && current === sequence && document.visibilityState === "visible" && navigator.onLine) {
          timer = setTimeout(poll, delay);
        }
      }
    };
    const reconcile = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void poll();
      else {
        cancel();
        invalidate();
        setReconnecting(true);
      }
    };
    const restore = () => { cancel(); invalidate(); reconcile(); };
    const hide = () => { cancel(); invalidate(); setReconnecting(true); };
    trigger.current = reconcile;
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", reconcile);
    window.addEventListener("offline", reconcile);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    window.addEventListener("popstate", restore);
    reconcile();
    return () => {
      stopped = true;
      cancel();
      trigger.current = () => {};
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", reconcile);
      window.removeEventListener("offline", reconcile);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("popstate", restore);
    };
  }, [url]);

  const refresh = useCallback(() => trigger.current(), []);
  return { reconnecting, refresh };
}

export function HostLobbySync({ partyId, version, participantId, characterId, dossierAvailable }: {
  partyId: string; version: number; participantId: string | null; characterId: string | null; dossierAvailable: boolean;
}) {
  const router = useRouter();
  const [validatedVersion, setValidatedVersion] = useState<number | null>(null);
  const [reconciliation, setReconciliation] = useState(0);
  const { reconnecting } = useLobbySync(
    `/host/${partyId}/sync`,
    (data) => {
      if (!data || typeof data !== "object" || !("version" in data) ||
          !Number.isSafeInteger(data.version) || (data.version as number) < 0) {
        throw new Error("Invalid lobby snapshot");
      }
      if (!hostVersionMatches(version, data.version as number)) {
        invalidatePrivateUI(true);
        setValidatedVersion(null);
        router.refresh();
      } else {
        setValidatedVersion(version);
        setReconciliation((value) => value + 1);
      }
    },
    () => router.refresh(),
    () => setValidatedVersion(null),
  );
  return <>
    {reconnecting && <p role="status" className="mt-2 text-sm">Reconnecting to the lobby…</p>}
    {participantId && <MyCharacter partyId={partyId} participantId={participantId} characterId={characterId}
      available={dossierAvailable} validated={validatedVersion === version} contextVersion={version}
      reconciliation={reconciliation} />}
  </>;
}
