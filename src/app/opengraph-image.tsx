import { SITE } from "@/lib/site";
import { OG_SIZE, renderPreview } from "@/server/og/render";

export const alt = `${SITE.name}: ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderPreview({
    title: SITE.tagline,
    subtitle: "Everyone adds their dishes. Salo counts them. The waiter gets one clear ticket.",
    pill: "Start an order",
    lines: [
      { qty: 3, name: "Chicken Katsu" },
      { qty: 2, name: "Gyoza" },
      { qty: 1, name: "Crispy Pata" },
      { qty: 4, name: "Iced Tea" },
    ],
  });
}
