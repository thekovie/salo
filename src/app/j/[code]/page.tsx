import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LogoMark } from "@/components/brand/logo";
import { JoinNameForm } from "@/components/join/join-name-form";
import { PolicyLinks } from "@/components/policy/policy-links";
import { isMetaCrawler } from "@/lib/crawlers";
import { INVITE_DESCRIPTION, inviteTitle } from "@/lib/invite";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { lookupInvite } from "@/server/sessions/invite-lookup";
import { inviteActivity } from "@/server/sessions/join";

type Props = { params: Promise<{ code: string }> };

/**
 * Link previews (Messenger, Viber, WhatsApp…) read this without cookies. They get the order's name and what the link
 * is for, never dishes or people. Joining needs a POST, so a preview fetch never creates a participant.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const lookup = await lookupInvite(code);
  const invite = lookup.kind === "found" ? lookup.invite : null;
  const ended = !invite || invite.status === "CLOSED";
  const title = ended ? "This order has ended" : inviteTitle(invite.title);
  const description = ended ? "Start your own table order on Salo. No app, no sign-up." : INVITE_DESCRIPTION;
  return {
    title: { absolute: `${title} · Salo` },
    description,
    // Out of search engines, but not for Meta's preview crawlers, which read noindex as "blocked" and show no card.
    robots: isMetaCrawler((await headers()).get("user-agent")) ? undefined : { index: false, follow: false },
    // og:url names the invite itself, so a preview cached for this link is the card for this order.
    openGraph: { title, description, type: "website", siteName: "Salo", url: `/j/${encodeURIComponent(code)}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const lookup = await lookupInvite(code);
  if (lookup.kind === "limited") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
        <h1 className="text-3xl">Too many wrong codes</h1>
        <p className="text-ink-soft">Wait a while, then ask the host to show the QR code or send the link again.</p>
      </main>
    );
  }
  // Unknown and ended orders look the same to a stranger: neither confirms that a code was ever used.
  if (lookup.kind === "missing" || lookup.invite.status === "CLOSED") notFound();
  const invite = lookup.invite;
  const activity = await inviteActivity(getDb(), invite.sessionId);

  // Already part of this order on this phone: go straight in.
  const token = (await cookies()).get(credentialCookieName(invite.sessionId))?.value;
  if (await resolveActor(getDb(), invite.sessionId, token)) redirect(`/s/${invite.sessionId}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 pt-[max(env(safe-area-inset-top),2.5rem)] pb-10">
      <div className="ticket px-6">
        <LogoMark className="size-10" />
        <h1 className="mt-5 text-3xl" data-ph-mask="">
          {inviteTitle(invite.title)}
        </h1>
        <p className="mt-2 text-ink-soft">Add your dishes to the table&rsquo;s order. Everyone sees the same ticket, and the host gives it to the waiter.</p>
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-ok">
          <span className="size-2 rounded-full bg-ok" aria-hidden />
          Live · {activity.people} {activity.people === 1 ? "person" : "people"} · {activity.items} {activity.items === 1 ? "item" : "items"} so far
        </p>
        <JoinNameForm sessionId={invite.sessionId} code={code} />
      </div>
      <p className="text-center text-sm text-ink-soft">No app or account. Your name is only shown to this table.</p>
      <PolicyLinks className="justify-center" />
    </main>
  );
}
