"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVAL = 5000;
const MAX_INTERVAL = 30000;

export function useLobbySync(
  url: string | null,
  onSnapshot: (snapshot: unknown) => void,
  onUnauthorized: () => void,
) {
  const handlers = useRef({ onSnapshot, onUnauthorized });
  useEffect(() => { handlers.current = { onSnapshot, onUnauthorized }; }, [onSnapshot, onUnauthorized]);
  const trigger = useRef<() => void>(() => {});
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!url) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let sequence = 0;
    let delay = INTERVAL;

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
          handlers.current.onUnauthorized();
          return;
        }
        if (!response.ok) throw new Error("Lobby unavailable");
        const data: unknown = await response.json();
        if (stopped || current !== sequence) return;
        handlers.current.onSnapshot(data);
        delay = INTERVAL;
        setReconnecting(false);
      } catch {
        if (stopped || current !== sequence) return;
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
        setReconnecting(true);
      }
    };
    trigger.current = reconcile;
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", reconcile);
    window.addEventListener("offline", reconcile);
    reconcile();
    return () => {
      stopped = true;
      cancel();
      trigger.current = () => {};
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", reconcile);
      window.removeEventListener("offline", reconcile);
    };
  }, [url]);

  const refresh = useCallback(() => trigger.current(), []);
  return { reconnecting, refresh };
}

export function HostLobbySync({ partyId, version }: { partyId: string; version: number }) {
  const router = useRouter();
  const { reconnecting } = useLobbySync(
    `/host/${partyId}/sync`,
    (data) => {
      if (!data || typeof data !== "object" || !("version" in data) ||
          !Number.isSafeInteger(data.version) || (data.version as number) < 0) {
        throw new Error("Invalid lobby snapshot");
      }
      if ((data.version as number) > version) router.refresh();
    },
    () => router.refresh(),
  );
  return reconnecting ? <p role="status" className="mt-2 text-sm">Reconnecting to the lobby…</p> : null;
}
