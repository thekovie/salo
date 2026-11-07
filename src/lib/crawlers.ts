/**
 * Meta's link-preview crawlers (Messenger, Facebook, Instagram, WhatsApp previews fetched by Meta). Meta's Sharing
 * Debugger treats a `noindex`/`nofollow` signal on an invite page as a robots block and shows no card (403), so these
 * crawlers get the invite page without it. Search engines still get noindex.
 */
export const META_CRAWLER_PATTERN = "facebookexternalhit|Facebot|meta-externalagent";
const META_CRAWLER = new RegExp(META_CRAWLER_PATTERN, "i");

export function isMetaCrawler(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && META_CRAWLER.test(userAgent));
}
