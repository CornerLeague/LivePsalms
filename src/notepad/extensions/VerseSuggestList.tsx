import type { VerseCandidate } from '../bible/verse-search-types';
import './scripture-ref.css';

export interface VerseSuggestListProps {
  /** Candidates to display. Must be deduplicated by `osis` (invariant upheld by mergeCandidates). */
  items: VerseCandidate[];
  selectedIndex: number;
  onSelect: (item: VerseCandidate) => void;
  loading: boolean;
  offline: boolean;
}

function rowLabel(c: VerseCandidate): string {
  if (c.label) return c.label;
  const range = c.verseEnd ? `${c.verseStart}–${c.verseEnd}` : `${c.verseStart}`;
  return `${c.book} ${c.chapter}:${range}`;
}

export function VerseSuggestList({ items, selectedIndex, onSelect, loading, offline }: VerseSuggestListProps) {
  if (offline) {
    return <div className="verse-suggest verse-suggest--empty">Verse search needs connection</div>;
  }
  return (
    <div className="verse-suggest" role="listbox" aria-label="Verse suggestions">
      {items.map((c, i) => (
        <div
          key={c.osis}
          role="option"
          aria-selected={i === selectedIndex}
          className={`verse-suggest__row${i === selectedIndex ? ' is-selected' : ''}`}
          onClick={() => onSelect(c)}
          tabIndex={-1}
        >
          <span className="verse-suggest__ref">{rowLabel(c)}</span>
          {c.text ? <span className="verse-suggest__text">{c.text}</span> : null}
        </div>
      ))}
      {loading ? <div className="verse-suggest__hint">Searching…</div> : null}
      {!loading && items.length === 0 ? <div className="verse-suggest__hint">Keep typing…</div> : null}
    </div>
  );
}
