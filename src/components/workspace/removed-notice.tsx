import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";

/** What a guest sees after the host removed them: why (if the host said), and the way back in while the order is open. */
export function RemovedNotice({ reason, inviteCode }: { reason: string | null; inviteCode: string | null }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-10">
      <div className="ticket px-6 text-center">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-4 text-3xl">You&rsquo;re no longer in this order</h1>
        <p className="mt-2 text-ink-soft">The host removed you, and your dishes in the open round came off the ticket.</p>
        {reason ? (
          <figure className="mt-4 rounded-2xl bg-paper px-4 py-3 text-left" data-ph-mask="">
            <figcaption className="text-xs font-semibold tracking-wide text-ink-soft uppercase">The host said</figcaption>
            <blockquote className="mt-1 text-lg break-words">&ldquo;{reason}&rdquo;</blockquote>
          </figure>
        ) : null}
        <div className="mt-6 grid gap-2">
          {inviteCode ? (
            <Link href={`/i/${inviteCode}`} className={buttonVariants({ variant: "primary" })}>
              Join again
            </Link>
          ) : null}
          <Link href="/" className={buttonVariants({ variant: inviteCode ? "ghost" : "primary" })}>
            Go to Salo home
          </Link>
        </div>
      </div>
    </main>
  );
}
