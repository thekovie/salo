import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { BotCheck } from "@/components/landing/bot-check";
import { getEnv } from "@/env";

export const metadata: Metadata = { title: "Starting an order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** "Start an order" lands here: a quick bot check (Cloudflare Turnstile), then straight into the new order. */
export default function NewOrderPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-10">
      <div className="ticket px-6 text-center">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-4 text-3xl">One moment</h1>
        <p className="mt-2 text-ink-soft">A quick check that you&rsquo;re a person, then we&rsquo;ll open your order.</p>
        <BotCheck siteKey={getEnv().TURNSTILE_SITE_KEY} />
      </div>
      <Link href="/" className="text-center text-sm font-semibold text-ink underline-offset-4 hover:underline">
        Back to Salo
      </Link>
    </main>
  );
}
