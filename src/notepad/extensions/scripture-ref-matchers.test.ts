import { describe, it, expect } from 'vitest';
import { matchReferenceBeforeCursor } from './scripture-ref-matchers';

describe('matchReferenceBeforeCursor', () => {
  it('matches a full reference at the end of text', () => {
    const m = matchReferenceBeforeCursor('I was reading John 3:16');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('John 3:16');
  });

  it('matches a book + chapter once a colon/verse digit appears', () => {
    const m = matchReferenceBeforeCursor('see Romans 8:2');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('Romans 8:2');
  });

  it('does NOT fire on a book word with no chapter digits', () => {
    expect(matchReferenceBeforeCursor('I read a book about John')).toBeNull();
  });

  it('does NOT fire mid-word (book name embedded in another word)', () => {
    expect(matchReferenceBeforeCursor('mark Marksman 3:1'.slice(0, 8))).toBeNull();
  });

  it('reports the start index so the suggestion range is correct', () => {
    const text = 'abc John 3:16';
    const m = matchReferenceBeforeCursor(text);
    expect(m!.from).toBe(4);
    expect(m!.to).toBe(text.length);
  });

  it('does NOT fire when a book name is a prefix of a longer word', () => {
    expect(matchReferenceBeforeCursor('Marksman 3:1')).toBeNull();
  });

  it('matches a verse range', () => {
    const m = matchReferenceBeforeCursor('John 3:16-18');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('John 3:16-18');
    expect(m!.from).toBe(0);
    expect(m!.to).toBe(12);
  });

  it('matches a numbered book reference', () => {
    const m = matchReferenceBeforeCursor('1 John 4:8');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('1 John 4:8');
    expect(m!.from).toBe(0);
  });
});
