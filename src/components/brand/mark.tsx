/** Shared Table mark geometry (viewBox 0 0 48 48): one source for the app, the OG/icon renderers and the committed SVGs. */
export const MARK_TABLE = { cx: 24, cy: 24, r: 22 };
/** Plate centres, clockwise from the top. */
export const MARK_PLATES = [
  { cx: 24, cy: 11 },
  { cx: 37, cy: 24 },
  { cx: 24, cy: 37 },
  { cx: 11, cy: 24 },
];
export const MARK_PLATE_R = 5.6;
export const MARK_RIM = { r: 3.25, opacity: 0.45, width: 1.1 };
export const MARK_DISH = { cx: 24, cy: 24, r: 3.6 };

/**
 * The mark's circles. Pure and hook-free so satori (OG images) can take it as a plain call, `{MarkShapes(...)}`;
 * React DOM callers use `<MarkShapes/>`. `rim` is omitted for the favicon, where the rims fall below a pixel.
 */
export function MarkShapes({ table, plate, rim = false }: { table: string; plate: string; rim?: boolean }) {
  return (
    <>
      <circle cx={MARK_TABLE.cx} cy={MARK_TABLE.cy} r={MARK_TABLE.r} fill={table} />
      {MARK_PLATES.map((p) => (
        <g key={`${p.cx},${p.cy}`}>
          <circle cx={p.cx} cy={p.cy} r={MARK_PLATE_R} fill={plate} />
          {rim ? <circle cx={p.cx} cy={p.cy} r={MARK_RIM.r} fill="none" stroke={table} strokeOpacity={MARK_RIM.opacity} strokeWidth={MARK_RIM.width} /> : null}
        </g>
      ))}
      <circle cx={MARK_DISH.cx} cy={MARK_DISH.cy} r={MARK_DISH.r} fill={plate} />
    </>
  );
}
