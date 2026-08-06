// src/notepad/study/panes/ApparatusRail.tsx
import { useApparatus } from '../useApparatus';
import { formatCrossRefLabel } from '../apparatus-queries';
import { bookByAbbrev } from '@/notepad/bible/bible-books';
import { OriginalLanguagePanel } from '../lexicon/OriginalLanguagePanel';
import { EtymologyPanel } from '../lexicon/EtymologyPanel';
import { RegionMapBlock } from '../regionmap/RegionMapBlock';
import { BookContextCard } from './BookContextCard';
import type { LamplightAdapter } from '@/notepad/storage/lamplight-adapter';
import type { BibleTranslation } from '@/notepad/bible/translations';

export interface ApparatusRailProps {
  book: string;
  chapter: number;
  /** Reader's active translation. Required — see useApparatus's note on why it isn't defaulted. */
  translation: BibleTranslation;
  selectedVerse?: number | null;
  userId?: string | null;
  adapter?: LamplightAdapter | null;
}

export function ApparatusRail({ book, chapter, translation, selectedVerse = null, userId = null, adapter = null }: ApparatusRailProps) {
  const { book: ctx, crossRefs, loading, error } = useApparatus(book, chapter, translation);

  const bookName = bookByAbbrev(book)?.name ?? book;
  const verseId = selectedVerse != null ? `${book}.${chapter}.${selectedVerse}` : null;
  const reference = selectedVerse != null ? `${bookName} ${chapter}:${selectedVerse}` : null;

  return (
    <div style={{ padding: 16, fontFamily: 'Outfit, sans-serif' }}>
      <OriginalLanguagePanel verseId={verseId} reference={reference} />
      <EtymologyPanel verseId={verseId} reference={reference} userId={userId} adapter={adapter} />

      {loading && <div style={{ color: 'var(--silica)' }}>Loading study context…</div>}
      {error && (
        <div style={{ color: 'var(--silica)' }}>
          Couldn&apos;t load study context. <button onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      {!loading && !error && ctx && <BookContextCard ctx={ctx} />}

      <RegionMapBlock book={book} />

      {!loading && !error && crossRefs.length > 0 && (
        <section>
          <h3 style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)', margin: '0 0 8px' }}>CROSS-REFERENCES</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {crossRefs.map((x, i) => (
              <li key={i} style={{ marginBottom: 14, fontSize: 12, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--lamplight-accent)', fontWeight: 600 }}>{formatCrossRefLabel(x)}</span>
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
