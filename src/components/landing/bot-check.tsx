"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { TableLoader } from "@/components/motion/table-loader";
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
const SCRIPT_TIMEOUT_MS = 15_000;
const CREATE_TIMEOUT_MS = 20_000;
type ErrorKind = "check" | "connection" | "server";
type State = { kind: "checking" } | { kind: "creating" } | { kind: "error"; error: ErrorKind; reason: string };

const COPY = {
  checking: { title: "Preparing your table…", line: "Just a quick security check before we start." },
  creating: { title: "Setting up your table…", line: "Getting everything ready for your order." },
};
const ERROR_TITLE: Record<ErrorKind, string> = {
  check: "Verification could not finish.",
  connection: "Connection was lost.",
  server: "We couldn’t set up your table.",
};
const REASON = {
  failed: "The quick check couldn’t finish. Try again.",
  timeout: "The check timed out. Try again.",
  expired: "The check expired before we could use it. Try again.",
  unsupported: "This browser can’t run the quick check. Try another browser.",
  load: "The quick check couldn’t load. Check your connection and try again.",
  connection: "No connection. Check your data or Wi-Fi and try again.",
  server: "Could not start an order. Try again.",
};

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
 * to creating. Owns the heading, so the copy follows the state.
 */
export function BotCheck({ siteKey }: { siteKey?: string }) {
  if (siteKey) preconnect("https://challenges.cloudflare.com");
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const attemptKey = useRef<string | null>(null);
  const started = useRef(false);
  const initial: State = { kind: siteKey ? "checking" : "creating" };
  const phase = useRef(initial.kind);
  const [state, setState] = useState<State>(initial);

  function go(next: State) {
    phase.current = next.kind;
    setState(next);
  }
  // Callbacks from Cloudflare only matter while we are waiting on the check; later ones (e.g. expiry of a used token) are stale.
  function failCheck(reason: string) {
    if (phase.current !== "checking") return;
    track({ name: "turnstile_failed" });
    go({ kind: "error", error: "check", reason });
  }

  async function create(token?: string) {
    if (started.current) return;
    started.current = true;
    go({ kind: "creating" });
    const fail = (error: ErrorKind, reason: string) => {
      started.current = false;
      go({ kind: "error", error, reason });
    };
    attemptKey.current ??= crypto.randomUUID();
    let response: Response;
    let body: { data?: { id: string }; error?: { code?: string; message?: string } } | null;
    try {
      response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attemptKey.current },
        body: JSON.stringify(token ? { turnstileToken: token } : {}),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
      body = await response.json().catch(() => null);
    } catch {
      return fail("connection", REASON.connection);
    }
    if (!response.ok) {
      const code = body?.error?.code;
      const isCheck = code === "BOT_CHECK_FAILED" || code === "BOT_CHECK_UNAVAILABLE";
      return fail(isCheck ? "check" : "server", body?.error?.message ?? REASON.server);
    }
    if (!body?.data) return fail("connection", REASON.connection);
    track({ name: "order_started" });
    router.replace(`/s/${body.data.id}`);
  }
  const createRef = useRef(create);
  const failRef = useRef(failCheck);
  useEffect(() => {
    createRef.current = create;
    failRef.current = failCheck;
  });

  useEffect(() => {
    if (!siteKey) {
      void createRef.current();
      return;
    }
    let cancelled = false;
    let timedOut = false;
    track({ name: "turnstile_shown" });
    const watchdog = setTimeout(() => {
      timedOut = true;
      failRef.current(REASON.load);
    }, SCRIPT_TIMEOUT_MS);
    loadScript()
      .then(() => {
        clearTimeout(watchdog);
        if (cancelled || timedOut || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action: "create-order",
          appearance: "interaction-only",
          size: window.matchMedia("(max-width: 339px)").matches ? "compact" : "normal",
          callback: (token: string) => {
            if (phase.current !== "checking") return;
            track({ name: "turnstile_passed" });
            void createRef.current(token);
          },
          "error-callback": () => failRef.current(REASON.failed),
          "timeout-callback": () => failRef.current(REASON.timeout),
          "unsupported-callback": () => failRef.current(REASON.unsupported),
          "expired-callback": () => failRef.current(REASON.expired),
        });
      })
      .catch(() => {
        clearTimeout(watchdog);
        if (!cancelled && !timedOut) failRef.current(REASON.load);
      });
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  const isError = state.kind === "error";
  return (
    <div>
      <TableLoader still={isError} />
      {/* Always mounted so only the checking -> creating change is announced; errors speak through the alert. */}
      <div role="status" aria-live="polite">
        {isError ? null : (
          <>
            <h1 className="mt-4 min-h-[2lh] text-3xl min-[440px]:min-h-[1lh]">{COPY[state.kind].title}</h1>
            <p className="mt-2 min-h-[2lh] text-balance text-ink-soft min-[440px]:min-h-[1lh]">{COPY[state.kind].line}</p>
          </>
        )}
      </div>
      {isError ? (
        <div role="alert" className="mt-4">
          <h1 className="text-3xl">{ERROR_TITLE[state.error]}</h1>
          <p className="mt-2 text-balance text-ink-soft">{state.reason}</p>
        </div>
      ) : null}
      <div ref={box} className={isError ? "hidden" : "mt-4 flex min-h-[65px] justify-center"} />
      {isError ? (
        <div className="mt-5">
          <Button
            onClick={() => {
              go({ kind: siteKey ? "checking" : "creating" });
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
