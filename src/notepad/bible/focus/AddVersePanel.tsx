// The "+ Add" panel for a focus list: a Type/paste tab (tolerant reference parser)
// and a Search tab (shared verse-search). Both surface ScriptureRefs via onAddRefs;
// the panel never persists anything itself.
import { useEffect, useMemo, useState } from 'react';
import { parseReferences } from './reference-parser';
import { formatVerseLabel, type ScriptureRef } from './focus-list-types';
import { createVerseSearch } from '../verse-search';
import type { VerseCandidate, VerseSearchDeps } from '../verse-search-types';
import type { BibleTranslation } from '../translations';

export interface AddVersePanelProps {
  onAddRefs: (refs: ScriptureRef[]) => void;
  searchDeps: VerseSearchDeps;
  translation: BibleTranslation;
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

export function AddVersePanel({ onAddRefs, searchDeps, translation }: AddVersePanelProps) {
  const [tab, setTab] = useState<'paste' | 'search'>('paste');
  const [text, setText] = useState('');
  const [unparsed, setUnparsed] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VerseCandidate[]>([]);

  const search = useMemo(() => createVerseSearch(searchDeps), [searchDeps]);
  useEffect(() => () => search.cancel(), [search]);

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
