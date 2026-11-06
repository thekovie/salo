import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_HEX as C } from "@/lib/site";

export const OG_SIZE = { width: 1200, height: 630 } as const;

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

let fontCache: ReturnType<typeof loadFonts> | undefined;
/** Read once per process: previews are fetched by crawlers, so every request must stay cheap. */
export const fonts = () => (fontCache ??= loadFonts());

async function loadFonts() {
  const load = (file: string) => readFile(path.join(FONT_DIR, file));
  const [display, body, bodyBold, mono] = await Promise.all([
    load("fredoka-latin-500-normal.woff"),
    load("nunito-sans-latin-400-normal.woff"),
    load("nunito-sans-latin-600-normal.woff"),
    load("dm-mono-latin-500-normal.woff"),
  ]);
  return [
    { name: "Fredoka", data: display, weight: 500 as const, style: "normal" as const },
    { name: "Nunito Sans", data: body, weight: 400 as const, style: "normal" as const },
    { name: "Nunito Sans", data: bodyBold, weight: 600 as const, style: "normal" as const },
    { name: "DM Mono", data: mono, weight: 500 as const, style: "normal" as const },
  ];
}

export function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="25" cy="23" r="20" fill={C.tomato} />
      <path d="M6.5 44.5 9.6 31.5 18.2 38.6Z" fill={C.tomato} />
      <circle cx="14.5" cy="23" r="4.6" fill={C.onTomato} />
      <circle cx="25" cy="23" r="4.6" fill={C.onTomato} />
      <circle cx="35.5" cy="23" r="4.6" fill={C.onTomato} />
    </svg>
  );
}

export interface PreviewCard {
  /** Big line on the ticket. */
  title: string;
  /** One sentence under it. */
  subtitle: string;
  /** Small label at the top of the ticket, e.g. "Round 1". */
  stub?: string;
  /** Call-to-action pill. */
  pill?: string;
  /** Sample ticket lines drawn on the right (landing only; never real orders). */
  lines?: readonly { qty: number; name: string }[];
}

/**
 * The link-preview card shared by every page: paper background, logo, and a perforated order ticket. It never
 * receives dishes or names from a real session: previews are fetched and cached by third-party crawlers.
 */
export async function renderPreview(card: PreviewCard): Promise<ImageResponse> {
  const perforation = Array.from({ length: 40 }, (_, i) => i);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.tomato, padding: 56, fontFamily: "Nunito Sans" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, background: C.paper, borderRadius: 36, padding: "48px 56px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Mark size={64} />
            <span style={{ fontFamily: "Fredoka", fontSize: 52, color: C.ink, letterSpacing: -1 }}>salo</span>
          </div>
          <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 48 }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 18 }}>
              {card.stub ? (
                <span style={{ fontFamily: "DM Mono", fontSize: 26, color: C.tomato, letterSpacing: 2, textTransform: "uppercase" }}>{card.stub}</span>
              ) : null}
              <span style={{ fontFamily: "Fredoka", fontSize: card.title.length > 28 ? 60 : 74, lineHeight: 1.05, color: C.ink, letterSpacing: -1.5 }}>{card.title}</span>
              <span style={{ fontSize: 30, lineHeight: 1.35, color: C.inkSoft, maxWidth: 620 }}>{card.subtitle}</span>
              {card.pill ? (
                <div style={{ display: "flex", marginTop: 10 }}>
                  <span style={{ background: C.tomato, color: C.onTomato, fontWeight: 600, fontSize: 28, padding: "14px 30px", borderRadius: 999 }}>{card.pill}</span>
                </div>
              ) : null}
            </div>
            {card.lines ? (
              <div style={{ display: "flex", flexDirection: "column", width: 340, background: C.ticket, borderRadius: 6, boxShadow: "0 12px 30px rgba(60,40,20,0.18)", padding: "26px 28px", gap: 14, transform: "rotate(2.5deg)" }}>
                <div style={{ display: "flex", gap: 6, marginTop: -34, marginBottom: 6 }}>
                  {perforation.slice(0, 18).map((i) => (
                    <div key={i} style={{ width: 12, height: 12, borderRadius: 999, background: C.paper }} />
                  ))}
                </div>
                {card.lines.map((line) => (
                  <div key={line.name} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 26, color: C.ink }}>
                    <span>{line.name}</span>
                    <span style={{ fontFamily: "DM Mono", fontSize: 34, color: C.tomato }}>×{line.qty}</span>
                  </div>
                ))}
                <div style={{ display: "flex", borderTop: `2px dashed ${C.inkSoft}`, paddingTop: 12, justifyContent: "space-between", fontSize: 22, color: C.inkSoft }}>
                  <span>Sample order</span>
                  <span style={{ fontFamily: "DM Mono" }}>{card.lines.reduce((sum, l) => sum + l.qty, 0)} items</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}
