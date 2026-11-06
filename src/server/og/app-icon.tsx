import { ImageResponse } from "next/og";
import { BRAND_HEX as C } from "@/lib/site";

/** Square app icon on a paper tile (iOS home screen, Android maskable: the mark sits inside the 80% safe zone). */
export function renderAppIcon(size: number, { maskable = false }: { maskable?: boolean } = {}): ImageResponse {
  const mark = Math.round(size * (maskable ? 0.58 : 0.72));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper }}>
        <svg width={mark} height={mark} viewBox="0 0 48 48">
          <circle cx="25" cy="23" r="20" fill={C.tomato} />
          <path d="M6.5 44.5 9.6 31.5 18.2 38.6Z" fill={C.tomato} />
          <circle cx="14.5" cy="23" r="4.6" fill={C.onTomato} />
          <circle cx="25" cy="23" r="4.6" fill={C.onTomato} />
          <circle cx="35.5" cy="23" r="4.6" fill={C.onTomato} />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
