// The "+ Add" panel for a focus list: a Type/paste tab (tolerant reference parser)
// and a Search tab (shared verse-search + book→chapter→verse bubble browser).
// Both surface ScriptureRefs via onAddRefs; the panel never persists anything itself.
import { useEffect, useMemo, useState } from 'react';
import { parseReferences } from './reference-parser';
import { formatVerseLabel, type ScriptureRef } from './focus-list-types';
import { createVerseSearch } from '../verse-search';
import type { VerseCandidate, VerseSearchDeps } from '../verse-search-types';
import type { BibleTranslation } from '../translations';
import { searchBooks } from '../book-search';
import type { BibleBook } from '../bible-books';
import { loadChapterVerses as defaultLoadChapterVerses } from './chapter-verses';

export interface AddVersePanelProps {
  onAddRefs: (refs: ScriptureRef[]) => void;
  searchDeps: VerseSearchDeps;
  translation: BibleTranslation;
  /** Injected verse loader; defaults to the live supabase query. Tests pass a fake. */
  loadChapterVerses?: (book: string, chapter: number, translation: BibleTranslation) => Promise<number[]>;
}

// A search candidate's osis ("jhn.3.16") carries the OSIS abbrev we store as
// ScriptureRef.book; candidate.book is the canonical display name for the label.
function candidateToRef(c: VerseCandidate): ScriptureRef {
  const book = c.osis.split('.')[0];
  const verseEnd = c.verseEnd ?? c.verseStart;
  return {
    book,
    chapter: c.chapter,
    verseStart: c.verseStart,
    verseEnd,
    label: formatVerseLabel(c.book, c.chapter, c.verseStart, verseEnd),
  };
}

export function AddVersePanel({
  onAddRefs,
  searchDeps,
  translation,
  loadChapterVerses: loadChapterVersesProp,
}: AddVersePanelProps) {
  const [tab, setTab] = useState<'paste' | 'search'>('paste');
  const [text, setText] = useState('');
  const [unparsed, setUnparsed] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VerseCandidate[]>([]);

  // Browse navigator state
  const [navBook, setNavBook] = useState<BibleBook | null>(null);
  const [navChapter, setNavChapter] = useState<number | null>(null);
  const [chapterVerses, setChapterVerses] = useState<number[]>([]);
  const [loadingVerses, setLoadingVerses] = useState(false);

  const loadVerses = loadChapterVersesProp ?? defaultLoadChapterVerses;

  const search = useMemo(() => createVerseSearch(searchDeps), [searchDeps]);
  useEffect(() => () => search.cancel(), [search]);

  // Load verse numbers when the user drills into a chapter.
  useEffect(() => {
    if (!navBook || navChapter == null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingVerses(true);

    setChapterVerses([]);
    (async () => {
      const verses = await loadVerses(navBook.abbrev, navChapter, translation);
      if (cancelled) return;
      setChapterVerses(verses);
      setLoadingVerses(false);
    })();
    return () => { cancelled = true; };
  }, [navBook, navChapter, translation, loadVerses]);

  const submitPaste = () => {
    const { refs, unparsed: bad } = parseReferences(text);
    if (refs.length > 0) { onAddRefs(refs); setText(''); }
    setUnparsed(bad);
  };

  const runSearch = (value: string) => {
    setQuery(value);
    if (!value.trim()) { setResults([]); search.cancel(); return; }
    search.query(value, (next) => setResults(next));
  };

  const bookPills = searchBooks(query).books;

  // Pill / bubble shared style tokens (matches BibleReader.tsx)
  const pillStyle: React.CSSProperties = {
    border: '1px solid var(--pale-stone)',
    color: 'var(--deep-umber)',
    fontFamily: 'Outfit, sans-serif',
  };

  return (
    <div className="px-3 py-2" style={{ borderTop: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}>
      <div className="flex gap-1 mb-2">
        <button
          onClick={() => setTab('paste')}
          className="text-[11px] px-2 py-1 rounded"
          style={{ background: tab === 'paste' ? 'rgba(196,154,120,0.22)' : 'transparent', color: 'var(--deep-umber)' }}
        >
          Type / paste
        </button>
        <button
          onClick={() => setTab('search')}
          className="text-[11px] px-2 py-1 rounded"
          style={{ background: tab === 'search' ? 'rgba(196,154,120,0.22)' : 'transparent', color: 'var(--deep-umber)' }}
        >
          Search
        </button>
      </div>

      {tab === 'paste' ? (
        <div>
          <textarea
            aria-label="Paste references"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="John 3:16, Ps 23:1-3, Eph 2:8-9"
            rows={3}
            className="w-full text-[12px] p-2 rounded outline-none"
            style={{ border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)', background: 'transparent' }}
          />
          <div className="mt-1">
            <button
              onClick={submitPaste}
              className="text-[11px] font-semibold px-2.5 py-1 rounded"
              style={{ border: '1px solid var(--deep-umber)', color: 'var(--deep-umber)' }}
            >
              Add
            </button>
          </div>
          {unparsed.length > 0 && (
            <p className="text-[10px] mt-1" style={{ color: '#b45454' }}>
              Couldn't read: {unparsed.join(', ')}
            </p>
          )}
        </div>
      ) : (
        <div>
          <input
            aria-label="Search verses"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder={`Search verses in ${translation}…`}
            className="w-full text-[12px] p-2 rounded outline-none"
            style={{ border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)', background: 'transparent' }}
          />

          {/* Browse navigator — between the search input and keyword results */}
          <div className="mt-1.5 mb-1">
            {navBook === null ? (
              /* Book level: pill grid filtered by the same query */
              <div className="flex flex-wrap gap-1.5">
                {bookPills.map((book) => (
                  <button
                    key={book.abbrev}
                    onClick={() => { setNavBook(book); setNavChapter(null); }}
                    className="text-[10px] px-2 py-1 rounded hover:bg-black/5"
                    style={pillStyle}
                  >
                    {book.name}
                  </button>
                ))}
              </div>
            ) : navChapter === null ? (
              /* Chapter level: back button + chapter bubble grid */
              <div>
                <button
                  onClick={() => setNavBook(null)}
                  className="text-[11px] block mb-1"
                  style={{ color: 'var(--deep-umber)' }}
                >
                  ← {navBook.name}
                </button>
                <div className="grid grid-cols-8 gap-1.5">
                  {Array.from({ length: navBook.chapterCount }, (_, i) => i + 1).map((ch) => (
                    <button
                      key={ch}
                      aria-label={`Chapter ${ch}`}
                      onClick={() => setNavChapter(ch)}
                      className="text-[10px] py-1 rounded text-center hover:bg-black/5"
                      style={pillStyle}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Verse level: back button + verse bubble grid loaded live */
              <div>
                <button
                  onClick={() => setNavChapter(null)}
                  className="text-[11px] block mb-1"
                  style={{ color: 'var(--deep-umber)' }}
                >
                  ← {navBook.name} {navChapter}
                </button>
                {loadingVerses ? (
                  <p className="text-[10px]" style={{ color: 'var(--deep-umber)' }}>Loading…</p>
                ) : (
                  <div className="grid grid-cols-8 gap-1.5">
                    {chapterVerses.map((v) => (
                      <button
                        key={v}
                        aria-label={`Verse ${v}`}
                        onClick={() =>
                          onAddRefs([{
                            book: navBook.abbrev,
                            chapter: navChapter,
                            verseStart: v,
                            verseEnd: v,
                            label: formatVerseLabel(navBook.name, navChapter, v, v),
                          }])
                        }
                        className="text-[10px] py-1 rounded text-center hover:bg-black/5"
                        style={pillStyle}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Keyword search results — unchanged */}
          <ul className="mt-1">
            {results.map((c) => {
              const verseEnd = c.verseEnd ?? c.verseStart;
              const refLabel = formatVerseLabel(c.book, c.chapter, c.verseStart, verseEnd);
              return (
                <li key={`${c.osis}-${c.source}`}>
                  <button
                    onClick={() => onAddRefs([candidateToRef(c)])}
                    className="w-full text-left text-[11px] px-2 py-1.5 rounded hover:bg-black/5"
                    style={{ color: 'var(--deep-umber)' }}
                  >
                    <span className="font-semibold">{refLabel}</span>
                    {c.text ? <span className="opacity-70"> — {c.text}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
