import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/logo";
import { JoinForm } from "@/components/landing/join-form";
import { SampleTicket } from "@/components/landing/sample-ticket";
import { StartForm } from "@/components/landing/start-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} · ${SITE.tagline}` },
  alternates: { canonical: "/" },
  openGraph: { title: `${SITE.name} · ${SITE.tagline}`, url: "/" },
};

const STEPS = [
  { title: "Start an order", body: "One tap, no sign-up. Type dishes as people call them out, or share the QR so everyone adds their own." },
  { title: "Salo does the counting", body: "Same dishes merge into one count. “No sauce” and “Large” stay on their own lines, and every change shows up live." },
  { title: "Hand the waiter one ticket", body: "Big, clear quantities to read out or show. Add-ons later go on a fresh round, so nothing gets ordered twice." },
] as const;

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-10 sm:px-8">
      <header className="flex items-center justify-between py-2">
        <Wordmark className="text-lg text-ink" />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 flex-col">
        <section aria-labelledby="hero" className="grid items-center gap-10 py-10 sm:py-16 md:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 id="hero" className="text-[2.6rem] leading-[1.02] sm:text-6xl">
              One table.
              <br />
              <span className="text-tomato-ink">Everyone&rsquo;s order.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg text-ink-soft">
              Collect the whole table&rsquo;s order on one phone or everyone&rsquo;s, and give the waiter a ticket nobody has to recount.
            </p>
            <div className="mt-8 flex flex-col gap-6">
              <StartForm />
              <JoinForm />
            </div>
          </div>
          <SampleTicket />
        </section>

        <section aria-labelledby="how" className="border-t-[1.5px] border-dashed border-rule py-12">
          <h2 id="how" className="text-3xl">How it works</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="tally flex size-10 shrink-0 items-center justify-center rounded-full bg-saffron-wash text-lg text-saffron-ink" aria-hidden>
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-xl">{step.title}</h3>
                  <p className="mt-1.5 text-ink-soft">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t-[1.5px] border-dashed border-rule pt-6 text-sm text-ink-soft">
        No accounts, no menus to set up. Orders delete themselves a week after the meal. Kain na!
      </footer>
    </div>
  );
}
