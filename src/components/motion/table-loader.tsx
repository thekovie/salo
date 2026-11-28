import { MARK_DISH, MARK_PLATE_R, MARK_PLATES, MARK_RIM, MARK_TABLE } from "@/components/brand/mark";

/** The Shared Table mark set plate by plate (four plates clockwise, then the dish). Decorative; `still` (error state) leaves the table bare. */
export function TableLoader({ still = false }: { still?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="mx-auto size-28">
      <circle cx={MARK_TABLE.cx} cy={MARK_TABLE.cy} r={MARK_TABLE.r} className="fill-band" />
      {still ? null : (
        <>
          {MARK_PLATES.map((p, i) => (
            <g key={i} className="table-plate" style={{ "--i": i } as React.CSSProperties}>
              <circle cx={p.cx} cy={p.cy} r={MARK_PLATE_R} className="fill-on-band" />
              <circle cx={p.cx} cy={p.cy} r={MARK_RIM.r} fill="none" strokeWidth={MARK_RIM.width} className="stroke-band/40" />
            </g>
          ))}
          <g className="table-plate" style={{ "--i": MARK_PLATES.length } as React.CSSProperties}>
            <circle cx={MARK_DISH.cx} cy={MARK_DISH.cy} r={MARK_DISH.r} className="fill-on-band" />
          </g>
        </>
      )}
    </svg>
  );
}
