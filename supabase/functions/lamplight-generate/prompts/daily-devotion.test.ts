import { describe, it, expect } from 'vitest';
import { DAILY_DEVOTION_PROMPT } from './daily-devotion.ts';
import type { DailyDevotionContext } from '../daily-devotion-pipeline.ts';
import type { LibraryExcerpt } from '../../_shared/library-retrieval.ts';

const EXCERPTS: LibraryExcerpt[] = [
  {
    chunkId: 'lc1', sourceId: 'treasury-of-david',
    sourceLabel: 'The Treasury of David · Charles H. Spurgeon, 1869–1885',
    heading: 'Psalm 23:4',
    content: 'The valley is a place of passage, not of dwelling.',
    score: 0.9,
  },
];

function ctx(over: Partial<DailyDevotionContext> = {}): DailyDevotionContext {
  return {
    notes: [{ id: 'note-1', title: 'On rest', plaintext: 'I have been weary lately.' }],
    passages: [{
      source_id: 'psa.23.4',
      text: 'Even though I walk through the valley…',
      ref: 'Psalm 23:4',
      metadata: { book: 'Psalm', chapter: 23 },
    }],
    localDate: '2026-08-06',
    firstName: null,
    allowedNoteIds: new Set(['note-1']),
    allowedVerseRefs: new Set(['Psalm 23:4']),
    rerankUsed: false,
    ...over,
  };
}

describe('DAILY_DEVOTION_PROMPT', () => {
  it('bumps the prompt version for the library excerpts block', () => {
    expect(DAILY_DEVOTION_PROMPT.promptVersion).toBe('daily-devotion-2026-08-06-v4');
  });

  it('renders the study-excerpts block when excerpts are supplied', () => {
    const content = DAILY_DEVOTION_PROMPT.buildMessages(ctx({ libraryExcerpts: EXCERPTS }))[0].content;
    expect(content).toContain('Study excerpts (do not name these authors in the devotion):');
    expect(content).toContain('The valley is a place of passage, not of dwelling.');
    expect(content).toContain('The Treasury of David · Charles H. Spurgeon, 1869–1885');
  });

  it('omits the block entirely when excerpts are empty or absent', () => {
    for (const c of [ctx(), ctx({ libraryExcerpts: [] })]) {
      expect(DAILY_DEVOTION_PROMPT.buildMessages(c)[0].content).not.toContain('Study excerpts');
    }
  });

  it('renders identically with no library as with an explicitly empty one', () => {
    expect(DAILY_DEVOTION_PROMPT.buildMessages(ctx())[0].content)
      .toBe(DAILY_DEVOTION_PROMPT.buildMessages(ctx({ libraryExcerpts: [] }))[0].content);
  });

  it('keeps the notes, passages, and allowed-ref instructions around the new block', () => {
    const content = DAILY_DEVOTION_PROMPT.buildMessages(ctx({ libraryExcerpts: EXCERPTS }))[0].content;
    expect(content).toContain("User's recent notes:");
    expect(content).toContain('Candidate Scripture passages:');
    expect(content).toContain('Cite Scripture using exactly one of: Psalm 23:4');
    expect(content).toContain('Write the devotion now.');
  });

  it('tells the model to draw substance from the excerpts without naming or quoting the authors', () => {
    const system = DAILY_DEVOTION_PROMPT.system;
    expect(system).toMatch(/study excerpts/i);
    expect(system).toMatch(/do not name|never name|without naming/i);
    expect(system).toMatch(/provenance panel/i);
  });

  it('does not let an excerpt widen the citable refs', () => {
    const system = DAILY_DEVOTION_PROMPT.system;
    expect(system).toContain('Do not invent refs.');
    expect(system).toMatch(/excerpts?.*(are not|never).*cit/i);
  });
});
