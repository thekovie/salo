import { INVITE_DESCRIPTION, inviteTitle } from "@/lib/invite";
import { OG_SIZE, renderPreview } from "@/server/og/render";
import { cachedImage } from "@/server/og/cache";
import { lookupInvite } from "@/server/sessions/invite-lookup";

export const alt = "Invitation to a table order on Salo";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** The card shown when an invite link is pasted into a chat: what the link is for, never dishes or names. */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const lookup = await lookupInvite((await params).code);
  if (lookup.kind !== "found" || lookup.invite.status === "CLOSED") {
    return cachedImage(
      "invite:ended",
      () => renderPreview({ title: "This order has ended", subtitle: "Start your own table order on Salo. No app, no sign-up.", pill: "Start an order" }),
      "public, max-age=3600",
    );
  }
  // Drawn once per order name (the card shows nothing else); a renamed order gets a new picture.
  const title = inviteTitle(lookup.invite.title);
  return cachedImage(`invite:${title}`, () => renderPreview({ title, subtitle: INVITE_DESCRIPTION, pill: "Add your order" }), "public, max-age=300");
}
