"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { turnstileSitekey } from "../turnstile-widget";

const TOKEN_LIFETIME_MS = 4 * 60 * 1000;

export function PublisherVerification() {
  const container = useRef<HTMLDivElement>(null);
  const token = useRef("");
  const generation = useRef(0);
  const expiresAt = useRef(0);
  const copyingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("Start a challenge when you are ready.");

  const clearToken = useCallback(() => {
    token.current = "";
    generation.current += 1;
    expiresAt.current = 0;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const invalidationMessage = useCallback((message: string) =>
    copyingRef.current ? `${message} A pending clipboard request may still finish; clear your clipboard.` : message, []);

  useEffect(() => {
    if (!active) return;
    let widget: string | null = null;
    let disposed = false;
    const loadingTimer = setTimeout(() => {
      if (!disposed && widget === null) setMessage(invalidationMessage("Verification could not load. Reload this page and try again later."));
    }, 15_000);
    const render = () => {
      if (disposed || widget !== null || !container.current || !window.turnstile) return;
      try {
        clearTimeout(loadingTimer);
        widget = window.turnstile.render(container.current, {
          sitekey: turnstileSitekey, action: "publisher_login",
          "response-field": false, appearance: "interaction-only",
          callback: (value: string) => {
            if (disposed || !value) return;
            clearToken();
            token.current = value;
            expiresAt.current = Date.now() + TOKEN_LIFETIME_MS;
            setReady(true);
            setMessage(invalidationMessage("Verification complete. Copy the token and use it promptly."));
            timer.current = setTimeout(() => {
              clearToken();
              setReady(false);
              setMessage(invalidationMessage("The token expired. Start a new challenge."));
            }, TOKEN_LIFETIME_MS);
          },
          "expired-callback": () => {
            if (disposed) return;
            clearToken();
            setReady(false);
            setMessage(invalidationMessage("The token expired. Start a new challenge."));
          },
          "error-callback": () => {
            if (!disposed) {
              clearToken();
              setReady(false);
              setMessage(invalidationMessage("Verification failed. Start a new challenge or try again later."));
            }
            return true;
          },
        });
      } catch {
        setMessage(invalidationMessage("Verification could not start. Try again later."));
      }
    };
    window.addEventListener("one-killer-party:turnstile-ready", render);
    render();
    return () => {
      disposed = true;
      clearTimeout(loadingTimer);
      window.removeEventListener("one-killer-party:turnstile-ready", render);
      clearToken();
      if (widget !== null && window.turnstile) window.turnstile.remove(widget);
    };
  }, [active, attempt, clearToken, invalidationMessage]);

  function start() {
    clearToken();
    setReady(false);
    setMessage(invalidationMessage("Complete the human verification challenge."));
    setActive(true);
    setAttempt((value) => value + 1);
  }

  function cancel() {
    clearToken();
    setReady(false);
    setActive(false);
    setMessage(invalidationMessage("Challenge cancelled. Start a new challenge when ready."));
  }

  async function copy() {
    if (!token.current || copying) return;
    if (Date.now() >= expiresAt.current) {
      clearToken();
      setReady(false);
      setMessage(invalidationMessage("The token expired. Start a new challenge."));
      return;
    }
    if (!window.isSecureContext || !navigator.clipboard?.writeText) {
      setMessage("Secure clipboard access is unavailable. Use a supported browser on HTTPS; the token cannot be displayed.");
      return;
    }
    const value = token.current;
    const copyGeneration = generation.current;
    copyingRef.current = true;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(value);
      if (generation.current === copyGeneration) setMessage("Token copied. Paste it promptly into the CLI and clear your clipboard after use.");
    } catch {
      if (generation.current === copyGeneration) setMessage("Copy failed. Allow clipboard access or use a supported browser on HTTPS; the token cannot be displayed.");
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  return <div className="mt-6 space-y-4">
    {active && <Script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      strategy="afterInteractive"
      onReady={() => { window.dispatchEvent(new Event("one-killer-party:turnstile-ready")); }}
      onError={() => setMessage(invalidationMessage("Verification could not load. Check your connection, then reload this page."))}
    />}
    <div ref={container} aria-label="Human verification" />
    <p role="status" aria-live="polite">{message}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={start} className="rounded bg-amber-300 px-4 py-2 font-semibold text-black">
        {active ? "Start new challenge" : "Start challenge"}
      </button>
      <button type="button" onClick={copy} disabled={!ready || copying} className="rounded border border-white px-4 py-2 disabled:opacity-50">Copy token</button>
      {active && <button type="button" onClick={cancel} className="rounded border border-white px-4 py-2">Cancel challenge</button>}
    </div>
    <noscript>JavaScript is required to complete the challenge and copy the token.</noscript>
  </div>;
}
