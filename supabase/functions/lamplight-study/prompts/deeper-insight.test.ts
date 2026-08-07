import { describe, it, expect } from 'vitest';
import {
  DEEPER_DOOR_SPEC,
  DEEPER_INSIGHT_PROMPT,
  DEEPER_INSIGHT_SECTIONS,
  READ_WITH_CARE_KEY,
} from './deeper-insight.ts';
import { PASSAGE_INSIGHT_SECTIONS } from './passage-insight.ts';
import { ceilingFor } from './insight-door.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const KEYS = DEEPER_INSIGHT_SECTIONS.map((s) => s.key);

describe('DEEPER_INSIGHT_SECTIONS', () => {
  it('declares the parent design’s four sections, in reading order', () => {
    expect(KEYS).toEqual(['hermeneutics', 'historical_setting', 'theology', READ_WITH_CARE_KEY]);
  });

  it('collides with NO Door 1 section key', () => {
    // Migration 061 put `door` in the primary key, so a collision no longer
    // costs data. This is the second lock: two doors sharing a section name
    // would still be a reader-visible mess in the client's section registry,
    // and the constraint is free to keep.
    const door1 = new Set(PASSAGE_INSIGHT_SECTIONS.map((s) => s.key));
    for (const k of KEYS) expect(door1.has(k)).toBe(false);
  });

  it('gives every section a word target below its ceiling', () => {
    for (const s of DEEPER_INSIGHT_SECTIONS) {
      expect(s.minWords).toBeGreaterThan(0);
      expect(s.maxWords).toBeGreaterThan(s.minWords);
    }
  });

  it('keeps Read With Care the shortest section', () => {
    // Deliberate: it lists moves the passage does not support, and a long one is
    // a prompt to invent the fourth and fifth.
    const shortest = [...DEEPER_INSIGHT_SECTIONS].sort((a, b) => a.maxWords - b.maxWords)[0];
    expect(shortest.key).toBe(READ_WITH_CARE_KEY);
  });
});

describe('DEEPER_INSIGHT_PROMPT — the tool', () => {
  const props = (DEEPER_INSIGHT_PROMPT.tool.input_schema as {
    properties: Record<string, { type: string; minLength?: number; maxLength?: number }>;
    required: string[];
  });

  it('declares exactly the four sections plus citations', () => {
    expect(Object.keys(props.properties)).toEqual([...KEYS, 'citations']);
    expect(props.required).toEqual([...KEYS, 'citations']);
  });

  it('derives every ceiling from the word target — never hand-set', () => {
    for (const s of DEEPER_INSIGHT_SECTIONS) {
      expect(props.properties[s.key].maxLength).toBe(ceilingFor(s.maxWords));
    }
  });

  it('leaves every ceiling well clear of its target, so it stays a backstop', () => {
    // A ceiling the prompt can reach is a ceiling the prompt hits mid-word —
    // the 1400-char truncation, in one line.
    for (const s of DEEPER_INSIGHT_SECTIONS) {
      const ceiling = props.properties[s.key].maxLength!;
      expect(ceiling / (s.maxWords * 6.4)).toBeGreaterThan(1.4);
    }
  });

  it('allows every section to come back empty', () => {
    // Omission is first-class, and Door 2 will hit it more often than Door 1:
    // Historical & Cultural Setting on a one-line proverb, Read With Care on a
    // genealogy.
    for (const s of DEEPER_INSIGHT_SECTIONS) expect(props.properties[s.key].minLength).toBe(0);
  });
});

describe('DEEPER_INSIGHT_PROMPT — the system prompt', () => {
  const sys = DEEPER_INSIGHT_PROMPT.system;

  it('states a word target for every section by name', () => {
    // A bound with no target is the truncation bug. Both halves, every section.
    for (const s of DEEPER_INSIGHT_SECTIONS) {
      expect(sys).toContain(`${s.label} (${s.minWords}–${s.maxWords} words)`);
    }
  });

  it('carries the shared grounding rules rather than paraphrasing them', () => {
    expect(sys).toContain('The reader is owed the source of a reading, not an anonymous verdict.');
    expect(sys).toContain('Quoting a voice never widens the set of refs you may cite');
  });

  it('steers away from contested questions rather than toward them', () => {
    expect(sys).toContain('note that the question is disputed');
    expect(sys).toContain('do not adjudicate between them');
  });

  it('does NOT take study chat’s contested exemption', () => {
    // The single most consequential field on this module. Door 2 is
    // descriptive, generated once, and served to everyone from a shared cache.
    expect(DEEPER_INSIGHT_PROMPT.allowContestedRefs).toBeUndefined();
  });

  it('forbids aiming a Read With Care caution at a tradition or group (§9)', () => {
    expect(sys).toContain('Never aim a caution at a tradition, a denomination, or a group of Christians');
    expect(sys).toContain('never about who misreads it');
  });

  it('permits the four interpretive moves §9 names', () => {
    expect(sys).toContain('apart from the context');   // context-stripping
    expect(sys).toContain('etymology as its meaning'); // the root fallacy
    expect(sys).toContain('mistaking the genre');      // genre errors
    expect(sys).toContain('reading a modern situation back into a text'); // anachronism
  });

  it('requires an ungroundable caution to be omitted rather than reached for', () => {
    expect(sys).toContain('Leave the section empty rather than reaching for a plausible one');
  });

  it('declines to retell the passage', () => {
    // Actionable where "do not repeat Door 1" would not be: the model is never
    // shown Door 1, and a reader may open this door first.
    expect(sys).toContain('Do not summarise or retell the passage');
  });

  it('carries the shared length, omission and citation rules', () => {
    expect(sys).toContain('never break off mid-thought to fit');
    expect(sys).toContain('An empty section is a legitimate answer');
    expect(sys).toContain('In the citations array');
  });
});

describe('DEEPER_INSIGHT_PROMPT — buildMessages', () => {
  const ctx = {
    passageRef: 'Romans 9',
    passageText: '1 I speak the truth in Christ.',
    crossRefs: [{ ref: 'Exodus 33:19', text: 'I will have mercy on whom I have mercy.' }],
    notes: [],
    history: [],
    userMessage: '',
    allowedNoteIds: new Set<string>(),
    allowedVerseRefs: new Set(['Romans 9:1']),
    libraryExcerpts: [
      { chunkId: 'c1', sourceId: 'calvin-commentaries', sourceLabel: "Calvin's Commentaries · John Calvin, 1540–1564", heading: 'Romans 9:1', content: 'Paul opens with an oath.', score: 1 },
    ],
  } as unknown as BibleChatContext;

  it('sends one turn — the study grounding, and nothing else', () => {
    const msgs = DEEPER_INSIGHT_PROMPT.buildMessages(ctx);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('Passage: Romans 9');
    expect(msgs[0].content).toContain("Voices from the church's study");
    expect(msgs[0].content).toContain('John Calvin');
  });
});

describe('DEEPER_DOOR_SPEC', () => {
  it('is the door the migration 061 check constraint admits', () => {
    expect(DEEPER_DOOR_SPEC.id).toBe('deeper');
  });

  it('bundles this door’s prompt and sections', () => {
    expect(DEEPER_DOOR_SPEC.prompt).toBe(DEEPER_INSIGHT_PROMPT);
    expect(DEEPER_DOOR_SPEC.sections).toBe(DEEPER_INSIGHT_SECTIONS);
  });
});
