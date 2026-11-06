"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-scene";
import type { TourStep } from "./tour-steps";

const GAP = 12;
const PAD = 6;

type Rect = { top: number; left: number; width: number; height: number };

/** The element a step points at, if it is on screen right now (hidden or missing targets are skipped). */
function targetOf(step: TourStep | undefined): HTMLElement | null {
  if (!step) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  return el && el.getClientRects().length > 0 ? el : null;
}

/**
 * A short spotlight tour: dims the screen except one control at a time, with a card saying what it is for. Keyboard:
 * arrows step, Escape closes, focus stays in the card and returns where it was. No library: a fixed frame with a
 * huge shadow is the spotlight.
 */
export function Tour({ steps, onClose }: { steps: readonly TourStep[]; onClose: () => void }) {
  const titleId = useId();
  const reduce = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);
  // Only the steps whose control is on screen when the tour starts (a confirmed round has no dish field, etc.).
  const [live] = useState(() => steps.filter((s) => targetOf(s)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = live[index];

  const measure = useCallback(() => {
    const el = targetOf(step);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    // Grown by PAD for breathing room, but kept on screen: a control at the edge keeps its whole frame.
    const top = Math.max(2, r.top - PAD);
    const left = Math.max(2, r.left - PAD);
    const right = Math.min(window.innerWidth - 2, r.right + PAD);
    const bottom = Math.min(window.innerHeight - 2, r.bottom + PAD);
    setRect({ top, left, width: right - left, height: bottom - top });
  }, [step]);

  useEffect(() => {
    returnTo.current = document.activeElement;
    return () => (returnTo.current as HTMLElement | null)?.focus?.();
  }, []);

  useEffect(() => {
    if (!step) {
      onClose();
      return;
    }
    targetOf(step)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    const frame = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 350); // after a smooth scroll
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    cardRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, measure, reduce, onClose]);

  const last = index === live.length - 1;
  const next = () => (last ? onClose() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") return onClose();
    if (event.key === "ArrowRight") return next();
    if (event.key === "ArrowLeft") return back();
    if (event.key !== "Tab") return;
    // Keep focus inside the card.
    const focusables = [...(cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    const first = focusables[0];
    const end = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      end?.focus();
    } else if (!event.shiftKey && document.activeElement === end) {
      event.preventDefault();
      first?.focus();
    }
  }

  if (!step) return null;
  // The card goes below the spotlight, or above it when the control sits low on the screen (the bottom dock).
  const below = !rect || rect.top + rect.height / 2 < window.innerHeight * 0.55;
  const cardStyle: React.CSSProperties = rect ? (below ? { top: rect.top + rect.height + GAP } : { bottom: window.innerHeight - rect.top + GAP }) : { top: "30%" };

  return createPortal(
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      {/* Clicks outside the card do nothing: the tour is short, and Skip is always there. */}
      <div className="absolute inset-0" aria-hidden />
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-2xl ring-2 ring-saffron transition-[top,left,width,height] duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none"
          style={{ ...rect, boxShadow: "0 0 0 9999px oklch(0.15 0.02 40 / 0.62)" }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink/60" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ticket fade-in fixed inset-x-4 mx-auto max-w-sm px-5"
        style={cardStyle}
        key={step.target}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-[0.14em] text-tomato-ink uppercase">
              {index + 1} of {live.length}
            </p>
            <h2 id={titleId} className="mt-1 text-xl">
              {step.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close the tour" className="-mt-1 -mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-ink-soft">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Skip
          </Button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button variant="outline" onClick={back}>
                Back
              </Button>
            ) : null}
            <Button data-primary onClick={next}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
