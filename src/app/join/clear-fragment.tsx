"use client";

import { useEffect } from "react";
import { invitationCodeFromFragment } from "@/lib/lobby/invite-code";

export function ClearFragment({ onCode }: { onCode: (code: string) => void }) {
  useEffect(() => {
    const fragment = window.location.hash;
    if (!fragment) return;
    const code = invitationCodeFromFragment(fragment);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    if (code) onCode(code);
  }, [onCode]);
  return null;
}
