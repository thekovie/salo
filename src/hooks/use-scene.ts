"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const media = matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** Live `prefers-reduced-motion`; false on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(QUERY).matches, () => false);
}

/**
 * Steps through a little illustrated scene: `timeline[i]` is how long step i stays before the next. Starts when the
 * scene scrolls into view, pauses when it leaves (looping scenes), and plays once unless `loop`. With reduced motion
 * the scene simply shows its final step, still. Before it plays (and without scripts) it shows step 0, so each scene's
 * first frame must already make sense on its own.
 */
export function useScene<T extends HTMLElement>(timeline: readonly number[], { loop = false } = {}) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  const last = timeline.length - 1;
  const [step, setStep] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const done = useRef(false);
  // Callers pass literal arrays; restart only when the durations actually change, not on every render.
  const durations = timeline.join(",");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !visible || (done.current && !loop)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = (i: number) => {
      if (cancelled) return;
      setStep(i);
      if (i === last && !loop) {
        done.current = true;
        return;
      }
      timer = setTimeout(() => run(i === last ? 0 : i + 1), Number(durations.split(",")[i]));
    };
    timer = setTimeout(() => run(0), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reduced, visible, loop, last, durations]);

  return { ref, step: reduced ? last : (step ?? 0) };
}
