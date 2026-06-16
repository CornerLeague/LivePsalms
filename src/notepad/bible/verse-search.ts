import { parseVerseRef, BOOK_TO_OSIS } from '../graph/reference-parser';
import type { RawFtsRow, RawSemanticRow, PericopeRange, VerseCandidate, VerseSearchDeps } from './verse-search-types';

const FTS_SCORE = 0.55;

// Inverse of BOOK_TO_OSIS for resolving "jhn" -> "John".
const OSIS_TO_BOOK: Record<string, string> = Object.fromEntries(
  Object.entries(BOOK_TO_OSIS).map(([book, osis]) => [osis, book]),
);

// Builds the bible_passages id key from a parsed ref. Precondition: `book` is a
// canonical book name present in BOOK_TO_OSIS — callers obtain it from
// parseVerseRef or osisBookToCanonical, both of which validate the book first.
export function osisForRef(book: string, chapter: number, verse: number): string {
  const osisBook = BOOK_TO_OSIS[book];
  return `${osisBook}.${chapter}.${verse}`;
}

export function osisBookToCanonical(osisBook: string): string | null {
  return OSIS_TO_BOOK[osisBook] ?? null;
}

export type Route =
  | { kind: 'reference'; parsed: NonNullable<ReturnType<typeof parseVerseRef>> }
  | { kind: 'keyword' };

export function routeQuery(query: string): Route {
  const parsed = parseVerseRef(query);
  if (parsed) return { kind: 'reference', parsed };
  return { kind: 'keyword' };
}

// A bible_passages verse id has 3 dot-segments ("jhn.3.16"); a pericope id has 2
// ("jhn.3"). >= 3 segments => verse, anything else => pericope.
export function detectGrain(sourceId: string): 'verse' | 'pericope' {
  return sourceId.split('.').length >= 3 ? 'verse' : 'pericope';
}

export function normalizeFtsRow(row: RawFtsRow): VerseCandidate {
  return {
    osis: row.id,
    // bible_passages.book stores the OSIS abbrev ("jhn"); the VerseCandidate
    // contract requires the canonical display name ("John"). Fall back to the
    // raw value for any abbrev not in the map.
    book: osisBookToCanonical(row.book) ?? row.book,
    chapter: row.chapter,
    verseStart: row.verseStart,
    // bible_passages.verse_end is NOT NULL and equals verse_start for a single
    // verse (009 schema). The VerseCandidate contract uses verseEnd=null for
    // single verses, so collapse a self-equal range — otherwise every keyword
    // FTS hit renders "John 3:16–16". A real pericope range (end > start) stays.
    verseEnd: row.verseEnd != null && row.verseEnd !== row.verseStart ? row.verseEnd : null,
    text: row.text,
    translation: 'BSB',
    source: 'fts',
    score: FTS_SCORE,
  };
}

// Parse a verse-grain source id like "jhn.3.16" -> { osisBook, chapter, verse }.
function parseVerseSourceId(sourceId: string): { osisBook: string; chapter: number; verse: number } | null {
  const parts = sourceId.split('.');
  if (parts.length < 3) return null;
  const chapter = Number(parts[1]);
  const verse = Number(parts[2]);
  if (!Number.isFinite(chapter) || !Number.isFinite(verse)) return null;
  return { osisBook: parts[0], chapter, verse };
}

export async function normalizeSemanticRow(
  row: RawSemanticRow,
  opts: {
    resolvePericope: (id: string, o: { signal?: AbortSignal }) => Promise<PericopeRange | null>;
    signal?: AbortSignal;
  },
): Promise<VerseCandidate | null> {
  if (detectGrain(row.sourceId) === 'verse') {
    const parsed = parseVerseSourceId(row.sourceId);
    if (!parsed) return null;
    const book = osisBookToCanonical(parsed.osisBook);
    if (!book) return null;
    return {
      osis: row.sourceId,
      book,
      chapter: parsed.chapter,
      verseStart: parsed.verse,
      verseEnd: null,
      text: row.text,
      translation: 'BSB',
      source: 'semantic',
      score: row.similarity,
    };
  }

  // Pericope grain: resolve to a ranged candidate.
  const range = await opts.resolvePericope(row.sourceId, { signal: opts.signal });
  if (!range) return null;
  return {
    osis: osisForRef(range.book, range.chapter, range.verseStart),
    book: range.book,
    chapter: range.chapter,
    verseStart: range.verseStart,
    verseEnd: range.verseEnd,
    text: range.text || row.text,
    translation: 'BSB',
    source: 'semantic',
    score: row.similarity,
    label: `${range.book} ${range.chapter}:${range.verseStart}–${range.verseEnd} · passage`,
  };
}

const CORROBORATION_BOOST = 0.15;
const SOURCE_PRIORITY: Record<VerseCandidate['source'], number> = { reference: 3, semantic: 2, fts: 1 };

export function referenceCandidate(
  parsed: { book: string; chapter: number; verseStart: number; verseEnd: number | null },
  text: string,
): VerseCandidate {
  return {
    osis: osisForRef(parsed.book, parsed.chapter, parsed.verseStart),
    book: parsed.book,
    chapter: parsed.chapter,
    verseStart: parsed.verseStart,
    verseEnd: parsed.verseEnd,
    text,
    translation: 'BSB',
    source: 'reference',
    score: 1,
  };
}

export function mergeCandidates(
  reference: VerseCandidate | null,
  fts: VerseCandidate[],
  semantic: VerseCandidate[],
): VerseCandidate[] {
  const byOsis = new Map<string, VerseCandidate[]>();
  const all = [...(reference ? [reference] : []), ...semantic, ...fts];
  for (const c of all) {
    const group = byOsis.get(c.osis);
    if (group) group.push(c);
    else byOsis.set(c.osis, [c]);
  }

  const merged: VerseCandidate[] = [];
  for (const group of byOsis.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const best = group.reduce((a, b) => (SOURCE_PRIORITY[b.source] > SOURCE_PRIORITY[a.source] ? b : a));
    const maxScore = Math.max(...group.map((g) => g.score));
    const text = group.find((g) => g.text.trim().length > 0)?.text ?? best.text;
    const label = group.find((g) => g.label)?.label;
    merged.push({
      ...best,
      text,
      ...(label !== undefined && { label }),
      score: best.source === 'reference' ? 1 : Math.min(1, maxScore + CORROBORATION_BOOST * (group.length - 1)),
    });
  }

  // Reference pinned first (in insertion order); rest by score desc, stable.
  const refs = merged.filter((c) => c.source === 'reference');
  const rest = merged.filter((c) => c.source !== 'reference')
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (y.c.score - x.c.score) || (x.i - y.i))
    .map((x) => x.c);
  return [...refs, ...rest];
}

export const MIN_SEMANTIC_CHARS = 3;

export async function completeReference(
  partial: string,
  deps: VerseSearchDeps,
  opts: { signal?: AbortSignal },
): Promise<VerseCandidate | null> {
  const route = routeQuery(partial);
  if (route.kind !== 'reference') return null;
  // Lookup key for fetchVerseText (which parses ref strings); hyphen-minus is
  // intentional here — the en-dash is only for the human-facing passage label.
  const ref = `${route.parsed.book} ${route.parsed.chapter}:${route.parsed.verseStart}${route.parsed.verseEnd ? `-${route.parsed.verseEnd}` : ''}`;
  let text = '';
  try {
    const result = await deps.fetchVerseText(ref, { signal: opts.signal });
    if (result) text = result.text;
  } catch {
    // offline / abort — candidate still inserts with empty text (lazy-fill later)
  }
  return referenceCandidate(route.parsed, text);
}

export type EmitPhase = 'instant' | 'complete';

export function createVerseSearch(deps: VerseSearchDeps, opts: { debounceMs?: number } = {}) {
  const debounceMs = opts.debounceMs ?? 250;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (controller) { controller.abort(); controller = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function query(text: string, emit: (results: VerseCandidate[], phase: EmitPhase) => void): () => void {
    cancel();
    const ctrl = new AbortController();
    controller = ctrl;
    const signal = ctrl.signal;
    const trimmed = text.trim();
    const route = routeQuery(trimmed);

    // Reference pin (local parse; text fetched lazily by the node, not here).
    const pin = route.kind === 'reference' ? referenceCandidate(route.parsed, '') : null;

    // FTS — instant.
    (async () => {
      let ftsCands: VerseCandidate[] = [];
      try {
        const rows = await deps.ftsSearch(trimmed, { signal });
        ftsCands = rows.map(normalizeFtsRow);
      } catch { /* FTS error -> empty, picker stays usable */ }
      if (signal.aborted) return;
      emit(mergeCandidates(pin, ftsCands, []), 'instant');

      // Semantic — trailing debounce, only >= MIN_SEMANTIC_CHARS.
      if (trimmed.length < MIN_SEMANTIC_CHARS) return;
      timer = setTimeout(async () => {
        let semCands: VerseCandidate[] = [];
        try {
          const rows = await deps.semanticSearch(trimmed, { signal });
          const resolved = await Promise.all(
            rows.map((r) => normalizeSemanticRow(r, { resolvePericope: deps.resolvePericope, signal })),
          );
          semCands = resolved.filter((c): c is VerseCandidate => c !== null);
        } catch { /* semantic error/timeout -> degrade to FTS+reference */ }
        if (signal.aborted) return;
        emit(mergeCandidates(pin, ftsCands, semCands), 'complete');
      }, debounceMs);
    })();

    return cancel;
  }

  return { query, cancel };
}
