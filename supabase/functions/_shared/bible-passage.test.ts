import { describe, it, expect } from 'vitest';
import { formatVerseRef, formatDisplayVerseRef, buildPassages, fetchPassageText, type BiblePassageRow } from './bible-passage';
import { parseRefToIds } from './verse-verify';
import type { RetrievedItem } from './retrieval';

// Fake supabase: returns KJV for jhn.3.16 only; BSB for both ids.
function fakeSupabase() {
  return {
    from() {
      return {
        select() { return this; },
        eq(_col: string, val: string) { (this as Record<string, unknown>)._t = val; return this; },
        in(_col: string, ids: string[]) { (this as Record<string, unknown>)._ids = ids; return this; },
        then(res: (v: unknown) => void) {
          const t = (this as Record<string, string>)._t;
          const ids = (this as Record<string, string[]>)._ids;
          const rows = ids
            .filter((id) => (t === 'KJV' ? id === 'jhn.3.16' : true))
            .map((id) => ({ id, text: `${t}:${id}`, book: 'jhn', chapter: 3, verse_start: 16, verse_end: 16 }));
          res({ data: rows, error: null });
          return this;
        },
      };
    },
  };
}

function makeRow(over: Partial<BiblePassageRow> = {}): BiblePassageRow {
  return {
    id: 'p1',
    book: 'Psalm',
    chapter: 23,
    verse_start: 4,
    verse_end: 4,
    text: 'Even though I walk through the valley…',
    ...over,
  };
}

function makeRetrieved(over: Partial<RetrievedItem> = {}): RetrievedItem {
  return {
    id: 'r1',
    source_id: 'p1',
    chunk_index: 0,
    chunk_text: 'chunk',
    similarity: 0.9,
    metadata: {},
    ...over,
  };
}

describe('fetchPassageText fallback', () => {
  it('uses the chosen translation, falling back to BSB per-id', async () => {
    const byId = await fetchPassageText(fakeSupabase() as never, ['jhn.3.16', 'jhn.3.17'], 'KJV');
    expect(byId.get('jhn.3.16')?.text).toBe('KJV:jhn.3.16');
    expect(byId.get('jhn.3.17')?.text).toBe('BSB:jhn.3.17'); // fell back
  });
});

describe('formatVerseRef', () => {
  it('formats a single-verse reference as Book C:V', () => {
    expect(formatVerseRef({ book: 'Psalm', chapter: 23, verse_start: 4, verse_end: 4 })).toBe('Psalm 23:4');
  });

  it('formats a multi-verse range as Book C:Vs-Ve', () => {
    expect(formatVerseRef({ book: 'Romans', chapter: 8, verse_start: 28, verse_end: 30 })).toBe('Romans 8:28-30');
  });
});

describe('buildPassages', () => {
  it('joins a retrieved item to its row, with rerank_score present', () => {
    const rows = [makeRow()];
    const retrieved = [makeRetrieved({ similarity: 0.91, rerank_score: 0.77 })];
    const out = buildPassages(rows, retrieved);
    expect(out).toEqual([
      {
        source_id: 'p1',
        text: 'Even though I walk through the valley…',
        ref: 'Psalm 23:4',
        metadata: { book: 'Psalm', chapter: 23, similarity: 0.91, rerank_score: 0.77 },
      },
    ]);
  });

  it('carries rerank_score as undefined when absent', () => {
    const out = buildPassages([makeRow()], [makeRetrieved()]);
    expect(out).toHaveLength(1);
    expect(out[0].metadata).toEqual({ book: 'Psalm', chapter: 23, similarity: 0.9, rerank_score: undefined });
    expect('rerank_score' in (out[0].metadata as Record<string, unknown>)).toBe(true);
  });

  it('produces a range ref when verse_start !== verse_end', () => {
    const rows = [makeRow({ verse_start: 4, verse_end: 6 })];
    const out = buildPassages(rows, [makeRetrieved()]);
    expect(out[0].ref).toBe('Psalm 23:4-6');
  });

  it('skips a retrieved item whose source_id is missing from the rows', () => {
    const rows = [makeRow({ id: 'p1' })];
    const retrieved = [
      makeRetrieved({ source_id: 'p1' }),
      makeRetrieved({ id: 'r2', source_id: 'missing' }),
    ];
    const out = buildPassages(rows, retrieved);
    expect(out).toHaveLength(1);
    expect(out[0].source_id).toBe('p1');
  });

  it('returns an empty array for empty inputs', () => {
    expect(buildPassages([], [])).toEqual([]);
    expect(buildPassages([makeRow()], [])).toEqual([]);
  });

  it('orders output by the retrieved array, not the rows', () => {
    const rows = [
      makeRow({ id: 'a', book: 'Genesis', chapter: 1, verse_start: 1, verse_end: 1 }),
      makeRow({ id: 'b', book: 'Exodus', chapter: 2, verse_start: 2, verse_end: 2 }),
    ];
    const retrieved = [
      makeRetrieved({ id: 'rb', source_id: 'b' }),
      makeRetrieved({ id: 'ra', source_id: 'a' }),
    ];
    const out = buildPassages(rows, retrieved);
    expect(out.map(p => p.source_id)).toEqual(['b', 'a']);
  });
});

// ── Devotion refs are DISPLAY refs ───────────────────────────────────────────
// bible_passages.book holds the OSIS code, so formatVerseRef yields "psa 23:4".
// That string was going into the devotion's allowlist, into the prompt, into the
// model's scripture.ref, and onto the reader's card — and the eval baseline
// caught the model echoing it into the reflection prose too ("The image in
// psa 16:6…"). buildPassages feeds the devotion path exclusively, so this is the
// seam where the devotion gets human refs without touching study or chat.

describe('formatDisplayVerseRef', () => {
  it('renders the full book name for an OSIS code', () => {
    expect(formatDisplayVerseRef({ book: 'psa', chapter: 23, verse_start: 4, verse_end: 4 }))
      .toBe('Psalms 23:4');
  });

  it('renders a range', () => {
    expect(formatDisplayVerseRef({ book: 'psa', chapter: 23, verse_start: 4, verse_end: 6 }))
      .toBe('Psalms 23:4-6');
  });

  it('handles numbered books', () => {
    expect(formatDisplayVerseRef({ book: '1jn', chapter: 4, verse_start: 8, verse_end: 8 }))
      .toBe('1 John 4:8');
  });

  it('falls back to the raw book value for an unknown code rather than rendering blank', () => {
    expect(formatDisplayVerseRef({ book: 'John', chapter: 3, verse_start: 16, verse_end: 16 }))
      .toBe('John 3:16');
  });
});

describe('buildPassages — display refs', () => {
  const retrieved = [
    { id: 'e1', source_id: 'psa.23.4', chunk_index: 0, chunk_text: 'x', similarity: 0.9, metadata: {} },
  ];
  const rows = [
    { id: 'psa.23.4', book: 'psa', chapter: 23, verse_start: 4, verse_end: 4, text: 'Even though I walk…' },
  ];

  it('gives the devotion a human ref, not the raw OSIS code', () => {
    expect(buildPassages(rows, retrieved)[0].ref).toBe('Psalms 23:4');
  });

  it('LOAD-BEARING: the ref it produces parses back to the same verse id', () => {
    // The allowlist ref must be verifiable. When it was "psa 23:4" the shared
    // parser could not read it, so Scripture verification silently skipped every
    // devotion — the bug the first live eval run surfaced.
    const ref = buildPassages(rows, retrieved)[0].ref;
    expect(parseRefToIds(ref)).toEqual(['psa.23.4']);
  });
});
