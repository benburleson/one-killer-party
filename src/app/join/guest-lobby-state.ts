export type PendingLobbyKind = "joined" | "recovered" | "existing";

export function pendingLobbyStatus(kind: PendingLobbyKind, unauthorized: boolean) {
  const confirmation = kind === "recovered" ? "Recovery completed. " :
    kind === "joined" ? "You joined the party. " : "";
  return unauthorized
    ? { message: `${confirmation}This browser no longer has authorized access to the lobby. Reload the page or ask the host for help.`, canRetry: false }
    : { message: `${confirmation}Your lobby is not available yet. We’ll keep trying; if it remains unavailable, ask the host for help.`, canRetry: true };
}
