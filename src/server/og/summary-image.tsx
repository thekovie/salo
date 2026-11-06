import { ImageResponse } from "next/og";
import { BRAND_HEX as C } from "@/lib/site";
import { itemsLabel, roundsLabel, type OrderSummary } from "@/lib/summary";
import { fonts, Mark } from "./render";

const WIDTH = 1080;
const PAD = 64;
const HEADER = 300;
const FOOTER = 190;
const SECTION_HEAD = 62;
const SECTION_GAP = 30;
const LINE = 50;
/** Taller than this and a phone gallery shows a sliver; the text copy covers big tables. */
export const MAX_SUMMARY_HEIGHT = 8000;

export function summaryHeight(summary: OrderSummary): number {
  const body = summary.sections.reduce((h, s) => h + SECTION_HEAD + s.lines.length * LINE + SECTION_GAP, 0);
  return HEADER + body + (summary.unconfirmedRound ? 70 : 0) + FOOTER;
}

/** "Who ordered what" as a tall ticket on Salo paper, for saving to the gallery and settling up later. */
export async function renderSummary(summary: OrderSummary, dateLabel: string): Promise<ImageResponse> {
  const height = summaryHeight(summary);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.tomato, padding: 40, fontFamily: "Nunito Sans" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, background: C.ticket, borderRadius: 32, padding: `48px ${PAD}px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Mark size={48} />
            <span style={{ fontFamily: "Fredoka", fontSize: 38, color: C.ink }}>salo</span>
          </div>
          <span style={{ fontFamily: "Fredoka", fontSize: 60, lineHeight: 1.1, color: C.ink, marginTop: 28 }}>{summary.title}</span>
          <span style={{ fontFamily: "DM Mono", fontSize: 26, color: C.tomato, letterSpacing: 2, textTransform: "uppercase", marginTop: 10 }}>
            {`Who ordered what · ${roundsLabel(summary.rounds)} · ${dateLabel}`}
          </span>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30, borderTop: `3px dashed ${C.inkSoft}` }}>
            {summary.sections.map((s) => (
              <div key={`${s.title}:${s.note}`} style={{ display: "flex", flexDirection: "column", paddingTop: 22, paddingBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 14, flex: 1 }}>
                    <span style={{ fontFamily: "Fredoka", fontSize: 38, color: C.ink }}>{s.title}</span>
                    {s.note ? <span style={{ fontSize: 24, color: C.inkSoft }}>{s.note}</span> : null}
                  </div>
                  <span style={{ fontFamily: "DM Mono", fontSize: 26, color: C.inkSoft }}>{itemsLabel(s.items)}</span>
                </div>
                {s.lines.map((line) => (
                  <div key={line.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: LINE, fontSize: 30, color: C.ink, paddingLeft: 18 }}>
                    <span style={{ flex: 1 }}>{line.label}</span>
                    <span style={{ fontFamily: "DM Mono", fontSize: 32, color: C.tomato }}>×{line.quantity}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {summary.unconfirmedRound ? (
            <span style={{ fontSize: 24, color: C.inkSoft, marginTop: 24 }}>{`Round ${summary.unconfirmedRound} was never confirmed with the waiter (not included).`}</span>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "auto", paddingTop: 24, borderTop: `3px dashed ${C.inkSoft}` }}>
            <span style={{ fontSize: 26, color: C.inkSoft }}>No prices included · Made with Salo</span>
            <span style={{ fontFamily: "DM Mono", fontSize: 34, color: C.ink }}>{`Total ${itemsLabel(summary.total)}`}</span>
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height, fonts: await fonts() },
  );
}
