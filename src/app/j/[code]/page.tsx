import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LogoMark } from "@/components/brand/logo";
import { JoinNameForm } from "@/components/join/join-name-form";
import { INVITE_DESCRIPTION, inviteTitle } from "@/lib/invite";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { findInvite } from "@/server/sessions/join";

type Props = { params: Promise<{ code: string }> };

/**
 * Link previews (Messenger, Viber, WhatsApp…) read this without cookies. They get the order's name and what the link
 * is for, never dishes or people. Joining needs a POST, so a preview fetch never creates a participant.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const invite = await findInvite(getDb(), (await params).code);
  const ended = !invite || invite.status === "CLOSED";
  const title = ended ? "This order has ended" : inviteTitle(invite.title);
  const description = ended ? "Start your own table order on Salo. No app, no sign-up." : INVITE_DESCRIPTION;
  return {
    title: { absolute: `${title} · Salo` },
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", siteName: "Salo" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const invite = await findInvite(getDb(), code);
  if (!invite) notFound();

  // Already part of this order on this phone: go straight in.
  const token = (await cookies()).get(credentialCookieName(invite.sessionId))?.value;
  if (await resolveActor(getDb(), invite.sessionId, token)) redirect(`/s/${invite.sessionId}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div className="ticket px-6">
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <span className="font-mono text-sm tracking-[0.14em] text-tomato-ink uppercase">Round {invite.roundNumber}</span>
        </div>
        {invite.status === "CLOSED" ? (
          <>
            <h1 className="mt-5 text-3xl">This order has ended</h1>
            <p className="mt-2 text-ink-soft">The host closed it. You can still start your own order for your table.</p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-3xl">{inviteTitle(invite.title)}</h1>
            <p className="mt-2 text-ink-soft">Add your dishes to the table&rsquo;s order. Everyone sees the same ticket, and the host gives it to the waiter.</p>
            <JoinNameForm sessionId={invite.sessionId} code={code} />
          </>
        )}
      </div>
      <p className="text-center text-sm text-ink-soft">No app or account. Your name is only shown to this table.</p>
    </main>
  );
}
