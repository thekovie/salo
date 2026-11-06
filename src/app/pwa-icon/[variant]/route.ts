import { renderAppIcon } from "@/server/og/app-icon";

const VARIANTS: Record<string, { size: number; maskable: boolean }> = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-512": { size: 512, maskable: true },
};

export async function GET(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const variant = VARIANTS[(await params).variant];
  if (!variant) return new Response("Not found", { status: 404 });
  const image = renderAppIcon(variant.size, { maskable: variant.maskable });
  image.headers.set("Cache-Control", "public, max-age=86400, immutable");
  return image;
}
