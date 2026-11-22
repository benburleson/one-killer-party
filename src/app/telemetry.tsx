"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";

export function Telemetry() {
  const pathname = usePathname();
  if (pathname === "/join" || pathname?.startsWith("/host")) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
