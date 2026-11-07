/** What the connection pill should say, from the raw signals (pure, for tests). */
export type ConnectionState = "offline" | "reconnecting" | "ok";

/**
 * Offline when the phone says so. "Reconnecting" only once the live connection has been down for a while
 * (`streamDownLong`): a blip while switching networks shouldn't flash a warning.
 */
export function connectionState(online: boolean, streamDownLong: boolean): ConnectionState {
  if (!online) return "offline";
  return streamDownLong ? "reconnecting" : "ok";
}

export function connectionMessage(state: ConnectionState | "back", unsent: number): string {
  const waiting = unsent > 0 ? ` ${unsent} ${unsent === 1 ? "change" : "changes"} waiting.` : "";
  switch (state) {
    case "offline":
      return `You’re offline. Changes are kept on this phone and sent when you’re back.${waiting}`;
    case "reconnecting":
      return `Reconnecting… live updates are paused.${waiting}`;
    case "back":
      return unsent > 0 ? `Back online · sending ${unsent}…` : "Back online · all changes sent";
    case "ok":
      return "";
  }
}
