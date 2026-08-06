import { describe, it, expect } from 'vitest';
import { chunkText, withEmbeddingPrefix } from './chunk-text';
import { MAX_TOKENS, approxTokens } from '../../supabase/functions/_shared/chunker';

// ~4 chars/token, so 40 chars ≈ 10 tokens.
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const paragraph = (n: number) => `${words(n)}.`;

describe('chunkText', () => {
  it('returns nothing for blank input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps a short comment as ONE chunk rather than padding it', () => {
    const out = chunkText('The Lord is my light. Whom then shall I fear?');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('The Lord is my light. Whom then shall I fear?');
    expect(out[0].tokenCount).toBeGreaterThan(0);
  });

  it('packs several small paragraphs together', () => {
    const out = chunkText([paragraph(20), paragraph(20), paragraph(20)].join('\n\n'));
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('word0');
  });

  it('splits past the ceiling and keeps every chunk within bounds', () => {
    // ~5000 tokens of paragraphs
    const big = Array.from({ length: 40 }, () => paragraph(120)).join('\n\n');
    const out = chunkText(big);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.tokenCount).toBeLessThanOrEqual(MAX_TOKENS);
    }
  });

  it('sentence-splits a single oversize paragraph instead of emitting one huge chunk', () => {
    const runOn = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} carries a little weight.`).join(' ');
    expect(approxTokens(runOn)).toBeGreaterThan(MAX_TOKENS);
    const out = chunkText(runOn);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.tokenCount).toBeLessThanOrEqual(MAX_TOKENS);
  });

  it('reports a token count consistent with the shared estimator', () => {
    const out = chunkText(paragraph(30));
    expect(out[0].tokenCount).toBe(approxTokens(out[0].text));
  });

  it('loses no words across a split', () => {
    const big = Array.from({ length: 30 }, (_, i) => `Para ${i} ${words(80)}.`).join('\n\n');
    const out = chunkText(big);
    const joined = out.map((c) => c.text).join(' ');
    for (let i = 0; i < 30; i++) expect(joined).toContain(`Para ${i}`);
  });
});

describe('withEmbeddingPrefix', () => {
  it('carries author, era, and ref into the embedded text', () => {
    const out = withEmbeddingPrefix('Body of the note.', {
      author: 'Charles H. Spurgeon', era: '1869–1885', ref: 'Psalm 27:4',
    });
    expect(out).toBe('Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:\nBody of the note.');
  });

  it('omits the ref clause for unanchored sources (creeds, topics)', () => {
    const out = withEmbeddingPrefix('We believe…', { author: 'Westminster Assembly', era: '1646' });
    expect(out).toBe('Westminster Assembly, 1646:\nWe believe…');
  });
});
