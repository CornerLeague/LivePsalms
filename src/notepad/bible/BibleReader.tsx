// src/notepad/bible/BibleReader.tsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CornerDownLeft, Search, Info, WrapText, List, Rows3 } from 'lucide-react';
import { bookByAbbrev, type BibleBook } from './bible-books';
import { searchBooks } from './book-search';
import { useBiblePassages } from './useBiblePassages';
import { type BibleTranslation, TRANSLATIONS, translationInfo } from './translations';
import { type VerseLayout, nextVerseLayout, VERSE_LAYOUT_LABEL } from './bible-layout-types';
import { useIsMobile } from '@/hooks/use-mobile';
import { STYLE_ASSETS, getStyleAsset } from '../styles/manifest';
import { highlightBackgroundStyle } from '../extensions/style-highlight';
import { HighlightSwatchPopover } from '../components/HighlightSwatchPopover';
import { HighlightPill } from '../components/HighlightPill';
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export interface PassageRef {
  book: string;
  chapter: number;
}

export interface VerseRef extends PassageRef {
  verse: number;
}

export interface BibleReaderProps {
  initialBook?: string;
  initialChapter?: number;
  /** The active Bible translation (BSB | KJV | WEB). */
  translation: BibleTranslation;
  /** Called when the user picks a different translation from the dropdown. */
  onTranslationChange: (t: BibleTranslation) => void;
  /** Fires whenever the displayed book/chapter changes (mount + navigation). */
  onPassageChange?: (ref: PassageRef) => void;
  /** Fires when the user taps a verse (chat focus in Phase 2). */
  onSelectVerse?: (ref: VerseRef) => void;
  /** verse number -> swatchId for the current chapter. */
  highlightSwatchByVerse?: Record<number, string>;
  /** Persist (or recolor) a verse highlight. */
  onSetHighlight?: (verse: number, swatchId: string) => void;
  /** Remove a verse highlight. */
  onRemoveHighlight?: (verse: number) => void;
  /** Verse-number color. Defaults to the scripture-gold accent; the Study reader
      passes the body text color so the numbers read as part of the passage. */
  verseNumberColor?: string;
  /** Current verse layout. Defaults to 'inline' (continuous prose). */
  verseLayout?: VerseLayout;
  /** Called when the user cycles the layout control. */
  onVerseLayoutChange?: (layout: VerseLayout) => void;
}

export function BibleReader({
  initialBook = 'jhn',
  initialChapter = 1,
  translation,
  onTranslationChange,
  onPassageChange,
  onSelectVerse,
  highlightSwatchByVerse = {},
  onSetHighlight,
  onRemoveHighlight,
  verseNumberColor = 'var(--lamplight-accent)',
  verseLayout = 'inline',
  onVerseLayoutChange,
}: BibleReaderProps) {
  const [book, setBook] = useState(initialBook);
  const [chapter, setChapter] = useState(initialChapter);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);

  const isMobile = useIsMobile();
  // The verse whose swatch picker is open (null = closed).
  const [pickerVerse, setPickerVerse] = useState<number | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const highlightingEnabled = !!onSetHighlight;

  const [navOpen, setNavOpen] = useState(false);
  const [navBook, setNavBook] = useState<BibleBook | null>(null);
  const [query, setQuery] = useState('');

  // Verse to scroll into view after the next passage loads (set when a search
  // reference like "John 3:16" is followed). A ref so it doesn't fire on plain
  // verse taps.
  const pendingScrollVerse = useRef<number | null>(null);

  const navChapters = useMemo(
    () => (navBook ? Array.from({ length: navBook.chapterCount }, (_, i) => i + 1) : []),
    [navBook],
  );

  const search = useMemo(() => searchBooks(query), [query]);
  const otMatches = useMemo(() => search.books.filter((b) => b.testament === 'OT'), [search]);
  const ntMatches = useMemo(() => search.books.filter((b) => b.testament === 'NT'), [search]);

  const openNav = () => { setNavOpen((o) => !o); setNavBook(null); setQuery(''); };

  const closePicker = useCallback(() => {
    setPickerVerse(null);
    setPickerAnchor(null);
  }, []);

  const jumpTo = (abbrev: string, ch: number, verse: number | null = null) => {
    setBook(abbrev);
    setChapter(ch);
    setSelectedVerse(verse);
    pendingScrollVerse.current = verse;
    setNavOpen(false);
    setNavBook(null);
    setQuery('');
    setPickerVerse(null);
    setPickerAnchor(null);
  };

  const meta = bookByAbbrev(book);
  const { verses, loading, error } = useBiblePassages(book, chapter, translation);

  useEffect(() => {
    onPassageChange?.({ book, chapter });
  }, [book, chapter, onPassageChange]);

  // Scroll a search-targeted verse into view once its chapter has loaded.
  useEffect(() => {
    const verse = pendingScrollVerse.current;
    if (verse == null || loading) return;
    if (!verses.some((v) => v.verse === verse)) return;
    document
      .getElementById(`bible-verse-${verse}`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    pendingScrollVerse.current = null;
  }, [verses, loading]);

  const goPrev = () => {
    if (chapter > 1) {
      setChapter((c) => c - 1);
      setSelectedVerse(null);
      setPickerVerse(null);
      setPickerAnchor(null);
    }
  };
  const goNext = () => {
    if (meta && chapter < meta.chapterCount) {
      setChapter((c) => c + 1);
      setSelectedVerse(null);
      setPickerVerse(null);
      setPickerAnchor(null);
    }
  };
  const selectVerse = (verse: number) => {
    setSelectedVerse(verse);
    onSelectVerse?.({ book, chapter, verse });
    if (highlightingEnabled) {
      const rect = document.getElementById(`bible-verse-${verse}`)?.getBoundingClientRect();
      if (rect) {
        // Clamp left so a wide popover/pill stays on-screen.
        const left = Math.min(rect.left, window.innerWidth - 210);
        setPickerAnchor({ top: rect.bottom + 6, left: Math.max(8, left) });
        setPickerVerse(verse);
        setPickerQuery('');
      }
    }
  };

  const label = `${meta?.name ?? book} ${chapter}`;
  const LayoutIcon = verseLayout === 'inline' ? WrapText : verseLayout === 'lines' ? List : Rows3;

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: 'Outfit, sans-serif' }}>
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--pale-stone)' }}>
        <button
          aria-label="Browse books"
          onClick={openNav}
          className="text-[13px] font-bold flex items-center gap-1"
          style={{ color: 'var(--deep-umber)' }}
        >
          {label}
          <span className="text-[9px]" style={{ color: 'var(--silica)' }}>▾</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            aria-label={`Change verse layout (currently ${VERSE_LAYOUT_LABEL[verseLayout].toLowerCase()})`}
            title={`Verse layout: ${VERSE_LAYOUT_LABEL[verseLayout]} — click to change`}
            onClick={() => onVerseLayoutChange?.(nextVerseLayout(verseLayout))}
            className="p-1.5 rounded hover:bg-black/5 transition-colors"
          >
            <LayoutIcon className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
          </button>
          <select
            aria-label="Translation"
            value={translation}
            onChange={(e) => {
              const next = e.target.value as BibleTranslation;
              onTranslationChange(next);
              toast(`Switched to ${translationInfo(next).label} on this device. To use it everywhere, set it in Profile → Bible & Reading.`);
            }}
            className="text-[11px] font-semibold rounded px-1 py-0.5 mr-1 outline-none"
            style={{ color: 'var(--deep-umber)', background: 'transparent', border: '1px solid var(--pale-stone)' }}
          >
            {TRANSLATIONS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <Tooltip>
            <TooltipTrigger asChild>
              <span aria-label="Translation info" tabIndex={0} className="inline-flex cursor-help">
                <Info className="w-3 h-3" style={{ color: 'var(--silica)' }} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[16rem]">
              <p>Changing the version here applies to this device only. To set it everywhere, update Profile → Bible &amp; Reading.</p>
              <p className="mt-1 opacity-70">{translationInfo(translation).attribution}</p>
            </TooltipContent>
          </Tooltip>
          <button
            aria-label="Previous chapter"
            onClick={goPrev}
            disabled={chapter <= 1}
            className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
          </button>
          <button
            aria-label="Next chapter"
            onClick={goNext}
            disabled={!meta || chapter >= meta.chapterCount}
            className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
          </button>
        </div>
      </div>

      {navOpen && (
        <div className="px-4 py-3 shrink-0 overflow-y-auto" style={{ borderBottom: '1px solid var(--pale-stone)', maxHeight: '50%' }}>
          {!navBook && (
            <>
              {/* Search a book of the Bible or a verse reference. */}
              <div className="relative mb-3">
                <Search
                  className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--silica)' }}
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (search.jump) {
                        jumpTo(search.jump.book.abbrev, search.jump.chapter, search.jump.verse);
                      } else if (search.books.length > 0) {
                        setNavBook(search.books[0]);
                      }
                    } else if (e.key === 'Escape' && query) {
                      e.stopPropagation();
                      setQuery('');
                    }
                  }}
                  autoFocus
                  aria-label="Search books or verse"
                  placeholder="Search a book or verse…"
                  className="w-full text-[11px] pl-7 pr-2.5 py-1.5 rounded outline-none"
                  style={{
                    border: '1px solid var(--pale-stone)',
                    color: 'var(--deep-umber)',
                    fontFamily: 'Outfit, sans-serif',
                    background: 'transparent',
                  }}
                />
              </div>

              {search.jump && (
                <button
                  onClick={() => {
                    const j = search.jump;
                    if (j) jumpTo(j.book.abbrev, j.chapter, j.verse);
                  }}
                  className="w-full mb-3 text-left text-[11px] px-2.5 py-2 rounded hover:bg-black/5 flex items-center gap-2"
                  style={{
                    border: '1px solid var(--deep-umber)',
                    color: 'var(--deep-umber)',
                    fontFamily: 'Outfit, sans-serif',
                  }}
                >
                  <CornerDownLeft className="w-3 h-3 shrink-0" style={{ color: 'var(--silica)' }} />
                  Go to {search.jump.book.name} {search.jump.chapter}
                  {search.jump.verse != null ? `:${search.jump.verse}` : ''}
                </button>
              )}

              {otMatches.length > 0 && (
                <NavSection title="Old Testament" books={otMatches} onPick={setNavBook} />
              )}
              {ntMatches.length > 0 && (
                <NavSection title="New Testament" books={ntMatches} onPick={setNavBook} />
              )}
              {search.books.length === 0 && !search.jump && (
                <p
                  className="text-[10px]"
                  style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                >
                  No books match “{query}”.
                </p>
              )}
            </>
          )}
          {navBook && (
            <div>
              <button
                onClick={() => setNavBook(null)}
                className="text-[10px] font-medium tracking-wider mb-2 flex items-center gap-1"
                style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
              >
                <ChevronLeft className="w-3 h-3" /> {navBook.name}
              </button>
              <div className="grid grid-cols-8 gap-1.5">
                {navChapters.map((ch) => (
                  <button
                    key={ch}
                    aria-label={`Chapter ${ch}`}
                    onClick={() => jumpTo(navBook.abbrev, ch)}
                    className="text-[10px] py-1 rounded text-center hover:bg-black/5"
                    style={{ border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ fontFamily: 'Georgia, serif' }}>
        {loading && (
          <p className="text-[11px] tracking-wider" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
            Loading passage…
          </p>
        )}
        {error && !loading && (
          <p className="text-[11px] tracking-wider" style={{ color: '#b45454', fontFamily: 'Outfit, sans-serif' }}>
            {error}
          </p>
        )}
        {!loading && !error && verses.length === 0 && (
          <p className="text-[11px] tracking-wider" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
            No text found for this chapter.
          </p>
        )}
        {!loading && !error && verses.length > 0 && (() => {
          const blockMode = verseLayout !== 'inline';
          const Container = blockMode ? 'div' : 'p';
          return (
            <Container className="text-[13px] leading-[1.9]" style={{ color: 'var(--deep-umber)' }}>
              {verses.map((v) => {
                const swatchId = highlightSwatchByVerse[v.verse];
                const asset = swatchId ? getStyleAsset(swatchId) : undefined;
                const highlightStyle = asset ? highlightBackgroundStyle(asset.displayUrl) : '';
                const verseSpan = (
                  <span
                    id={`bible-verse-${v.verse}`}
                    onClick={() => selectVerse(v.verse)}
                    className={asset ? 'cursor-pointer bible-verse-highlight' : 'cursor-pointer'}
                    // A persisted swatch wins; otherwise show the transient tap tint.
                    style={
                      asset
                        ? cssTextToStyle(highlightStyle)
                        : {
                            background:
                              selectedVerse === v.verse ? 'rgba(196,154,120,0.22)' : 'transparent',
                            borderRadius: 3,
                            padding: '0 2px',
                          }
                    }
                  >
                    <sup className="text-[9px] font-bold mr-1" style={{ color: verseNumberColor }}>{v.verse}</sup>
                    {v.text}{blockMode ? '' : ' '}
                  </span>
                );
                return blockMode ? (
                  <div key={v.verse} style={{ marginBottom: verseLayout === 'spaced' ? '0.7em' : 0 }}>
                    {verseSpan}
                  </div>
                ) : (
                  <Fragment key={v.verse}>{verseSpan}</Fragment>
                );
              })}
            </Container>
          );
        })()}
        {highlightingEnabled && pickerVerse != null && pickerAnchor && (
          isMobile ? (
            <HighlightPill
              assets={STYLE_ASSETS}
              anchor={{ top: pickerAnchor.top, left: pickerAnchor.left }}
              onPick={(swatchId) => { onSetHighlight?.(pickerVerse, swatchId); closePicker(); }}
              onRemove={() => { onRemoveHighlight?.(pickerVerse); closePicker(); }}
              onClose={closePicker}
            />
          ) : (
            <HighlightSwatchPopover
              assets={STYLE_ASSETS}
              query={pickerQuery}
              onQueryChange={setPickerQuery}
              anchor={pickerAnchor}
              autoFocus
              onPick={(swatchId) => { onSetHighlight?.(pickerVerse, swatchId); closePicker(); }}
              onRemove={() => { onRemoveHighlight?.(pickerVerse); closePicker(); }}
              onClose={closePicker}
            />
          )
        )}
      </div>
    </div>
  );
}

function NavSection({ title, books, onPick }: { title: string; books: readonly BibleBook[]; onPick: (b: BibleBook) => void }) {
  return (
    <div className="mb-3">
      <div className="text-[9px] font-semibold tracking-[0.16em] mb-1.5" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
        {title.toUpperCase()}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {books.map((b) => (
          <button
            key={b.abbrev}
            onClick={() => onPick(b)}
            className="text-[10px] px-2 py-1 rounded hover:bg-black/5"
            style={{ border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
          >
            {b.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Convert a "prop:value;prop:value;" CSS string into a React style object.
function cssTextToStyle(cssText: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const decl of cssText.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop) continue;
    // camelCase the CSS property (e.g. background-image -> backgroundImage).
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[camel] = value;
  }
  return style;
}
