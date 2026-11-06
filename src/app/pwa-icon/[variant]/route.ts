import { renderAppIcon } from "@/server/og/app-icon";
import { cachedImage } from "@/server/og/cache";

const VARIANTS: Record<string, { size: number; maskable: boolean }> = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-512": { size: 512, maskable: true },
};

export async function GET(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const name = (await params).variant;
  const variant = VARIANTS[name];
  if (!variant) return new Response("Not found", { status: 404 });
  return cachedImage(`icon:${name}`, () => renderAppIcon(variant.size, { maskable: variant.maskable }), "public, max-age=86400, immutable");
}
