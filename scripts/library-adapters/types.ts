// scripts/library-adapters/types.ts
//
// The contract every library source implements. `parse` is PURE — no fs, no
// network, no clock — so each adapter is testable on a small fixture string and
// the driver owns all I/O. Mirrors how ingest-cross-references.ts exports
// parseCrossRefLine separately from its main().

/** A source's own versification tradition, used by normalizeRef. */
export type VersificationScheme = 'english' | 'hebrew';

export interface LibrarySourceRow {
  id: string;
  title: string;
  author: string;
  era: string;
  tradition: string;
  register: 'devotional' | 'exegetical' | 'confessional' | 'lexical' | 'topical';
  license: string;
  /** Render-ready credit line. Shown VERBATIM by the in-app Sources screen. */
  attribution: string;
}

export interface LibraryChunkRow {
  source_id: string;
  book?: string;          // lowercase OSIS, e.g. 'psa'
  chapter?: number;
  verse_start?: number;
  verse_end?: number;
  strongs?: string;
  topic?: string;
  heading: string;
  content: string;
  token_count: number;
}

export interface LibraryAdapter {
  sourceId: string;
  source: LibrarySourceRow;
  /** Versification tradition of the raw text; drives ref normalization. */
  scheme: VersificationScheme;
  /** Pure: raw file contents → chunk rows. Throws on malformed input it cannot skip. */
  parse(raw: string): LibraryChunkRow[];
}
