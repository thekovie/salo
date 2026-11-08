"use client";

import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { InviteScene, AddScene, WaiterScene } from "@/components/landing/scenes";
import { Button } from "@/components/ui/button";
import { FullScreenSheet } from "@/components/workspace/full-screen-sheet";
import { track } from "@/lib/analytics";
import type { SessionSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { ForPriceScene, KkbScene, PeopleScene, RoundsScene } from "./guide-scenes";
import type { GuideAction, GuideScene, GuideStep } from "./guide-steps";

interface GuideProps {
  steps: readonly GuideStep[];
  snapshot: SessionSnapshot;
  onClose: () => void;
  /** Close the guide and take the person to the feature. */
  onTry: (action: GuideAction) => void;
  /** Why "Try it" can't work right now ("Add a dish first."), or null when it can. */
  blockedReason: (action: GuideAction) => string | null;
  onRename: (title: string | null) => void;
  onRenameMe: (displayName: string) => void;
}

/** The setup form and the final checklist are the picture on their own pages. */
const SCENES: Record<Exclude<GuideScene, "setup" | "done">, () => React.JSX.Element> = {
  invite: InviteScene,
  add: AddScene,
  forPrice: ForPriceScene,
  people: PeopleScene,
  waiter: WaiterScene,
  rounds: RoundsScene,
  kkb: KkbScene,
};

/**
 * The setup guide: one feature per page, each with a little moving picture of it, what it's for, and "Try it" to go
 * straight there. Steps already done in this order carry a check, and the last page is the checklist. Full screen on
 * phones (a native modal dialog: Escape closes, focus returns); arrow keys move between pages.
 */
export function Guide({ steps, snapshot, onClose, onTry, blockedReason, onRename, onRenameMe }: GuideProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;
  const isDone = (s: GuideStep) => Boolean(s.done?.(snapshot));
  const checklist = steps.filter((s) => s.done);

  useEffect(() => {
    track({ name: "tour_step", props: { index: index + 1, total: steps.length } });
    headingRef.current?.focus();
  }, [index, steps.length]);

  const go = (to: number) => setIndex(Math.min(steps.length - 1, Math.max(0, to)));
  const next = () => {
    if (!last) return go(index + 1);
    track({ name: "tour_completed" });
    onClose();
  };

  function onKeyDown(event: React.KeyboardEvent) {
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    if (event.key === "ArrowRight") next();
    if (event.key === "ArrowLeft") go(index - 1);
  }

  const reason = step.action ? blockedReason(step.action) : null;
  const Scene = step.scene === "setup" || step.scene === "done" ? null : SCENES[step.scene];

  return (
    <FullScreenSheet label="How Salo works" onClose={onClose}>
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]" onKeyDown={onKeyDown}>
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-xs tracking-[0.14em] text-tomato-ink uppercase" aria-live="polite">
            Step {index + 1} of {steps.length}
          </p>
          <button type="button" onClick={onClose} aria-label="Close the guide" className="-mr-2 inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <nav aria-label="Guide steps" className="mt-1">
          <ol className="flex gap-1">
            {steps.map((s, i) => (
              <li key={s.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${s.title}${isDone(s) ? ", done" : ""}`}
                  className="flex h-11 w-full cursor-pointer items-center"
                >
                  <span className={cn("h-1.5 w-full rounded-full transition-colors duration-300", i === index ? "bg-tomato" : isDone(s) ? "bg-ok" : i < index ? "bg-ink/35" : "bg-rule")} />
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div key={step.id} className="fade-in flex-1">
          {Scene ? (
            <div className="mt-2">
              <Scene />
            </div>
          ) : null}

          <div className="mt-5 flex items-start gap-2">
            <h2 id={titleId} ref={headingRef} tabIndex={-1} className="flex-1 text-2xl outline-none">
              {step.title}
            </h2>
            {isDone(step) ? (
              <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-ok-wash px-2.5 py-1 text-xs font-semibold text-ok">
                <Check className="size-3.5" aria-hidden /> Done
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-ink-soft">{step.body}</p>

          {step.scene === "setup" ? <SetupForm snapshot={snapshot} onRename={onRename} onRenameMe={onRenameMe} /> : null}

          {step.id === "done" ? (
            <ul className="mt-4 space-y-1" aria-label="Your checklist">
              {checklist.map((s) => {
                const done = isDone(s);
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => go(steps.indexOf(s))} className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-left hover:bg-ink/6">
                      <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full", done ? "bg-ok text-paper" : "ring-[1.5px] ring-input")}>{done ? <Check className="size-4" aria-hidden /> : null}</span>
                      <span className="flex-1">{s.label}</span>
                      <span className="text-sm text-ink-soft">{done ? "Done" : "Show me"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {reason ? <p className="mt-3 text-sm text-ink-soft">{reason}</p> : null}
        </div>

        <div className="sticky bottom-0 mt-6 flex items-center gap-2 bg-paper pt-3">
          <Button variant="ghost" onClick={() => go(index - 1)} disabled={index === 0}>
            <ChevronLeft className="size-5" aria-hidden /> Back
          </Button>
          <div className="ml-auto flex gap-2">
            {step.action ? (
              <Button variant="outline" disabled={Boolean(reason)} onClick={() => step.action && onTry(step.action)}>
                Try it
              </Button>
            ) : null}
            <Button onClick={next}>
              {last ? "Finish" : "Next"}
              {last ? null : <ChevronRight className="size-5" aria-hidden />}
            </Button>
          </div>
        </div>
      </div>
    </FullScreenSheet>
  );
}

/** Step one for the host: their own name and the order's, right here (the "setup" in setup guide). */
function SetupForm({ snapshot, onRename, onRenameMe }: Pick<GuideProps, "snapshot" | "onRename" | "onRenameMe">) {
  const id = useId();
  const unnamed = snapshot.me.displayName.trim().toLowerCase() === "host";
  const [name, setName] = useState(unnamed ? "" : snapshot.me.displayName);
  const [title, setTitle] = useState(snapshot.session.title ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <form
      noValidate
      className="mt-4 space-y-3 rounded-2xl bg-ticket p-4 shadow-ticket"
      onSubmit={(e) => {
        e.preventDefault();
        const nextName = name.trim();
        const nextTitle = title.trim() || null;
        if (nextName && nextName !== snapshot.me.displayName) onRenameMe(nextName);
        if (nextTitle !== snapshot.session.title) onRename(nextTitle);
        setSaved(true);
      }}
    >
      <div>
        <label htmlFor={`${id}-me`} className="text-sm font-semibold">
          Your name
        </label>
        <input
          id={`${id}-me`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={40}
          autoComplete="given-name"
          placeholder="So the table knows which dishes are yours"
          className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-input bg-paper px-3 text-base"
        />
      </div>
      <div>
        <label htmlFor={`${id}-title`} className="text-sm font-semibold">
          Order name
        </label>
        <input
          id={`${id}-title`}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
          maxLength={60}
          placeholder="Restaurant or occasion"
          className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-input bg-paper px-3 font-display text-lg"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline">
          Save
        </Button>
        <p role="status" className="text-sm text-ok">
          {saved ? "Saved." : ""}
        </p>
      </div>
    </form>
  );
}
