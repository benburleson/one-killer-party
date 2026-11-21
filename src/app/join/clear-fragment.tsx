"use client";

import { useEffect } from "react";

export function ClearFragment() {
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, []);
  return null;
}
