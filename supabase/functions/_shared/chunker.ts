// Paragraph-grain chunker for note plaintext. Pure: no Deno/Node globals.
// Imported by the Edge Function and (potentially) test runners.

export const MIN_TOKENS = 100;
export const MAX_TOKENS = 600;
const CHARS_PER_TOKEN = 4; // crude but consistent across client and server

export interface NoteChunk {
  index: number;       // 0-based, dense within the chunk array
  text: string;        // exact text sent to Voyage; also stored as chunk_text
  tokenCount: number;  // estimated via ceil(len / CHARS_PER_TOKEN)
}

// Exported so the library ingest (scripts/library-adapters/chunk-text.ts) sizes
// its chunks with the SAME estimator notes use — retrieval compares the two
// corpora against each other, so a divergent estimate would skew granularity.
export function approxTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function sentenceSplit(text: string): string[] {
  // Split on sentence-final punctuation followed by whitespace.
  // Keeps the punctuation attached to the preceding sentence.
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

// Greedily pack sentences into chunks of <= MAX_TOKENS. A sentence that itself
// exceeds MAX_TOKENS is emitted on its own (Voyage truncation: true handles
// the wire-level overflow).
function packSentences(sentences: string[]): string[] {
  const out: string[] = [];
  let buffer = '';
  let bufferTokens = 0;

  for (const s of sentences) {
    const sTokens = approxTokens(s);
    if (sTokens > MAX_TOKENS) {
      if (buffer) { out.push(buffer); buffer = ''; bufferTokens = 0; }
      out.push(s);
      continue;
    }
    if (bufferTokens + sTokens > MAX_TOKENS && buffer) {
      out.push(buffer);
      buffer = s;
      bufferTokens = sTokens;
    } else {
      buffer = buffer ? `${buffer} ${s}` : s;
      bufferTokens += sTokens;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

export function chunkNotePlaintext(plaintext: string): NoteChunk[] {
  // 1. Split on \n\n+, trim, drop empties.
  const paragraphs = plaintext
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  if (paragraphs.length === 0) return [];

  // 2. Greedy merge + over-cap sentence split.
  const rawChunks: string[] = [];
  let buffer = '';
  let bufferTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = approxTokens(para);

    if (paraTokens > MAX_TOKENS) {
      // Flush buffer, then emit sentence-packed chunks for this paragraph.
      if (buffer) { rawChunks.push(buffer); buffer = ''; bufferTokens = 0; }
      for (const c of packSentences(sentenceSplit(para))) rawChunks.push(c);
      continue;
    }

    if (bufferTokens === 0) {
      buffer = para;
      bufferTokens = paraTokens;
      continue;
    }

    // Buffer non-empty.
    if (bufferTokens < MIN_TOKENS && bufferTokens + paraTokens <= MAX_TOKENS) {
      // Merge.
      buffer = `${buffer}\n\n${para}`;
      bufferTokens += paraTokens;
    } else {
      // Flush + start new.
      rawChunks.push(buffer);
      buffer = para;
      bufferTokens = paraTokens;
    }
  }
  if (buffer) rawChunks.push(buffer);

  return rawChunks.map((text, index) => ({
    index,
    text,
    tokenCount: approxTokens(text),
  }));
}
