const PLATES = [0, 1, 2, 3, 4, 5];

/** A top-down Salo table with six plates set round it. Decorative; `still` (error state) leaves the table bare. */
export function TableLoader({ still = false }: { still?: boolean }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden className="mx-auto size-28">
      <circle cx="60" cy="60" r="56" className="fill-band" />
      <circle cx="60" cy="60" r="34" fill="none" strokeWidth="1.5" className="stroke-on-band/30" />
      {still
        ? null
        : PLATES.map((i) => (
            <g key={i} transform={`rotate(${i * 60} 60 60)`}>
              <g className="table-plate" style={{ "--i": i } as React.CSSProperties}>
                <circle cx="60" cy="26" r="8" className="fill-on-band" />
                <circle cx="60" cy="26" r="4.5" fill="none" strokeWidth="1" className="stroke-band/40" />
              </g>
            </g>
          ))}
    </svg>
  );
}
