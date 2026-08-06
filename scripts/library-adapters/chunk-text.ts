// scripts/library-adapters/chunk-text.ts
//
// Token-bounded splitter for library prose. Deliberately reuses the note
// chunker's MIN/MAX/estimate so the library and a user's notes land in the same
// embedding space with the same granularity — a retrieval comparing them should
// not be comparing a 90-token note chunk against a 3,000-token commentary dump.
//
// Verse-anchored chunking is the CALLER's job: an adapter splits on the source's
// own verse-range headings first, and only calls this when one of those sections
// is too big to embed well. That ordering is what keeps `library_chunks.book/
// chapter/verse_*` meaningful.

import { MIN_TOKENS, MAX_TOKENS, approxTokens } from '../../supabase/functions/_shared/chunker';

export interface TextChunk {
  text: string;
  tokenCount: number;
}

const PARAGRAPH_SPLIT = /\n\s*\n+/;
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/** Greedily pack pieces into <= MAX_TOKENS, flushing once past MIN_TOKENS. */
function pack(pieces: string[]): TextChunk[] {
  const out: TextChunk[] = [];
  let buffer = '';

  const flush = () => {
    const text = buffer.trim();
    if (text) out.push({ text, tokenCount: approxTokens(text) });
    buffer = '';
  };

  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const pieceTokens = approxTokens(trimmed);

    // A single piece over the ceiling is emitted alone; the caller has already
    // sentence-split by this point, so this is a genuinely unbreakable run.
    if (pieceTokens > MAX_TOKENS) {
      flush();
      out.push({ text: trimmed, tokenCount: pieceTokens });
      continue;
    }

    const bufferTokens = approxTokens(buffer);
    if (buffer && bufferTokens + pieceTokens > MAX_TOKENS) flush();
    buffer = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
    if (approxTokens(buffer) >= MIN_TOKENS && approxTokens(buffer) >= MAX_TOKENS) flush();
  }
  flush();
  return out;
}

/**
 * Split prose into embeddable chunks. Paragraph-grain first; any paragraph over
 * MAX_TOKENS is sentence-split before packing. Short input stays one chunk —
 * a two-sentence comment on a verse is a legitimate chunk, and padding it by
 * merging in the next verse's comment would blur the anchor.
 */
export function chunkText(raw: string): TextChunk[] {
  const text = raw.trim();
  if (!text) return [];

  const paragraphs = text.split(PARAGRAPH_SPLIT);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (approxTokens(trimmed) > MAX_TOKENS) {
      pieces.push(...trimmed.split(SENTENCE_SPLIT));
    } else {
      pieces.push(trimmed);
    }
  }
  return pack(pieces);
}

/**
 * The text actually handed to the embedder. Prefixing authorship and reference
 * is what lets a semantic hit carry its provenance into the ranking — a bare
 * paragraph of 1870s prose is much harder to place than the same paragraph
 * labelled "Charles H. Spurgeon, 1869–1885 — on Psalm 27:4".
 */
export function withEmbeddingPrefix(
  content: string,
  opts: { author: string; era: string; ref?: string },
): string {
  const where = opts.ref ? ` — on ${opts.ref}` : '';
  return `${opts.author}, ${opts.era}${where}:\n${content}`;
}
