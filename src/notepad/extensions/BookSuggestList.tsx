import type { BookOrVerseItem } from './book-matcher';
import './scripture-ref.css';

export interface BookSuggestListProps {
  items: BookOrVerseItem[];
  selectedIndex: number;
  onSelect: (item: BookOrVerseItem) => void;
  loading: boolean;
  /** Shown when there are no rows (e.g. the "awaiting chapter:verse" state). */
  hint: string | null;
  offline: boolean;
}

function itemKey(item: BookOrVerseItem, i: number): string {
  return item.kind === 'book' ? `book:${item.book}` : `verse:${item.candidate.osis}:${i}`;
}

function rowLabel(item: BookOrVerseItem): string {
  if (item.kind === 'book') return item.book;
  const c = item.candidate;
  const range = c.verseEnd ? `${c.verseStart}–${c.verseEnd}` : `${c.verseStart}`;
  return c.label ?? `${c.book} ${c.chapter}:${range}`;
}

export function BookSuggestList({ items, selectedIndex, onSelect, loading, hint, offline }: BookSuggestListProps) {
  if (offline) {
    return <div className="verse-suggest verse-suggest--empty">Verse search needs connection</div>;
  }
  return (
    <div className="verse-suggest" role="listbox" aria-label="Book suggestions">
      {items.map((item, i) => (
        <div
          key={itemKey(item, i)}
          role="option"
          aria-selected={i === selectedIndex}
          className={`verse-suggest__row${i === selectedIndex ? ' is-selected' : ''}`}
          onClick={() => onSelect(item)}
          tabIndex={-1}
        >
          <span className="verse-suggest__ref">{rowLabel(item)}</span>
          {item.kind === 'verse' && item.candidate.text
            ? <span className="verse-suggest__text">{item.candidate.text}</span>
            : null}
        </div>
      ))}
      {loading ? <div className="verse-suggest__hint">Searching…</div> : null}
      {!loading && items.length === 0 && hint ? <div className="verse-suggest__hint">{hint}</div> : null}
    </div>
  );
}
