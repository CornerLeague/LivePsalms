export interface StoneProps {
  /** Accessible name, e.g. 'May 2026'. */
  label: string;
  /** Small deterministic tilt, degrees (−5..+5). */
  rotation?: number;
  /** One of --wm-stone-1/2/3. */
  fillVar?: string;
  /** Arrival: unopened newest month shows the seal motif (Task 18). */
  sealed?: boolean;
  /** Opening ceremony: the seal reads broken (Task 16). */
  broken?: boolean;
}

export function Stone({ label, rotation = 0, fillVar = '--wm-stone-1', sealed = false, broken = false }: StoneProps) {
  return (
    <svg
      className="wm-stone"
      width="128"
      height="72"
      viewBox="0 0 128 72"
      role="img"
      aria-label={label}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      {/* No <title> here: aria-label above is already the accessible name, and the caller
          always pairs this with a visible caption (see WaymarksReflections/LockedPreview) —
          an SVG <title> would duplicate that text and collide with text queries in tests. */}
      {/* Equal dignity (decision 6): identical rx/ry for every stone, regardless of content. */}
      <ellipse cx="64" cy="36" rx="58" ry="30" fill={`var(${fillVar})`} stroke="var(--wm-stone-stroke)" strokeWidth="1" />
      {sealed && !broken && (
        <g>
          <circle className="wm-stone__seal" cx="64" cy="36" r="9" fill="none" stroke="var(--wm-gold)" strokeWidth="1" />
          <circle cx="64" cy="36" r="4.5" fill="var(--wm-gold)" />
        </g>
      )}
      {broken && <line x1="64" y1="26" x2="64" y2="46" stroke="var(--wm-gold)" strokeWidth="1" opacity="0.5" />}
    </svg>
  );
}
