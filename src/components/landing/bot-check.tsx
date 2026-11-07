"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
type State = { kind: "checking" } | { kind: "creating" } | { kind: "error"; message: string };

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const script = existing ?? Object.assign(document.createElement("script"), { src: SCRIPT, async: true });
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")), { once: true });
    if (!existing) document.head.append(script);
  });
}

/**
 * The bot check before an order exists (owner request). With a Turnstile site key: Cloudflare's widget (managed mode:
 * most people pass without a click), then the order is created with the token. Without one (development): straight
 * to creating.
 */
export function BotCheck({ siteKey }: { siteKey?: string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const attemptKey = useRef<string | null>(null);
  const started = useRef(false);
  const [state, setState] = useState<State>({ kind: siteKey ? "checking" : "creating" });

  async function create(token?: string) {
    if (started.current) return;
    started.current = true;
    setState({ kind: "creating" });
    try {
      attemptKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attemptKey.current },
        body: JSON.stringify(token ? { turnstileToken: token } : {}),
      });
      const body = (await response.json().catch(() => null)) as { data?: { id: string }; error?: { message: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "Could not start an order. Try again.");
      track({ name: "order_started" });
      router.replace(`/s/${body.data.id}`);
    } catch (error) {
      started.current = false;
      setState({ kind: "error", message: error instanceof Error && error.message !== "Failed to fetch" ? error.message : "No connection. Check your data or Wi-Fi and try again." });
      // A Turnstile token works once: get a fresh one for the retry.
      if (widget.current) window.turnstile?.reset(widget.current);
    }
  }
  const createRef = useRef(create);
  useEffect(() => {
    createRef.current = create;
  });

  useEffect(() => {
    if (!siteKey) {
      void createRef.current();
      return;
    }
    let cancelled = false;
    track({ name: "turnstile_shown" });
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action: "create-order",
          appearance: "interaction-only",
          callback: (token: string) => {
            track({ name: "turnstile_passed" });
            void createRef.current(token);
          },
          "error-callback": () => {
            track({ name: "turnstile_failed" });
            setState({ kind: "error", message: "The quick check couldn’t finish. Try again." });
          },
          "expired-callback": () => widget.current && window.turnstile?.reset(widget.current),
        });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "The quick check couldn’t load. Check your connection and try again." }));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  return (
    <div className="mt-5">
      <div ref={box} className="flex min-h-[65px] justify-center" />
      <p role="status" aria-live="polite" className="mt-3 flex items-center justify-center gap-2 text-ink-soft">
        {state.kind === "error" ? null : <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {state.kind === "checking" ? "Checking you’re a person…" : state.kind === "creating" ? "Starting your order…" : null}
      </p>
      {state.kind === "error" ? (
        <div className="mt-2 space-y-3 text-center">
          <p role="alert" className="text-bad">
            {state.message}
          </p>
          <Button
            onClick={() => {
              setState({ kind: siteKey ? "checking" : "creating" });
              if (!siteKey) void create();
              else if (widget.current) window.turnstile?.reset(widget.current);
              else window.location.reload();
            }}
          >
            <ShieldCheck className="size-5" aria-hidden />
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
