import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MARK_DISH, MARK_PLATE_R, MARK_PLATES, MarkShapes, MARK_TABLE } from "@/components/brand/mark";
import { BRAND_HEX as C } from "@/lib/site";

const NS = "http://www.w3.org/2000/svg";
const svg = (viewBox: string, ...children: ReactNode[]) => renderToStaticMarkup(h("svg", { xmlns: NS, viewBox }, ...children)) + "\n";
const mark = (table: string, plate: string, rim: boolean) => h(MarkShapes, { table, plate, rim });

/** A full circle as two arcs. */
const disc = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** Primary logo: the in-app Wordmark proportions (mark 1.6em, text 1.35em, gap 0.5rem) at 1em = 30 units. */
function primary(ink: string, table: string, plate: string) {
  const em = 30;
  const markSize = 1.6 * em;
  const gap = 0.5 * 16 * (em / 16);
  const height = markSize;
  const width = markSize + gap + 1.8 * 1.35 * em;
  return renderToStaticMarkup(
    h(
      "svg",
      { xmlns: NS, viewBox: `0 0 ${Math.round(width)} ${height}` },
      h("svg", { width: markSize, height: markSize, viewBox: "0 0 48 48" }, mark(table, plate, true)),
      h("text", { x: markSize + gap, y: height / 2, fontFamily: "Fredoka, 'Nunito Sans', system-ui, sans-serif", fontSize: 1.35 * em, fontWeight: 500, letterSpacing: "-0.025em", dominantBaseline: "central", fill: ink }, "salo"),
    ),
  ).replace(/^<svg[^>]*>/, (open) => `${open}<!-- Live text: needs Fredoka Medium, see assets/fonts/fredoka-latin-500-normal.woff -->`) + "\n";
}

const files: Record<string, string> = {
  "src/app/icon.svg": svg("0 0 48 48", mark(C.tomato, C.onTomato, false)),
  "assets/brand/mark.svg": svg("0 0 48 48", mark(C.tomato, C.onTomato, true)),
  "assets/brand/mark-dark.svg": svg("0 0 48 48", mark(C.darkTomato, C.darkOnTomato, true)),
  "assets/brand/mark-mono.svg": svg(
    "0 0 48 48",
    h("path", {
      fill: "currentColor",
      fillRule: "evenodd",
      d: [disc(MARK_TABLE.cx, MARK_TABLE.cy, MARK_TABLE.r), ...MARK_PLATES.map((p) => disc(p.cx, p.cy, MARK_PLATE_R)), disc(MARK_DISH.cx, MARK_DISH.cy, MARK_DISH.r)].join(""),
    }),
  ),
  "assets/brand/primary.svg": primary(C.ink, C.tomato, C.onTomato),
  "assets/brand/primary-dark.svg": primary(C.paper, C.darkTomato, C.darkOnTomato),
};

describe("brand assets", () => {
  for (const [file, content] of Object.entries(files)) {
    it(`${file} matches the shared mark geometry`, () => {
      const full = path.join(process.cwd(), file);
      if (process.env.UPDATE_BRAND) writeFileSync(full, content);
      expect(readFileSync(full, "utf8")).toBe(content);
    });
  }
});
