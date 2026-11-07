"use client";

import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { connectionMessage, connectionState, type ConnectionState } from "@/lib/connection";
import { cn } from "@/lib/utils";

/** How long the live connection may be down before we say so (network switches cause short drops). */
const DOWN_GRACE_MS = 4000;
const BACK_MS = 2500;

/**
 * Owner request: make it obvious when this phone loses its connection, and when it's back. Sits under the header,
 * above the "someone added" pills; never takes focus; read out politely once per change.
 */
export function ConnectionPill({ online, stream, unsent }: { online: boolean; stream: "connecting" | "live" | "reconnecting"; unsent: number }) {
  const [downLong, setDownLong] = useState(false);
  useEffect(() => {
    if (stream !== "reconnecting") return;
    const timer = setTimeout(() => setDownLong(true), DOWN_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setDownLong(false);
    };
  }, [stream]);

  const state = connectionState(online, downLong && stream === "reconnecting");
  // "Back online" for a moment after any trouble (React's previous-value pattern, compared during render).
  const [last, setLast] = useState<ConnectionState>(state);
  const [back, setBack] = useState(false);
  if (state !== last) {
    setLast(state);
    setBack(state === "ok");
  }
  useEffect(() => {
    if (!back || unsent > 0) return;
    const timer = setTimeout(() => setBack(false), BACK_MS);
    return () => clearTimeout(timer);
  }, [back, unsent]);

  const shown: ConnectionState | "back" | null = state !== "ok" ? state : back ? "back" : null;
  const Icon = shown === "offline" ? CloudOff : shown === "reconnecting" ? RefreshCw : Wifi;
  return (
    <div role="status" aria-live="polite" className="flex justify-center">
      {shown ? (
        <p
          key={shown}
          data-connection={shown}
          className={cn(
            "fade-in pointer-events-auto inline-flex max-w-full items-start gap-2 rounded-2xl px-3.5 py-2 text-sm shadow-ticket",
            shown === "back" ? "bg-saffron-wash text-saffron-ink ring-1 ring-saffron/40" : "bg-ink text-paper",
          )}
        >
          <Icon className={cn("mt-0.5 size-4 shrink-0", shown === "reconnecting" && "motion-safe:animate-spin")} aria-hidden />
          <span>{connectionMessage(shown, unsent)}</span>
        </p>
      ) : null}
    </div>
  );
}
