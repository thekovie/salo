import { INVITE_DESCRIPTION, inviteTitle } from "@/lib/invite";
import { getDb } from "@/server/db/client";
import { OG_SIZE, renderPreview } from "@/server/og/render";
import { findInvite } from "@/server/sessions/join";

export const alt = "Invitation to a table order on Salo";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** The card shown when an invite link is pasted into a chat: what the link is for, never dishes or names. */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const invite = await findInvite(getDb(), (await params).code);
  if (!invite || invite.status === "CLOSED") {
    return renderPreview({ title: "This order has ended", subtitle: "Start your own table order on Salo. No app, no sign-up.", pill: "Start an order" });
  }
  return renderPreview({ stub: `Round ${invite.roundNumber}`, title: inviteTitle(invite.title), subtitle: INVITE_DESCRIPTION, pill: "Add your order" });
}
