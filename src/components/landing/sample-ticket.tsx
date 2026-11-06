import { Stamp } from "@/components/ticket/stamp";

const LINES = [
  { name: "Chicken Katsu", qty: 3, variants: [{ name: "Regular", qty: 2 }, { name: "No sauce", qty: 1 }] },
  { name: "Gyoza", qty: 2 },
  { name: "Crispy Pata", qty: 1 },
  { name: "Iced Tea", qty: 4 },
] as const;

/** An illustrative ticket for the how-it-works section. Labelled as a sample; it is not anyone's order. */
export function SampleTicket() {
  const total = LINES.reduce((sum, line) => sum + line.qty, 0);
  return (
    <figure className="relative mx-auto w-full max-w-sm rotate-[1.5deg]">
      <div className="ticket px-6">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-sm tracking-[0.14em] text-tomato-ink uppercase">Round 1</span>
          <span className="text-sm text-ink-soft">Table of 6</span>
        </div>
        <ul className="mt-4 space-y-3">
          {LINES.map((line) => (
            <li key={line.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-lg">{line.name}</span>
                <span className="tally text-2xl text-tomato-ink">×{line.qty}</span>
              </div>
              {"variants" in line ? (
                <ul className="mt-1 space-y-0.5 border-l-[1.5px] border-rule pl-3 text-ink-soft">
                  {line.variants.map((v) => (
                    <li key={v.name} className="flex justify-between">
                      <span>{v.name}</span>
                      <span className="tally">×{v.qty}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="tear mt-5 flex items-baseline justify-between pt-3">
          <span className="text-ink-soft">Total</span>
          <span className="tally text-xl">{total} items</span>
        </div>
      </div>
      <Stamp className="absolute top-[46%] left-[38%] text-lg" />
      <figcaption className="mt-3 text-center text-sm text-ink-soft">Sample order</figcaption>
    </figure>
  );
}
