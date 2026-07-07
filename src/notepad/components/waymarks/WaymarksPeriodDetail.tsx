import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import './waymarks.css';
import { Stone } from './Stone';
import { ReflectionLetter } from './ReflectionLetter';
import { MarkerPath } from './MarkerPath';
import { useReflections } from '../../hooks/useReflections';
import { usePrefersReducedMotion } from '../../../hooks/use-prefers-reduced-motion'; // seam (item 10) — real path, not the brief's stale one
import type { LamplightAdapter } from '../../storage/lamplight-adapter';

export interface WaymarksPeriodDetailProps {
  adapter: LamplightAdapter;
  userId: string;
  /** Accepted for connector parity; the detail body never gates on it (decision 1). */
  canAccess: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}
function rotationFor(periodKey: string): number {
  let h = 0;
  for (const ch of periodKey) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return (h % 11) - 5;
}

// "Opened" has no DB column (decision 4) — persist it in localStorage so the seal
// ceremony plays exactly once per stone.
const openedKey = (periodKey: string) => `wm-opened:${periodKey}`;
function hasBeenOpened(periodKey: string): boolean {
  try { return localStorage.getItem(openedKey(periodKey)) === '1'; } catch { return false; }
}
function markOpened(periodKey: string): void {
  try { localStorage.setItem(openedKey(periodKey), '1'); } catch { /* private mode — ceremony just replays */ }
}

export function WaymarksPeriodDetail({ adapter, userId }: WaymarksPeriodDetailProps) {
  const { periodKey = '' } = useParams();
  const reduce = usePrefersReducedMotion();
  const { state, retry } = useReflections({ adapter, userId, periodKey });
  const [opened, setOpened] = useState(() => hasBeenOpened(periodKey));
  const [annotation, setAnnotation] = useState<string | null>(null);

  // Load the satellite annotation state (§17 aside) once we know the period.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await adapter.getReflectionState(userId, 'reflection_recap', periodKey);
      if (alive) setAnnotation(s?.annotation ?? null); // getReflectionState → ReflectionState | null
    })();
    return () => { alive = false; };
  }, [adapter, userId, periodKey]);

  const back = (
    <Link to="/notebook/reflections" className="wm-back wm-label">← The Path</Link>
  );

  // Non-ready phases (§13.6 copy). retrieving/generating/refining stream a quiet caption.
  if (state.phase !== 'ready') {
    let body: ReactNode;
    if (state.phase === 'empty') {
      body = <p className="wm-caption">Nothing was written here.</p>;
    } else if (state.phase === 'unavailable' || state.phase === 'error') {
      body = (
        <div>
          <p className="wm-caption">This one isn't ready yet. Try again.</p>
          <div className="wm-detail__actions">
            <button type="button" className="wm-detail__retry" onClick={retry}>Try again</button>
          </div>
        </div>
      );
    } else {
      const msg = state.phase === 'retrieving' ? 'Turning to this month…' : 'Composing what this month held…';
      body = <p className="wm-caption" aria-live="polite">{msg}</p>;
    }
    return (
      <div className="wm-root wm-detail">
        {back}
        <div className="wm-detail__status">{body}</div>
      </div>
    );
  }

  const { artifact } = state.record;

  // Opening ceremony (decision 9): seal cover until broken, unless reduced motion.
  if (!opened && !reduce) {
    return (
      <div className="wm-root wm-detail">
        {back}
        <button
          type="button"
          className="wm-seal-cover"
          aria-label="Break the seal"
          onClick={() => { markOpened(periodKey); setOpened(true); }}
        >
          {/* Stone's own aria-label ("May 2026") would otherwise concatenate into this
              button's accessible name via the accname algorithm; the explicit aria-label
              above pins it to exactly "Break the seal". The visible span is hidden from
              the a11y tree to avoid double-announcement. */}
          <Stone label={monthLabel(periodKey)} rotation={rotationFor(periodKey)} sealed />
          <span className="wm-label" aria-hidden="true">Break the seal</span>
        </button>
      </div>
    );
  }

  return (
    <div className="wm-root wm-detail">
      {back}
      <div className="wm-fade">
        <ReflectionLetter artifact={artifact} annotation={annotation} />
        <MarkerPath markers={artifact.markers} />

        {/* Static in Task 16 — Task 17 replaces this region with the annotate textarea. */}
        <div className="wm-annotate wm-annotate--static">
          <span className="wm-annotate__prompt wm-caption">＋ Add your words.</span>
        </div>
        {/* Static in Task 16 — Task 17 wires Save / Hide to the adapter. */}
        <footer className="wm-detail__footer">
          <span className="wm-label">Save to notes · Hide this stone</span>
        </footer>
      </div>
    </div>
  );
}
