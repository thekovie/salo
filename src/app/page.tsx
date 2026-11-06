import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/logo";
import { JoinForm } from "@/components/landing/join-form";
import { ResumeList } from "@/components/landing/resume-list";
import { AddScene, HeroScene, InviteScene, SummaryScene, WaiterScene } from "@/components/landing/scenes";
import { StartForm } from "@/components/landing/start-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { SITE } from "@/lib/site";
import { listResumable } from "@/server/sessions/resume";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} · ${SITE.tagline}` },
  alternates: { canonical: "/" },
  openGraph: { title: `${SITE.name} · ${SITE.tagline}`, url: "/" },
};

const STEPS = [
  {
    title: "Start, then invite the table",
    body: "One tap, no sign-up. Order for everyone yourself, or show the QR code (or read out the six-letter code) so friends add their own dishes from their phones.",
    Scene: InviteScene,
  },
  {
    title: "Everyone adds their own",
    body: "Type a dish, tap Add. Same dishes merge into one count, “No sauce” and “Large” keep their own lines, and every phone sees each change as it happens.",
    Scene: AddScene,
  },
  {
    title: "Hand the waiter one ticket",
    body: "Big, clear numbers to read out or show. The host marks it confirmed; add-ons go on a fresh round and fixes are listed apart, so nothing is ordered twice.",
    Scene: WaiterScene,
  },
  {
    title: "Settle up later",
    body: "When the meal is done, “Who ordered what” lists each person’s, each group’s and the table’s dishes. Copy it into the group chat or save it as a picture.",
    Scene: SummaryScene,
  },
] as const;

const WHY = [
  ["No app, no sign-up", "Opens in the browser on any phone."],
  ["Live on every phone", "Changes show up for the whole table."],
  ["Rounds and fixes", "Add-ons and corrections without a recount."],
  ["Gone after the meal", "Orders delete themselves a week later."],
] as const;

export default async function Home() {
  const resumable = await listResumable();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-10 sm:px-8">
      <header className="flex items-center justify-between py-2">
        <Wordmark className="text-lg text-ink" />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 flex-col">
        <section aria-labelledby="hero" className="grid items-center gap-12 py-10 sm:py-16 md:grid-cols-[1.1fr_1fr]">
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
              <ResumeList items={resumable} />
              <JoinForm />
            </div>
          </div>
          <HeroScene />
        </section>

        <section aria-labelledby="how" id="how-it-works" className="scroll-mt-6 border-t-[1.5px] border-dashed border-rule py-14">
          <h2 id="how" className="text-3xl sm:text-4xl">How it works</h2>
          <ol className="mt-10 space-y-16 sm:space-y-20">
            {STEPS.map(({ title, body, Scene }, index) => (
              <li key={title} className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
                <div className={index % 2 === 1 ? "md:order-2" : undefined}>
                  <span className="tally flex size-10 items-center justify-center rounded-full bg-saffron-wash text-lg text-saffron-ink" aria-hidden>
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-2xl sm:text-3xl">{title}</h3>
                  <p className="mt-2 max-w-md text-lg text-ink-soft">{body}</p>
                </div>
                <Scene />
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="why" className="border-t-[1.5px] border-dashed border-rule py-12">
          <h2 id="why" className="sr-only">
            Why Salo
          </h2>
          <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {WHY.map(([term, detail]) => (
              <div key={term}>
                <dt className="font-display text-xl">{term}</dt>
                <dd className="mt-1 text-ink-soft">{detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="cta" className="ticket my-8 flex flex-col items-start gap-4 px-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <h2 id="cta" className="text-2xl sm:text-3xl">
              Kain na? Start the order.
            </h2>
            <p className="mt-1 text-ink-soft">Takes a second. Nothing to install.</p>
          </div>
          <StartForm label="Start your table’s order" />
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t-[1.5px] border-dashed border-rule pt-6 text-sm text-ink-soft">
        <span>No accounts, no menus to set up. Orders delete themselves a week after the meal.</span>
        <a href="#how-it-works" className="font-semibold text-ink underline-offset-4 hover:underline">
          How it works
        </a>
      </footer>
    </div>
  );
}
