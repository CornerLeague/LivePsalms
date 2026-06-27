// src/notepad/bible/sentence-chunker.test.ts
import { describe, it, expect } from 'vitest';
import { createSentenceChunker } from './sentence-chunker';

describe('createSentenceChunker', () => {
  it('emits a chunk at a sentence boundary, holds a partial', () => {
    const c = createSentenceChunker();
    expect(c.push('Hello world. ')).toEqual(['Hello world. ']);
    expect(c.push('Half a sen')).toEqual([]);
    expect(c.push('tence? Next.')).toEqual(['Half a sentence? ']);
    expect(c.flush()).toBe('Next.');
  });

  it('breaks on a paragraph break', () => {
    const c = createSentenceChunker();
    expect(c.push('Para one\n\nPara two')).toEqual(['Para one\n\n']);
  });
});
