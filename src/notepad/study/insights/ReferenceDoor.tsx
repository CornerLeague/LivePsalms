// src/notepad/study/insights/ReferenceDoor.tsx
// Door 3 — Sources & Reference. Everything here is class A (our own tables) or
// class B (quoted library excerpts): no AI call, no entitlement gate, and
// nothing that can be hallucinated. It renders the moment the overlay opens,
// which is why the panel is never empty while the generated doors of B2/B3
// take their time.
//
// Every section may be absent. A chapter nobody commented on, a book with no
// apparatus row, a verse with no interlinear — each renders nothing rather
// than a placeholder apologising for itself. Absence is a normal outcome, not
// an error state.
import { useMemo } from 'react';
import { useApparatus } from '../useApparatus';
import { OriginalLanguagePanel } from '../lexicon/OriginalLanguagePanel';
import { EtymologyPanel } from '../lexicon/EtymologyPanel';
import { BookContextCard } from '../panes/BookContextCard';
import { bookByAbbrev } from '@/notepad/bible/bible-books';
import type { BibleTranslation } from '@/notepad/bible/translations';
import type { LamplightAdapter } from '@/notepad/storage/lamplight-adapter';
import { useLibraryVoices } from './useLibraryVoices';
import { LibraryVoices } from './LibraryVoices';
import { CrossReferenceList } from './CrossReferenceList';
import type { InsightsScope } from './InsightsOverlay';
import type { RefAnchor } from './library-voices-query';

export interface ReferenceDoorProps {
  scope: InsightsScope;
  translation: BibleTranslation;
  userId: string | null;
  adapter: LamplightAdapter | null;
}

export function ReferenceDoor({ scope, translation, userId, adapter }: ReferenceDoorProps) {
  const { book, chapter, verse } = scope;
  const { book: ctx, crossRefs } = useApparatus(book, chapter, translation);

  const anchor = useMemo<RefAnchor>(
    () => (verse === null ? { book, chapter } : { book, chapter, verseStart: verse, verseEnd: verse }),
    [book, chapter, verse],
  );
  const { voices, loading: voicesLoading } = useLibraryVoices(anchor);

  const bookName = bookByAbbrev(book)?.name ?? book;
  // The lexicon panels are verse-level by nature: at chapter scope they take
  // null and render their own empty state, exactly as they do in the rail.
  const verseId = verse !== null ? `${book}.${chapter}.${verse}` : null;
  const reference = verse !== null ? `${bookName} ${chapter}:${verse}` : null;

  return (
    <div>
      {ctx && <BookContextCard ctx={ctx} />}

      <LibraryVoices voices={voices} loading={voicesLoading} />

      <OriginalLanguagePanel verseId={verseId} reference={reference} />
      <EtymologyPanel verseId={verseId} reference={reference} userId={userId} adapter={adapter} />

      <CrossReferenceList
        crossRefs={crossRefs}
        translation={translation}
        passageKey={`${book}.${chapter}`}
      />
    </div>
  );
}
