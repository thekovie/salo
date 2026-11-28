import { ImageResponse } from "next/og";
import { MarkShapes } from "@/components/brand/mark";
import { BRAND_HEX as C } from "@/lib/site";

/** Square app icon on a paper tile (iOS home screen, Android maskable: the mark sits inside the 80% safe zone). */
export function renderAppIcon(size: number, { maskable = false }: { maskable?: boolean } = {}): ImageResponse {
  const mark = Math.round(size * (maskable ? 0.58 : 0.72));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper }}>
        <svg width={mark} height={mark} viewBox="0 0 48 48">
          {MarkShapes({ table: C.tomato, plate: C.onTomato, rim: true })}
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
