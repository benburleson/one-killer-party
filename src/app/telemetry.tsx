"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";

function allowEvent<T extends { url: string }>(event: T): T | null {
  try {
    if (window.location.pathname === "/publisher-verification" ||
        new URL(event.url, window.location.origin).pathname === "/publisher-verification") return null;
    return event;
  } catch {
    return null;
  }
}

export function Telemetry() {
  const pathname = usePathname();
  if (pathname === "/join" || pathname?.startsWith("/host") || pathname === "/publisher-verification") return null;
  return (
    <>
      <Analytics beforeSend={allowEvent} />
      <SpeedInsights beforeSend={allowEvent} />
    </>
  );
}
