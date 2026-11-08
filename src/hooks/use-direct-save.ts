"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError, newKey } from "@/lib/api-client";

export type DirectSaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  /** Not saved; the typed value stays. `retryable`: same request again is safe (same key, applied at most once). */
  | { kind: "error"; message: string; retryable: boolean }
  /** Someone else changed it first: the latest value is on screen, the person decides. */
  | { kind: "conflict" };

/**
 * A change that waits for the server instead of going through the optimistic queue (KKB prices, the service charge):
 * the person must see a refusal or a conflict next to the value they typed. A retry of the same request reuses its
 * idempotency key, so it applies at most once; any different request (new value, or the new revision after a
 * conflict) gets a fresh key.
 */
export function useDirectSave(refresh: () => Promise<unknown>) {
  const [state, setState] = useState<DirectSaveState>({ kind: "idle" });
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const save = useCallback(
    async (path: string, method: "PUT" | "PATCH", body: unknown): Promise<boolean> => {
      const signature = `${method} ${path} ${JSON.stringify(body)}`;
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: newKey() };
      setState({ kind: "saving" });
      try {
        await api(path, { method, body, idempotencyKey: attempt.current.key });
        attempt.current = null;
        setState({ kind: "idle" });
        await refresh().catch(() => undefined); // the live stream catches up anyway
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONFLICT") {
          setState({ kind: "conflict" });
          await refresh().catch(() => undefined);
        } else if (error instanceof ApiError) {
          const retryable = error.isNetwork || error.status >= 500 || error.code === "RATE_LIMITED";
          setState({ kind: "error", message: error.isNetwork ? "No connection. Your amount is kept here; try again when you're back online." : error.message, retryable });
        } else {
          setState({ kind: "error", message: "Something went wrong. Try again.", retryable: true });
        }
        return false;
      }
    },
    [refresh],
  );

  const reset = useCallback(() => setState({ kind: "idle" }), []);
  return { state, save, reset };
}
