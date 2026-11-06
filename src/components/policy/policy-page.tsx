import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { PolicyLinks } from "./policy-links";

export const POLICY_CONTACT = "salo@projects.thekovie.com";
export const POLICY_UPDATED = "November 6, 2026";

/** Shared frame for the privacy and cookie policies: a readable column on Salo paper. */
export function PolicyPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-10 sm:px-8">
      <header className="flex items-center justify-between py-2">
        <Link href="/" aria-label="Salo home">
          <Wordmark className="text-lg text-ink" />
        </Link>
        <PolicyLinks />
      </header>
      <main className="flex-1 py-10">
        <h1 className="text-4xl sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-ink-soft">Last updated {POLICY_UPDATED}</p>
        <p className="mt-6 max-w-prose text-lg text-ink-soft">{intro}</p>
        <div className="policy mt-10 max-w-prose space-y-8">{children}</div>
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t-[1.5px] border-dashed border-rule pt-6 text-sm text-ink-soft">
        <span>
          Questions? <a href={`mailto:${POLICY_CONTACT}`} className="font-semibold text-ink underline underline-offset-4">{POLICY_CONTACT}</a>
        </span>
        <Link href="/" className="font-semibold text-ink underline-offset-4 hover:underline">
          Back to Salo
        </Link>
      </footer>
    </div>
  );
}

/** One titled section of a policy. */
export function PolicySection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 leading-relaxed text-ink-soft [&_strong]:text-ink [&_a]:font-semibold [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
      <h2 id={id} className="text-2xl text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}
