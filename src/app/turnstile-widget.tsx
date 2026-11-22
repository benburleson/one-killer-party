"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (target: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

/** Render a token for Supabase Auth to validate. Do not verify it again. */
export function TurnstileWidget({
  action, pending, onVerifiedChange,
}: {
  action: "host_login" | "guest_join" | "guest_recovery";
  pending: boolean;
  onVerifiedChange: (verified: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const previousPending = useRef(false);
  const [token, setToken] = useState("");
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY || "0x4AAAAAAGNYu6Zb0_5s2c2h";

  const invalidate = useCallback(() => {
    setToken("");
    onVerifiedChange(false);
  }, [onVerifiedChange]);
  const render = useCallback(() => {
    if (!container.current || !window.turnstile || widgetId.current !== null) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey, action, "response-field": false,
      callback: (value: string) => { setToken(value); onVerifiedChange(true); },
      "expired-callback": invalidate,
      "error-callback": () => { invalidate(); return true; },
    });
  }, [sitekey, action, onVerifiedChange, invalidate]);

  useEffect(() => {
    render();
    return () => {
      if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [render]);

  useEffect(() => {
    if (previousPending.current && !pending && widgetId.current !== null && window.turnstile) {
      // A token may already have been consumed by Supabase. Obtain a fresh one.
      invalidate();
      window.turnstile.reset(widgetId.current);
    }
    previousPending.current = pending;
  }, [pending, invalidate]);

  return <div className="space-y-2">
    <Script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      strategy="afterInteractive" onReady={render}
    />
    <div ref={container} aria-label="Human verification" />
    <input type="hidden" name="cf-turnstile-response" value={token} readOnly />
  </div>;
}
