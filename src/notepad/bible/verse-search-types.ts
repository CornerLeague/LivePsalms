// Shared types for the framework-free verse-search module and its client deps.

export type VerseCandidate = {
  osis: string;            // bible_passages id key, e.g. "jhn.3.16" (range -> start verse id)
  book: string;            // canonical name, e.g. "John"
  chapter: number;
  verseStart: number;
  verseEnd: number | null; // null = single verse; set = range (pericope-resolved)
  text: string;
  translation: 'BSB';
  source: 'reference' | 'fts' | 'semantic';
  score: number;           // [0,1]
  label?: string;          // distinct display label for resolved passages, e.g. "John 3:1–21 · passage"
};

export type RawFtsRow = {
  id: string;              // "jhn.3.16"
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  text: string;
};

export type RawSemanticRow = {
  sourceId: string;        // "jhn.3.16" (verse) or "jhn.3" (pericope)
  text: string;
  similarity: number;      // 0..1
};

export type PericopeRange = {
  book: string;            // canonical name, e.g. "John"
  chapter: number;
  verseStart: number;      // min over the pericope
  verseEnd: number;        // max over the pericope
  text: string;            // joined pericope text (best-effort)
};

export interface VerseSearchDeps {
  ftsSearch: (query: string, opts: { signal?: AbortSignal }) => Promise<RawFtsRow[]>;
  semanticSearch: (query: string, opts: { signal?: AbortSignal }) => Promise<RawSemanticRow[]>;
  resolvePericope: (pericopeId: string, opts: { signal?: AbortSignal }) => Promise<PericopeRange | null>;
  fetchVerseText: (
    ref: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ text: string; translation: string; reference: string } | null>;
}
