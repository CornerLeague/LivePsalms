// src/notepad/study/insights/seeded-prompts.test.ts
//
// The eight seeded prompts, and the rule they all have to keep: a reader-form
// reference, never an OSIS code.
//
// `displayRefs` exists because the model prints back whatever ref form it is
// handed, and "psa 27:2" reached a reader once already. These strings are
// written by us rather than by a model, which makes them easier to get right
// and just as easy to get wrong — the reference is composed in one place, and
// this is what says so.
import { describe, it, expect } from 'vitest';
import { INSIGHT_DOOR_VIEWS, insightPromptRef } from './insight-doors';
import { BIBLE_BOOKS } from '@/notepad/bible/bible-books';

/**
 * REFERENCE-AWARE, deliberately. The first draft of this check was a shape
 * regex — `\b[1-3]?[a-z]{2,3}\s+\d+` — and it flagged "…to understand **in 2**
 * Thessalonians 3?" as an OSIS leak. That is the same false positive the
 * harness's own `checkProperties` carried for months: a naive matcher scored
 * `rom 9:16` clean while `Romans 9:16` failed. Matching the actual abbreviation
 * list is what `checkDisplayRefs` does, and it is why "Job 1:1" never trips.
 */
const OSIS_CODES = BIBLE_BOOKS.map((b) => b.abbrev);
function findOsisLeak(text: string): string | null {
  for (const code of OSIS_CODES) {
    const re = new RegExp(`(^|[^a-z0-9])${code}\\s+\\d+`, 'i');
    if (re.test(text)) return code;
  }
  return null;
}

describe('insightPromptRef', () => {
  it('composes a chapter reference in reader form', () => {
    expect(insightPromptRef({ book: 'psa', chapter: 27, verse: null })).toEqual({
      passage: 'Psalm 27',
      book: 'Psalm',
      chapter: 27,
      verse: null,
    });
  });

  it('composes a verse reference in reader form', () => {
    expect(insightPromptRef({ book: 'psa', chapter: 27, verse: 4 }).passage).toBe('Psalm 27:4');
  });

  it('handles a numbered book', () => {
    expect(insightPromptRef({ book: '2th', chapter: 3, verse: null }).passage).toBe('2 Thessalonians 3');
  });

  it('falls back to the raw code rather than printing "undefined"', () => {
    // A book the table does not know is a bug elsewhere; it must not become a
    // sentence that reads "What is undefined 3 not saying?".
    expect(insightPromptRef({ book: 'zzz', chapter: 3, verse: null }).passage).toBe('zzz 3');
  });
});

describe('the seeded prompts', () => {
  const sections = INSIGHT_DOOR_VIEWS.flatMap((d) =>
    d.sections.map((s) => [`${d.id}/${s.key}`, s] as const),
  );

  it('covers every section of every generated door', () => {
    expect(sections.length).toBe(8);
    for (const [, s] of sections) expect(typeof s.seededPrompt).toBe('function');
  });

  it.each(sections)('%s reads as a question', (_id, section) => {
    const text = section.seededPrompt(insightPromptRef({ book: 'psa', chapter: 27, verse: null }));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.trim().endsWith('?')).toBe(true);
  });

  it.each(sections)('%s names the passage in READER form, never an OSIS code', (_id, section) => {
    for (const scope of [
      { book: 'psa', chapter: 27, verse: null },
      { book: 'psa', chapter: 27, verse: 4 },
      { book: '2th', chapter: 3, verse: null },
      { book: 'nam', chapter: 1, verse: null },
    ] as const) {
      const text = section.seededPrompt(insightPromptRef(scope));
      expect(findOsisLeak(text)).toBeNull();
    }
  });

  it('the leak check itself catches a real OSIS ref', () => {
    // A check that cannot fail is a check that proves nothing.
    expect(findOsisLeak('What is psa 27:4 not saying?')).toBe('psa');
    expect(findOsisLeak('What is Psalm 27:4 not saying?')).toBeNull();
    expect(findOsisLeak('…to understand in 2 Thessalonians 3?')).toBeNull();
  });

  it('gives the verse grain a verse-specific question where it names the passage', () => {
    // A reader who selected a verse and pressed a footer prompt must not get a
    // question about the whole chapter. Study chat grounds at chapter
    // granularity by design (design §1), so the verse rides in the words.
    const verse = insightPromptRef({ book: 'psa', chapter: 27, verse: 4 });
    const named = INSIGHT_DOOR_VIEWS
      .flatMap((d) => d.sections)
      .map((s) => s.seededPrompt(verse))
      .filter((t) => t.includes('Psalm 27:4'));
    expect(named.length).toBeGreaterThan(0);
  });

  it('is not simply its own section heading with a question mark', () => {
    // A footer prompt that restates the section above it is a dead end dressed
    // as a door. Cheap proxy: the prompt must not contain the whole heading.
    for (const door of INSIGHT_DOOR_VIEWS) {
      for (const s of door.sections) {
        const text = s.seededPrompt(insightPromptRef({ book: 'psa', chapter: 27, verse: null }));
        expect(text.toLowerCase()).not.toContain(s.label.toLowerCase());
      }
    }
  });
});
