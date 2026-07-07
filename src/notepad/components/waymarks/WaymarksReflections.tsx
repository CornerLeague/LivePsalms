import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './waymarks.css';
import { Stone } from './Stone';
import { WaymarksLockedPreview } from './WaymarksLockedPreview';
import { useReflections } from '../../hooks/useReflections';
import type { LamplightAdapter, ReflectionListItem } from '../../storage/lamplight-adapter';

export interface WaymarksReflectionsProps {
  adapter: LamplightAdapter;
  userId: string;
  canAccess: boolean;
}

const STONE_FILLS = ['--wm-stone-1', '--wm-stone-2', '--wm-stone-3'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Deterministic tilt from the period key — a stone never jitters between renders.
function rotationFor(periodKey: string): number {
  let h = 0;
  for (const ch of periodKey) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return (h % 11) - 5; // −5..+5 deg
}
function monthLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}
const yearOf = (periodKey: string) => periodKey.slice(0, 4);

// Same key WaymarksPeriodDetail writes (Task 16 `wm-opened:<periodKey>`); duplicated 2-line read.
function hasBeenOpened(periodKey: string): boolean {
  try { return localStorage.getItem(`wm-opened:${periodKey}`) === '1'; } catch { return false; }
}

type Row =
  | { type: 'year'; year: string }
  | { type: 'stone'; item: ReflectionListItem; index: number };

export function WaymarksReflections({ adapter, userId, canAccess }: WaymarksReflectionsProps) {
  const [items, setItems] = useState<ReflectionListItem[] | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const { state, backfill } = useReflections({ adapter, userId }); // Path mode (no periodKey)

  const reload = useCallback(async () => {
    setItems(await adapter.listReflections(userId));
  }, [adapter, userId]);

  const restore = useCallback(async (periodKey: string) => {
    await adapter.setReflectionHidden(userId, 'reflection_recap', periodKey, false);
    await reload();
  }, [adapter, userId, reload]);

  // Async fetch-on-mount; setItems lands after the await, not synchronously in the effect body.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  // First Plus open backfills the months behind you, then repaints (§8). listBackfillTargets is
  // the artifact-table checklist, so after the first pass it returns [] and this is a cheap no-op.
  useEffect(() => {
    if (!canAccess) return;
    let alive = true;
    void (async () => {
      await backfill();
      if (alive) await reload();
    })();
    return () => { alive = false; };
  }, [canAccess, backfill, reload]);

  if (items === null) {
    return (
      <div className="wm-root">
        <p className="wm-caption">Finding your path…</p>
      </div>
    );
  }

  const visible = items.filter((i) => i.hiddenAt === null);
  const hidden = items.filter((i) => i.hiddenAt !== null);

  // Never subscribed and nothing to show → the invitation. (Task 19 adds the downgrade branch:
  // !canAccess but visible.length > 0 keeps the stones readable with a quiet head-note.)
  if (!canAccess && visible.length === 0) {
    return <WaymarksLockedPreview />;
  }

  const rows: Row[] = [];
  let lastYear = '';
  visible.forEach((item, index) => {
    const y = yearOf(item.periodKey);
    if (y !== lastYear) { rows.push({ type: 'year', year: y }); lastYear = y; }
    rows.push({ type: 'stone', item, index });
  });

  return (
    <div className="wm-root">
      <header>
        <p className="wm-label">The Path</p>
        <h1 className="wm-title" style={{ fontSize: '2rem', margin: '0.25rem 0 0' }}>
          The months you’ve walked
        </h1>
        {state.phase === 'backfilling' && (
          <p className="wm-caption" aria-live="polite">{state.message}</p>
        )}
      </header>

      <ol className="wm-path" aria-label="Your reflections, newest first">
        {rows.map((row) =>
          row.type === 'year' ? (
            <li key={`year-${row.year}`} className="wm-year" aria-hidden="true">{row.year}</li>
          ) : (
            <li
              key={row.item.periodKey}
              className="wm-path__node"
              style={{ marginLeft: `${((row.index % 5) - 2) * 16}px` }} // gentle meander
            >
              <Link
                to={`/notebook/reflections/${row.item.periodKey}`}
                className="wm-stone-link"
                aria-label={`${monthLabel(row.item.periodKey)}${row.item.annotation ? ', annotated' : ''}`}
              >
                <Stone
                  label={monthLabel(row.item.periodKey)}
                  rotation={rotationFor(row.item.periodKey)}
                  fillVar={STONE_FILLS[row.index % STONE_FILLS.length]}
                  sealed={row.index === 0 && !hasBeenOpened(row.item.periodKey)}
                />
                <span className="wm-caption">{monthLabel(row.item.periodKey)}</span>
              </Link>
            </li>
          ),
        )}
      </ol>

      {hidden.length > 0 && (
        <div className="wm-hidden">
          <button
            type="button"
            className="wm-hidden__toggle wm-label"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
          >
            Hidden stones
          </button>
          {showHidden && (
            <ul className="wm-hidden__list">
              {hidden.map((item) => (
                <li key={item.periodKey} className="wm-hidden__item wm-caption">
                  {monthLabel(item.periodKey)}
                  {' '}
                  <button
                    type="button"
                    className="wm-linkbtn wm-label"
                    onClick={() => void restore(item.periodKey)}
                  >
                    Restore this stone.
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
