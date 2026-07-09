// supabase/functions/etymology-insight/prompts/verse-insight.test.ts
import { describe, it, expect } from 'vitest';
import { VERSE_INSIGHT_PROMPT, VERSE_INSIGHT_PROMPT_VERSION } from './verse-insight';

describe('VERSE_INSIGHT_PROMPT', () => {
  it('forces the emit tool and grounds messages on the entry facts + verse text', () => {
    expect(VERSE_INSIGHT_PROMPT.tool.name).toBe('emit_verse_insight');
    expect(VERSE_INSIGHT_PROMPT.promptVersion).toBe(VERSE_INSIGHT_PROMPT_VERSION);
    const msgs = VERSE_INSIGHT_PROMPT.buildMessages({
      reference: 'Psalm 23:1', verseText: 'The LORD is my shepherd; I shall not want.',
      lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend, graze',
      development: 'From tending a flock…', related: [{ word: 'רֹעֶה', gloss: 'shepherd' }],
    });
    const content = msgs[0].content;
    expect(content).toContain('Psalm 23:1');
    expect(content).toContain('רעה');            // root is present as grounding
    expect(content).toContain('shepherd');       // related gloss is present
    expect(VERSE_INSIGHT_PROMPT.system).toMatch(/never|only|invent/i); // never-invent discipline
  });
});
