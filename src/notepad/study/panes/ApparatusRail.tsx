// src/notepad/study/panes/ApparatusRail.tsx
import { useApparatus, type CrossRefView } from '../useApparatus';
import { bookByAbbrev } from '@/notepad/bible/bible-books';
import { OriginalLanguagePanel } from '../lexicon/OriginalLanguagePanel';

function refLabel(x: CrossRefView): string {
  const name = bookByAbbrev(x.to_book)?.name ?? x.to_book;
  const verses = x.to_verse_start === x.to_verse_end ? `${x.to_verse_start}` : `${x.to_verse_start}-${x.to_verse_end}`;
  return `${name} ${x.to_chapter}:${verses}`;
}

export interface ApparatusRailProps {
  book: string;
  chapter: number;
  selectedVerse?: number | null;
}

export function ApparatusRail({ book, chapter, selectedVerse = null }: ApparatusRailProps) {
  const { book: ctx, crossRefs, loading, error } = useApparatus(book, chapter);

  const bookName = bookByAbbrev(book)?.name ?? book;
  const verseId = selectedVerse != null ? `${book}.${chapter}.${selectedVerse}` : null;
  const reference = selectedVerse != null ? `${bookName} ${chapter}:${selectedVerse}` : null;

  return (
    <div style={{ padding: 16, fontFamily: 'Outfit, sans-serif' }}>
      <OriginalLanguagePanel verseId={verseId} reference={reference} />

      {loading && <div style={{ color: 'var(--silica)' }}>Loading study context…</div>}
      {error && (
        <div style={{ color: 'var(--silica)' }}>
          Couldn&apos;t load study context. <button onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      {!loading && !error && ctx && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, color: 'var(--deep-umber)', margin: '0 0 8px' }}>{ctx.full_name}</h2>
          <dl style={{ fontSize: 12, color: 'var(--deep-umber)', lineHeight: 1.7, letterSpacing: '0.01em', margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div><strong>Author:</strong> {ctx.author}{ctx.author_note ? ` — ${ctx.author_note}` : ''}</div>
            {ctx.date_label && <div><strong>Date:</strong> {ctx.date_label}</div>}
            {ctx.region && <div><strong>Region:</strong> {ctx.region}</div>}
            {ctx.genre && <div><strong>Genre:</strong> {ctx.genre}</div>}
            {ctx.cultural_context && <p style={{ margin: '4px 0 0' }}>{ctx.cultural_context}</p>}
            {ctx.summary && <p style={{ margin: '4px 0 0' }}>{ctx.summary}</p>}
          </dl>
        </section>
      )}

      {!loading && !error && crossRefs.length > 0 && (
        <section>
          <h3 style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)', margin: '0 0 8px' }}>CROSS-REFERENCES</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {crossRefs.map((x, i) => (
              <li key={i} style={{ marginBottom: 14, fontSize: 12, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--lamplight-accent)', fontWeight: 600 }}>{refLabel(x)}</span>
                {x.crossesTestament && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--lamplight-accent)' }}>OT ↔ NT</span>}
                {x.text && <div style={{ color: 'var(--deep-umber)', marginTop: 2 }}>{x.text}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
