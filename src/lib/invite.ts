/** The link people share, and the sentence that goes with it so the message explains itself even without a preview. */
export function inviteUrl(appUrl: string, joinCode: string): string {
  return new URL(`/i/${joinCode}`, appUrl).toString();
}

export function inviteMessage(title: string | null, url: string): string {
  return `Join our order${title ? ` at ${title}` : ""} on Salo: ${url}`;
}

export function inviteTitle(title: string | null): string {
  return title ? `Join the order at ${title}` : "Join the order";
}

export const INVITE_DESCRIPTION = "Tap to add your dishes to the table’s order. No app, no sign-up.";
