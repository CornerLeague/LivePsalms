import { describe, it, expect } from 'vitest';
import {
  PASSAGE_INSIGHT_PROMPT,
  PASSAGE_INSIGHT_SECTIONS,
  ceilingFor,
  CHARS_PER_WORD,
} from './passage-insight.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

type ToolShape = {
  name: string;
  input_schema: {
    required: string[];
    properties: Record<string, { type: string; minLength: number; maxLength: number }> & {
      citations: { type: string; items: { properties: { type: { enum: string[] } } } };
    };
  };
};

const tool = PASSAGE_INSIGHT_PROMPT.tool as ToolShape;

const ctx = (over: Partial<BibleChatContext> = {}): BibleChatContext => ({
  passageRef: 'psa 27',
  passageText: '1 The LORD is my light and my salvation.',
  crossRefs: [{ ref: 'isa 40:31', text: 'They will renew their strength.' }],
  notes: [],
  history: [],
  userMessage: '',
  allowedNoteIds: new Set(),
  allowedVerseRefs: new Set(['psa 27:1', 'isa 40:31']),
  bookContext: {
    book: 'Psalms', author: 'David and others', authorNote: 'multiple authors',
    dateLabel: '~1000–400 BC', region: 'Israel', culturalContext: 'Temple worship',
    genre: 'Poetry', summary: 'The songbook of Israel.',
  },
  ...over,
});

describe('PASSAGE_INSIGHT_SECTIONS', () => {
  it('declares the four sections of Door 1, in reading order', () => {
    expect(PASSAGE_INSIGHT_SECTIONS.map((s) => s.key))
      .toEqual(['overview', 'in_chapter', 'chapter_shape', 'reflection']);
  });

  it('gives every section a word range, low before high', () => {
    for (const s of PASSAGE_INSIGHT_SECTIONS) {
      expect(s.minWords).toBeGreaterThan(0);
      expect(s.maxWords).toBeGreaterThan(s.minWords);
    }
  });
});

describe('ceilingFor', () => {
  // The 1400-char truncation happened because a ceiling existed with no target
  // below it. Deriving one from the other means they cannot drift apart later.
  it('leaves real headroom above the word target', () => {
    for (const s of PASSAGE_INSIGHT_SECTIONS) {
      const targetChars = s.maxWords * CHARS_PER_WORD;
      expect(ceilingFor(s.maxWords)).toBeGreaterThan(targetChars * 1.4);
    }
  });

  it('is measured, not guessed — 6.4 chars/word from real study prose', () => {
    // Mean over the four 2026-08-06 contested-exempt replies was 6.41.
    expect(CHARS_PER_WORD).toBeGreaterThanOrEqual(6);
    expect(CHARS_PER_WORD).toBeLessThanOrEqual(7);
  });

  it('grows with the target rather than being hand-set per section', () => {
    expect(ceilingFor(200)).toBeGreaterThan(ceilingFor(150));
  });
});

describe('PASSAGE_INSIGHT_PROMPT — the tool', () => {
  it('emits four named section fields, one per section — not one reply string', () => {
    expect(tool.name).toBe('emit_passage_insight');
    expect(tool.input_schema.required)
      .toEqual([...PASSAGE_INSIGHT_SECTIONS.map((s) => s.key), 'citations']);
  });

  it('carries a citations array, so the allowlist has something to check', () => {
    // Four prose fields and nothing else would leave `allowedVerseRefs`
    // unenforced — the validator works on a structured citations array, and
    // the cache row's `sources` column has nothing else to fill it.
    expect(tool.input_schema.properties.citations.type).toBe('array');
  });

  it('cites verses only — Door 1 is a public asset, with no reader’s notes in it', () => {
    expect(tool.input_schema.properties.citations.items.properties.type.enum).toEqual(['verse']);
  });

  it('bounds every field, with the ceiling derived from its target', () => {
    for (const s of PASSAGE_INSIGHT_SECTIONS) {
      const field = tool.input_schema.properties[s.key];
      expect(field.type).toBe('string');
      expect(field.maxLength).toBe(ceilingFor(s.maxWords));
    }
  });

  it('allows a section to come back empty — omission is a real answer', () => {
    // A section with no warrant in the grounding must be able to return '',
    // which a minLength above 0 would forbid.
    for (const s of PASSAGE_INSIGHT_SECTIONS) {
      expect(tool.input_schema.properties[s.key].minLength).toBe(0);
    }
  });
});

describe('PASSAGE_INSIGHT_PROMPT — the system prompt', () => {
  const system = PASSAGE_INSIGHT_PROMPT.system;

  it('states a word target for every section by name', () => {
    for (const s of PASSAGE_INSIGHT_SECTIONS) {
      expect(system).toContain(s.label);
      expect(system).toContain(`${s.minWords}–${s.maxWords} words`);
    }
  });

  it('tells the model to finish its sentences', () => {
    expect(system).toMatch(/[Ff]inish/);
  });

  it('says a section with nothing to say returns empty', () => {
    expect(system).toMatch(/empty/i);
  });

  it('inherits the study voice rather than restating it in new words', () => {
    // Drift between two hand-written copies of the same rule is how a
    // guardrail quietly stops matching the one it was meant to mirror.
    expect(system).toContain('never claim certainty you do not have');
    expect(system).toContain('only ever cite verses that appear in the supplied passage');
  });

  it('asks for the citations array it now declares', () => {
    // A declared field the prompt never mentions is a field the model fills
    // inconsistently — and an empty citations array validates vacuously.
    // Matched on the FIELD, not the bare word: STUDY_GROUNDING_RULES already
    // says "not citations", which would satisfy a looser assertion by accident.
    expect(system).toMatch(/citations array/i);
  });

  it('does NOT take study chat’s contested-passage exemption', () => {
    // Door 1 is descriptive, generated once, served to everyone — a different
    // risk posture from a reader asking a direct question.
    expect(PASSAGE_INSIGHT_PROMPT.allowContestedRefs).toBeUndefined();
  });
});

describe('PASSAGE_INSIGHT_PROMPT — buildMessages', () => {
  it('grounds on the passage, book context, and cross-references', () => {
    const [turn] = PASSAGE_INSIGHT_PROMPT.buildMessages(ctx());
    expect(turn.role).toBe('user');
    expect(turn.content).toContain('psa 27');
    expect(turn.content).toContain('Book context for Psalms');
    expect(turn.content).toContain('isa 40:31');
  });

  it('produces exactly one turn — there is no question and no history', () => {
    expect(PASSAGE_INSIGHT_PROMPT.buildMessages(ctx())).toHaveLength(1);
  });

  it('renders the focus verses at verse scope', () => {
    const [turn] = PASSAGE_INSIGHT_PROMPT.buildMessages(ctx({
      focusVerses: [
        { ref: 'psa 27:3', text: 'Though an army encamps against me.', isFocus: false },
        { ref: 'psa 27:4', text: 'One thing I have asked of the LORD.', isFocus: true },
        { ref: 'psa 27:5', text: 'For in the day of trouble He will hide me.', isFocus: false },
      ],
    }));
    expect(turn.content).toContain('One thing I have asked of the LORD.');
    expect(turn.content).toMatch(/psa 27:4/);
  });

  it('marks which verse is the focus, so "before and after" means something', () => {
    const [turn] = PASSAGE_INSIGHT_PROMPT.buildMessages(ctx({
      focusVerses: [
        { ref: 'psa 27:3', text: 'Before.', isFocus: false },
        { ref: 'psa 27:4', text: 'The verse itself.', isFocus: true },
      ],
    }));
    const focusLine = turn.content.split('\n').find((l) => l.includes('The verse itself.'))!;
    const beforeLine = turn.content.split('\n').find((l) => l.includes('Before.'))!;
    expect(focusLine).not.toBe(beforeLine);
    expect(focusLine.length).toBeGreaterThan(beforeLine.length - 40);   // the focus carries a marker
    expect(turn.content).toMatch(/focus|selected/i);
  });

  it('omits the focus block entirely at chapter scope', () => {
    const [turn] = PASSAGE_INSIGHT_PROMPT.buildMessages(ctx());
    expect(turn.content).not.toMatch(/focus|selected/i);
  });

  it('carries a version', () => {
    expect(PASSAGE_INSIGHT_PROMPT.promptVersion).toMatch(/^passage-insight-/);
  });
});
