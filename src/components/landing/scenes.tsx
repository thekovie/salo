"use client";

import { Check, Copy, ImageDown, Plus, UserPlus, UserRound } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Ticker } from "@/components/motion/ticker";
import { Stamp } from "@/components/ticket/stamp";
import { useScene } from "@/hooks/use-scene";
import { cn } from "@/lib/utils";

/*
 * Little illustrated scenes of the app for the landing page. They are pictures, not the app: decorative (aria-hidden),
 * with sample dishes and names, and the text beside each one says what it shows. Built from the app's own tokens so
 * they stay true in light and dark.
 */

/** Fades and lifts in when `on` turns true; keeps its space so nothing jumps. */
function Reveal({ on, className, children }: { on: boolean; className?: string; children: React.ReactNode }) {
  return <div className={cn("transition-[opacity,translate] duration-300 ease-[var(--ease-out-expo)]", on ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0", className)}>{children}</div>;
}

/** A dish line on a mini ticket; replays the highlighter wash when its count changes. */
function Line({ name, qty, wash, children }: { name: string; qty: number; wash?: boolean; children?: React.ReactNode }) {
  return (
    <li className="relative py-1.5">
      {wash ? <span key={qty} aria-hidden className="wash pointer-events-none absolute -inset-x-2 inset-y-0 rounded-md" /> : null}
      <div className="relative flex items-baseline justify-between gap-3">
        <span>{name}</span>
        <Ticker value={qty} prefix="×" className="tally text-xl text-tomato-ink" />
      </div>
      {children}
    </li>
  );
}

function Pill({ who, text }: { who: string; text: string }) {
  return (
    <span className="arrival-pill inline-flex max-w-full items-center gap-1.5 rounded-full bg-saffron-wash py-0.5 pr-3 pl-0.5 text-xs text-saffron-ink shadow-ticket ring-1 ring-saffron/40">
      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-saffron font-display text-[0.7rem] text-ink">{who[0]}</span>
      <span className="truncate">
        <span className="font-semibold">{who}</span> {text}
      </span>
    </span>
  );
}

/** A phone-shaped card the scenes sit in. */
function Phone({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[19rem] rounded-[2rem] bg-paper p-3 shadow-ticket ring-[1.5px] ring-rule", className)}>
      <div aria-hidden className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-rule" />
      {children}
    </div>
  );
}

/** Opens a row's height and fades it in, so a list grows without holding empty gaps. */
function Collapse({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-out-expo)]", on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const HERO_TIMELINE = [1300, 1100, 1300, 1300, 1200, 2600] as const;
const HERO_LAST = HERO_TIMELINE.length - 1;

/** The hero ticket's dish list at one step of the loop. */
function HeroLines({ step, still = false }: { step: number; still?: boolean }) {
  const katsu = step >= 2 ? 3 : step >= 1 ? 2 : 1;
  return (
    <ul className="mt-3 text-lg">
      <Line name="Chicken Katsu" qty={katsu} wash={!still}>
        <Collapse on={step >= 2}>
          <div className="mt-0.5 space-y-0.5 border-l-[1.5px] border-rule pl-3 text-base text-ink-soft">
            <div className="flex justify-between">
              <span>Regular</span>
              <span className="tally">×2</span>
            </div>
            <div className="flex justify-between">
              <span>No sauce</span>
              <span className="tally">×1</span>
            </div>
          </div>
        </Collapse>
      </Line>
      <Line name="Crispy Pata" qty={1} />
      <Collapse on={step >= 3}>
        <Line name="Gyoza" qty={2} wash={!still && step === 3} />
      </Collapse>
      <Collapse on={step >= 4}>
        <Line name="Iced Tea" qty={4} wash={!still && step === 4} />
      </Collapse>
    </ul>
  );
}

/** Hero: a round fills itself as the table calls out dishes, counts merge, then the waiter's stamp lands. Loops. */
export function HeroScene() {
  const { ref, step } = useScene<HTMLElement>(HERO_TIMELINE, { loop: true });
  const katsu = step >= 2 ? 3 : step >= 1 ? 2 : 1;
  const total = katsu + 1 + (step >= 3 ? 2 : 0) + (step >= 4 ? 4 : 0);
  return (
    <figure ref={ref} aria-hidden className="relative mx-auto w-full max-w-sm select-none">
      <div className="absolute inset-x-0 -top-3 z-10 flex h-7 justify-center">
        {step === 1 ? <Pill key="rafa" who="Rafa" text="added Chicken Katsu" /> : null}
        {step === 3 ? <Pill key="jd" who="JD" text="added Gyoza ×2" /> : null}
      </div>
      <div className="ticket rotate-[1.5deg] px-6">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-sm tracking-[0.14em] text-tomato-ink uppercase">Round 1</span>
          <span className="text-sm text-ink-soft">Table of 6</span>
        </div>
        {/* The full list, invisible, holds the ticket at its final height; the live list grows inside it and the
            spare room sits at the bottom, like space left on the pad. */}
        <div className="grid *:[grid-area:1/1]">
          <div className="invisible">
            <HeroLines step={HERO_LAST} still />
          </div>
          <HeroLines step={step} />
        </div>
        <div className="tear mt-3 flex items-baseline justify-between pt-3">
          <span className="text-ink-soft">Total</span>
          <span className="tally text-xl">
            <Ticker value={total} /> items
          </span>
        </div>
      </div>
      {step >= HERO_LAST ? <Stamp key="stamp" animate className="absolute top-[44%] left-[36%] text-lg" /> : null}
      <figcaption className="mt-4 text-center text-sm text-ink-soft">Sample order</figcaption>
    </figure>
  );
}

const QR_SIZE = 21;
/** A QR-looking picture (not a real code): the three corner finder squares plus a fixed scatter of modules. */
const QR_MODULES = (() => {
  const finder = (x: number, y: number) =>
    [[0, 0], [QR_SIZE - 7, 0], [0, QR_SIZE - 7]].some(([fx, fy]) => {
      const dx = x - fx;
      const dy = y - fy;
      if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
      return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    });
  const nearFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > QR_SIZE - 9 && y < 8) || (x < 8 && y > QR_SIZE - 9);
  const cells: [number, number][] = [];
  for (let y = 0; y < QR_SIZE; y++) {
    for (let x = 0; x < QR_SIZE; x++) {
      if (finder(x, y) || (!nearFinder(x, y) && (x * 7 + y * 13 + x * y) % 5 < 2)) cells.push([x, y]);
    }
  }
  return cells;
})();

/** Step 1: start, then the table joins by QR or code. */
export function InviteScene() {
  const { ref, step } = useScene<HTMLDivElement>([700, 700, 700, 900]);
  const joined = ["Rafa", "JD", "Ana"].slice(0, step);
  return (
    <div ref={ref} aria-hidden className="select-none">
      <Phone>
        <div className="rounded-2xl bg-ticket px-4 pt-4 pb-4 shadow-ticket">
          <p className="font-display text-lg">Invite the table</p>
          <svg viewBox={`-1 -1 ${QR_SIZE + 2} ${QR_SIZE + 2}`} className="mx-auto mt-3 size-28 rounded-xl bg-white ring-[1.5px] ring-rule">
            {QR_MODULES.map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#262b45" />
            ))}
          </svg>
          <p className="tally mt-3 text-center text-xl tracking-[0.25em]">KBJZVD</p>
          <div className="mt-3 flex min-h-8 flex-wrap justify-center gap-1.5">
            {joined.map((name) => (
              <span key={name} className="fade-in inline-flex items-center gap-1 rounded-full bg-ok-wash px-2.5 py-1 text-xs font-semibold text-ok">
                <UserPlus className="size-3.5" />
                {name} joined
              </span>
            ))}
          </div>
        </div>
      </Phone>
    </div>
  );
}

/** Step 2: someone types a dish, taps Add, and the same dish merges into one count. */
export function AddScene() {
  const { ref, step } = useScene<HTMLDivElement>([600, 500, 500, 600, 900]);
  const typed = ["", "Gy", "Gyoza", "Gyoza", ""][step];
  const gyoza = step >= 4 ? 3 : 1;
  return (
    <div ref={ref} aria-hidden className="select-none">
      <Phone>
        <div className="rounded-2xl bg-ticket px-4 py-3 shadow-ticket">
          <p className="font-mono text-xs tracking-[0.14em] text-tomato-ink uppercase">Round 1</p>
          <ul className="mt-1 text-base">
            <Line name="Gyoza" qty={gyoza} wash={step >= 4}>
              {step >= 4 ? <span className="arrival-tag absolute -top-1 right-12 rounded-full bg-saffron px-2 py-0.5 font-sans text-[0.65rem] font-semibold text-ink">+2 · JD</span> : null}
            </Line>
            <Line name="Sisig" qty={1} />
          </ul>
        </div>
        <div className="mt-3 rounded-[1.2rem] bg-ticket p-2 shadow-ticket ring-[1.5px] ring-rule">
          <div className="rounded-lg bg-paper px-3 pt-1 pb-1">
            <p className="text-[0.65rem] font-semibold text-ink-soft">Dish</p>
            <p className="h-6 text-base">
              {typed}
              {step >= 1 && step <= 3 ? <span className="ml-px inline-block h-4 w-px animate-pulse bg-ink align-middle" /> : null}
              {typed ? null : <span className="text-ink-soft">e.g. Chicken Katsu</span>}
            </p>
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-sm">
            <span className="inline-flex flex-1 items-center gap-1 px-2 text-ink-soft">
              <UserRound className="size-3.5" />
              For <span className="font-semibold text-ink">Me</span>
            </span>
            <span className="tally px-2 text-lg text-tomato-ink">{step >= 2 && step < 4 ? 2 : 1}</span>
            <span className={cn("inline-flex items-center gap-0.5 rounded-full bg-tomato py-1.5 pr-3 pl-2 font-semibold text-on-tomato transition-transform duration-100", step === 3 && "scale-95")}>
              <Plus className="size-4" />
              Add
            </span>
          </div>
        </div>
      </Phone>
    </div>
  );
}

/** Step 3: one big-number ticket for the waiter, then the host marks it confirmed. */
export function WaiterScene() {
  const { ref, step } = useScene<HTMLDivElement>([900, 1200]);
  return (
    <div ref={ref} aria-hidden className="relative select-none">
      <Phone className="bg-ticket">
        <div className="px-2 pb-2">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-xl">Round 1</span>
            <span className="text-sm text-ink-soft">Mang Inasal</span>
          </div>
          <ul className="mt-2 divide-y-[1.5px] divide-dashed divide-rule">
            {(
              [
                ["Chicken Inasal", 4],
                ["Java Rice", 6],
                ["Halo-halo", 3],
              ] as const
            ).map(([name, qty]) => (
              <li key={name} className="flex items-baseline justify-between py-2">
                <span className="text-lg">{name}</span>
                <span className="tally text-4xl text-tomato-ink">{qty}</span>
              </li>
            ))}
          </ul>
          <div className="tear mt-1 flex items-baseline justify-between pt-2 text-ink-soft">
            <span>Total</span>
            <span className="tally text-xl text-ink">13 items</span>
          </div>
        </div>
      </Phone>
      {step >= 1 ? <Stamp key="stamp" animate className="absolute top-[42%] left-[30%] text-base" /> : null}
    </div>
  );
}

const PEOPLE = [
  { name: "Kovie", note: null, lines: [["Chicken Inasal", 1], ["Java Rice", 2]] },
  { name: "Rafa", note: null, lines: [["Sisig", 1]] },
  { name: "Barkada", note: "shared by JD, Ana", lines: [["Pancit Canton", 1]] },
] as const;

/** Step 4: who ordered what, ready to copy into the group chat or save as a picture. */
export function SummaryScene() {
  const { ref, step } = useScene<HTMLDivElement>([500, 500, 500, 700, 900]);
  return (
    <div ref={ref} aria-hidden className="select-none">
      <Phone>
        <div className="flex items-center gap-2 px-1">
          <LogoMark className="size-6" />
          <p className="font-display text-lg">Who ordered what</p>
        </div>
        <div className="mt-2 rounded-2xl bg-ticket px-4 py-2 shadow-ticket">
          {PEOPLE.map((p, i) => (
            <Reveal key={p.name} on={step >= i} className="border-b-[1.5px] border-dashed border-rule py-2 last:border-0">
              <p className="text-base">
                {p.name}
                {p.note ? <span className="ml-1 text-xs text-ink-soft">· {p.note}</span> : null}
              </p>
              {p.lines.map(([dish, qty]) => (
                <div key={dish} className="flex justify-between pl-2 text-sm text-ink-soft">
                  <span>{dish}</span>
                  <span className="tally text-tomato-ink">×{qty}</span>
                </div>
              ))}
            </Reveal>
          ))}
        </div>
        <Reveal on={step >= 3} className="mt-2 grid grid-cols-2 gap-1.5 text-sm font-semibold">
          <span className="inline-flex items-center justify-center gap-1 rounded-full bg-tomato py-2 text-on-tomato">
            {step >= 4 ? <Check className="size-4" /> : <Copy className="size-4" />}
            {step >= 4 ? "Copied" : "Copy text"}
          </span>
          <span className="inline-flex items-center justify-center gap-1 rounded-full py-2 ring-[1.5px] ring-input">
            <ImageDown className="size-4" />
            Save image
          </span>
        </Reveal>
      </Phone>
    </div>
  );
}
