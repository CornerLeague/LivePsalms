import { describe, it, expect } from 'vitest';
import { matchReferenceBeforeCursor, matchVersePickerBeforeCursor, matchLookupPickerBeforeCursor } from './scripture-ref-matchers';

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

describe('matchVersePickerBeforeCursor', () => {
  it('matches the bare /verse command (start of line)', () => {
    const m = matchVersePickerBeforeCursor('/verse');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('verse');
    expect(m!.from).toBe(0);
  });

  it('matches /verse followed by keywords (spaces allowed)', () => {
    const m = matchVersePickerBeforeCursor('/verse love your enemies');
    expect(m!.query).toBe('verse love your enemies');
    expect(m!.from).toBe(0);
  });

  it('matches /verse with a trailing space before keywords are typed', () => {
    const m = matchVersePickerBeforeCursor('/verse ');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('verse ');
  });

  it('matches /verse after whitespace mid-paragraph', () => {
    const text = 'note: /verse grace';
    const m = matchVersePickerBeforeCursor(text);
    expect(m!.query).toBe('verse grace');
    expect(m!.from).toBe(6);
    expect(m!.to).toBe(text.length);
  });

  it('does NOT fire on other slash words', () => {
    expect(matchVersePickerBeforeCursor('/todo')).toBeNull();
    expect(matchVersePickerBeforeCursor('note /h')).toBeNull();
  });

  it('does NOT fire on words that merely start with verse', () => {
    expect(matchVersePickerBeforeCursor('/versed')).toBeNull();
    expect(matchVersePickerBeforeCursor('/verses')).toBeNull();
    expect(matchVersePickerBeforeCursor('/verselove')).toBeNull();
  });

  it('does NOT fire mid-word (slash embedded after a non-space char)', () => {
    expect(matchVersePickerBeforeCursor('and/verse')).toBeNull();
  });
});

describe('matchLookupPickerBeforeCursor', () => {
  it('matches the bare /lookup command', () => {
    const m = matchLookupPickerBeforeCursor('/lookup');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('lookup');
    expect(m!.from).toBe(0);
  });

  it('matches /lookup followed by keywords (spaces allowed)', () => {
    const m = matchLookupPickerBeforeCursor('/lookup these are the words');
    expect(m!.query).toBe('lookup these are the words');
  });

  it('matches /lookup after whitespace mid-paragraph', () => {
    const text = 'note: /lookup grace';
    const m = matchLookupPickerBeforeCursor(text);
    expect(m!.query).toBe('lookup grace');
    expect(m!.from).toBe(6);
    expect(m!.to).toBe(text.length);
  });

  it('does NOT fire on other slash words or on /verse', () => {
    expect(matchLookupPickerBeforeCursor('/verse')).toBeNull();
    expect(matchLookupPickerBeforeCursor('/todo')).toBeNull();
  });

  it('does NOT fire on words that merely start with lookup', () => {
    expect(matchLookupPickerBeforeCursor('/lookups')).toBeNull();
    expect(matchLookupPickerBeforeCursor('/lookuplove')).toBeNull();
  });

  it('does NOT fire mid-word', () => {
    expect(matchLookupPickerBeforeCursor('and/lookup')).toBeNull();
  });
});
