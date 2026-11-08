"use client";

import { CircleCheck, UserRound, UsersRound, Wrench } from "lucide-react";
import { Line, Phone, Reveal } from "@/components/landing/scenes";
import { Ticker } from "@/components/motion/ticker";
import { useScene } from "@/hooks/use-scene";
import { cn } from "@/lib/utils";

/*
 * Small illustrated scenes for the setup guide, in the same style as the landing page's: pictures, not the app
 * (aria-hidden; the guide's text says what each shows), sample names, the app's own tokens for light and dark.
 */

const chip = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-[1.5px]";

/** Who it's for, then a price: pick a person, type ₱120, see the line subtotal before adding. */
export function ForPriceScene() {
  const { ref, step } = useScene<HTMLDivElement>([700, 700, 600, 600, 1200]);
  const who = step >= 1 ? "Rafa" : "Me";
  const price = ["", "", "1", "120", "120"][step];
  return (
    <div ref={ref} aria-hidden className="select-none">
      <Phone>
        <div className="rounded-2xl bg-ticket p-3 shadow-ticket">
          <p className="text-xs font-semibold text-ink-soft">Who&rsquo;s it for?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {["Me", "Rafa", "Whole table"].map((name) => (
              <span key={name} className={cn(chip, who === name ? "bg-ink text-paper ring-ink" : "ring-input")}>
                {name === "Whole table" ? <UsersRound className="size-3.5" /> : null}
                {name}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-ink-soft">Price each (₱) · optional</p>
          <p className="tally mt-1 h-8 rounded-lg bg-paper px-2.5 py-1 text-base ring-[1.5px] ring-input">{price || <span className="text-ink-soft">Optional</span>}</p>
          <Reveal on={step >= 4} className="tally mt-1.5 text-sm text-ink-soft">
            ₱120.00 × 2 = ₱240.00
          </Reveal>
        </div>
        <div className="mt-2 flex items-center gap-1 px-1 text-sm">
          <span className="inline-flex flex-1 items-center gap-1 text-ink-soft">
            <UserRound className="size-3.5" /> For <span className="font-semibold text-ink">{who}</span>
          </span>
          <span className="tally px-2 text-lg text-tomato-ink">2</span>
          <span className="rounded-full bg-tomato px-3 py-1.5 font-semibold text-on-tomato">Add</span>
        </div>
      </Phone>
    </div>
  );
}

/** By person: each card fills with that person's dishes; guests show Ready or Still choosing. */
export function PeopleScene() {
  const { ref, step } = useScene<HTMLDivElement>([500, 600, 600, 1100]);
  const people = [
    { name: "Kovie · host", dishes: "Chicken Inasal ×1", ready: null },
    { name: "Rafa", dishes: "Sisig ×1 · Halo-halo ×1", ready: step >= 3 },
    { name: "Ana", dishes: "Pancit ×1", ready: false },
  ];
  return (
    <div ref={ref} aria-hidden className="select-none">
      <Phone>
        <div className="flex gap-3 border-b-[1.5px] border-rule px-1 pb-1.5 text-sm font-semibold">
          <span className="text-ink-soft">Order</span>
          <span className="border-b-[3px] border-tomato pb-1">People 3</span>
          <span className="text-ink-soft">Groups</span>
        </div>
        <div className="mt-2 space-y-2">
          {people.map((p, i) => (
            <Reveal key={p.name} on={step >= i} className="rounded-2xl bg-ticket px-3 py-2 shadow-ticket">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{p.name}</p>
                {p.ready === null ? null : (
                  <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-semibold", p.ready ? "bg-ok-wash text-ok" : "bg-paper text-ink-soft")}>{p.ready ? "Ready" : "Still choosing"}</span>
                )}
              </div>
              <p className="text-xs text-ink-soft">{p.dishes}</p>
            </Reveal>
          ))}
        </div>
      </Phone>
    </div>
  );
}

/** Round 2 on its own carbon copy, with a fix to round 1 listed apart. */
export function RoundsScene() {
  const { ref, step } = useScene<HTMLDivElement>([700, 800, 1200]);
  return (
    <div ref={ref} aria-hidden className="select-none">
      <Phone>
        <div className="rounded-2xl bg-ticket px-4 py-3 shadow-ticket ring-2 ring-saffron/50">
          <p className="font-mono text-xs tracking-[0.14em] text-tomato-ink uppercase">Round 2</p>
          <ul className="mt-1 text-base">
            <Line name="Halo-halo" qty={step >= 1 ? 3 : 2} wash={step >= 1} />
          </ul>
          <Reveal on={step >= 2} className="mt-2 rounded-xl bg-saffron-wash px-2.5 py-1.5 text-xs text-ink">
            <p className="inline-flex items-center gap-1 font-semibold">
              <Wrench className="size-3.5" /> Corrections
            </p>
            <p>Cancel 1 × Sisig from round 1</p>
          </Reveal>
        </div>
      </Phone>
    </div>
  );
}

/** KKB: a price goes in, the service charge splits by food, your total lands. */
export function KkbScene() {
  const { ref, step } = useScene<HTMLDivElement>([700, 700, 900, 1300]);
  const tea = step >= 1;
  const charged = step >= 2;
  return (
    <div ref={ref} aria-hidden className="select-none">
      <Phone>
        <div className="rounded-2xl bg-ticket px-4 py-3 shadow-ticket ring-2 ring-tomato/40">
          <div className="flex items-baseline justify-between">
            <p className="text-base">
              Rafa <span className="text-xs text-ink-soft">· you</span>
            </p>
            <Ticker value={charged ? 462 : tea ? 420 : 360} prefix="₱" className="tally text-base" />
          </div>
          <div className="mt-1 space-y-0.5 text-sm text-ink-soft">
            <div className="flex justify-between">
              <span>Sisig ×1</span>
              <span className="tally">₱360</span>
            </div>
            <div className="flex justify-between">
              <span>Iced Tea ×1</span>
              {tea ? <span className="tally fade-in">₱60</span> : <span className="rounded-full border-[1.5px] border-dashed border-input px-2 text-xs">Add price</span>}
            </div>
          </div>
          <Reveal on={charged} className="mt-2 space-y-0.5 border-t-[1.5px] border-dashed border-rule pt-2 text-sm">
            <div className="flex justify-between text-ink-soft">
              <span>Service charge</span>
              <span className="tally">₱42</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total with service charge</span>
              <span className="tally">₱462</span>
            </div>
          </Reveal>
        </div>
        <Reveal on={step >= 3} className="mt-2 flex items-center gap-1.5 rounded-xl bg-ok-wash px-3 py-1.5 text-xs text-ink">
          <CircleCheck className="size-3.5 text-ok" /> Split by how much each person ordered
        </Reveal>
      </Phone>
    </div>
  );
}
