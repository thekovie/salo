"use client";

import { ArrowLeft, BookOpen, ExternalLink, LoaderCircle } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { POLICY_CONTACT } from "@/components/policy/policy-page";
import { Button } from "@/components/ui/button";
import { DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useDirectSave } from "@/hooks/use-direct-save";
import { parseMenuUrl } from "@/lib/menu-url";
import type { SessionSnapshot } from "@/lib/snapshot";

export type MenuLinkValue = NonNullable<NonNullable<SessionSnapshot["session"]["menu"]>>;

/** First thing on the Order tab when the host set a menu link: the domain is visible before the tap. Renders nothing otherwise. */
export function MenuLink({ menu, title, isHost }: { menu: MenuLinkValue | null | undefined; title: string | null; isHost: boolean }) {
  if (!menu) return null;
  const name = menu.label ?? "View menu";
  const report = `mailto:${POLICY_CONTACT}?subject=${encodeURIComponent("Suspicious menu link")}&body=${encodeURIComponent(`${menu.url}${title ? `\nOrder: ${title}` : ""}`)}`;
  return (
    <div className="mb-4">
      <MenuAnchor menu={menu} name={name} />
      {isHost ? null : (
        <p className="mt-1 pr-3 text-right text-sm">
          <a href={report} className="inline-flex min-h-11 items-center text-ink-soft underline underline-offset-4">
            Report link
          </a>
        </p>
      )}
    </div>
  );
}

function MenuAnchor({ menu, name }: { menu: MenuLinkValue; name: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  // When the host removes the link while it has focus, focus would fall to <body>: hand it to the tab panel.
  useLayoutEffect(() => {
    const anchor = ref.current;
    return () => {
      if (anchor && document.activeElement === anchor) document.getElementById("panel-order")?.focus();
    };
  }, []);
  return (
    <a
      ref={ref}
      href={menu.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name}, ${menu.domain}, opens in a new tab`}
      className="flex min-h-12 items-center gap-3 rounded-xl bg-paper px-3 py-2 hover:bg-ink/6"
    >
      <BookOpen className="size-5 shrink-0 text-ink-soft" aria-hidden />
      <span className="min-w-0 flex-1">
        <span data-ph-mask="" className="block truncate font-semibold">
          {name}
        </span>
        {/* Cut from the start: the end of a hostname names the real site (a lookalike starts with the familiar part). */}
        <span data-ph-mask="" className="block truncate text-left text-sm text-ink-soft [direction:rtl]">
          <bdi>{menu.domain}</bdi>
        </span>
      </span>
      <ExternalLink className="size-5 shrink-0 text-ink-soft" aria-hidden />
    </a>
  );
}

interface MenuLinkStepProps {
  sessionId: string;
  current: MenuLinkValue | null | undefined;
  refresh: () => Promise<unknown>;
  onBack: () => void;
  close: React.ReactNode;
  onSaved: () => void;
}

/** Options sheet "menu" step. Goes straight to the server (it may refuse the link) instead of the offline queue. */
export function MenuLinkStep({ sessionId, current, refresh, onBack, close, onSaved }: MenuLinkStepProps) {
  const id = useId();
  const [url, setUrl] = useState(current?.url ?? "");
  const [label, setLabel] = useState(current?.label ?? "");
  const { state, save } = useDirectSave(refresh, "No connection. Try again when you’re back online.");
  const busy = state.kind === "saving";
  const error = state.kind === "error" ? state.message : "";
  const typed = url.trim();
  const parsed = typed ? parseMenuUrl(typed) : null;
  const hint = !parsed ? "" : parsed.ok ? `Opens ${parsed.domain}` : parsed.reason;

  async function send(body: { url: string | null; label?: string | null }) {
    if (await save(`/api/sessions/${sessionId}/menu`, "PUT", body)) onSaved();
  }

  return (
    <form
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed?.ok && !busy) void send({ url: parsed.url, label: label.trim() || null });
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <Button type="button" variant="ghost" disabled={busy} onClick={onBack} className="-ml-3">
          <ArrowLeft className="size-5" aria-hidden /> Menu link
        </Button>
        {close}
      </div>
      <DrawerTitle className="mt-1 font-display text-2xl font-medium">Share the menu link</DrawerTitle>
      <DrawerDescription className="mt-0.5 text-sm text-ink-soft">Paste the restaurant’s menu link. Everyone in the order can open it.</DrawerDescription>
      <label htmlFor={`${id}-url`} className="mt-4 block text-sm font-semibold">
        Link
      </label>
      <input
        id={`${id}-url`}
        value={url}
        autoFocus
        inputMode="url"
        type="text"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        enterKeyHint="next"
        placeholder="https://"
        aria-describedby={`${id}-hint`}
        aria-invalid={parsed?.ok === false}
        onChange={(e) => setUrl(e.target.value)}
        className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base"
      />
      <p id={`${id}-hint`} className={parsed?.ok === false ? "mt-1.5 min-h-5 text-sm text-bad" : "mt-1.5 min-h-5 text-sm text-ink-soft"}>
        {hint}
      </p>
      <label htmlFor={`${id}-label`} className="mt-3 block text-sm font-semibold">
        Label (optional)
      </label>
      <input
        id={`${id}-label`}
        value={label}
        maxLength={40}
        enterKeyHint="done"
        placeholder="Drinks menu"
        onChange={(e) => setLabel(e.target.value)}
        className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base"
      />
      <p role="alert" className={error ? "mt-3 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad" : "sr-only"}>
        {error}
      </p>
      <div className="mt-4 grid gap-2">
        <Button type="submit" disabled={busy || !parsed?.ok}>
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
          {busy ? "Working…" : "Save link"}
        </Button>
        {current ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void send({ url: null })}>
            Remove link
          </Button>
        ) : null}
      </div>
    </form>
  );
}
