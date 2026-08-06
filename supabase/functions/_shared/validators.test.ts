import { describe, it, expect } from 'vitest';
import {
  validateCitations,
  applyContentRules,
  flattenArtifactText,
  type ArtifactSection,
} from './validators';
import { BANNED_PHRASES, CONTESTED_PASSAGES, GROWTH_BANNED_PHRASES } from './voice';

function makeArtifact(overrides: Partial<{ opening: string; sections: ArtifactSection[] }> = {}) {
  return {
    opening: 'A short opening grounded in the user\'s notes.',
    sections: [
      {
        heading: 'Anchor',
        body: 'Psalm 23 may speak to the weariness you have described.',
        citations: [{ type: 'verse', ref: 'Psalm 23:4' } as const],
      },
    ],
    ...overrides,
  };
}

describe('flattenArtifactText', () => {
  it('concatenates opening + every section heading + body with double newlines', () => {
    const art = makeArtifact({
      sections: [
        { heading: 'H1', body: 'B1', citations: [{ type: 'verse', ref: 'Ps 1:1' }] },
        { heading: 'H2', body: 'B2', citations: [{ type: 'verse', ref: 'Ps 2:1' }] },
      ],
    });
    expect(flattenArtifactText(art)).toContain('H1');
    expect(flattenArtifactText(art)).toContain('B1');
    expect(flattenArtifactText(art)).toContain('H2');
    expect(flattenArtifactText(art)).toContain('B2');
    expect(flattenArtifactText(art).split('\n\n').length).toBeGreaterThanOrEqual(4); // opening + 2*(heading+body) at least
  });
});

describe('validateCitations', () => {
  const allowedNoteIds = new Set(['note-1', 'note-2']);
  const allowedVerseRefs = new Set(['Psalm 23:4', 'Romans 8:28']);

  it('passes when every section has at least one resolvable citation', () => {
    const art = makeArtifact();
    const r = validateCitations(art, { allowedNoteIds, allowedVerseRefs });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags a section with zero citations', () => {
    const art = makeArtifact({
      sections: [{ heading: 'H', body: 'B', citations: [] }],
    });
    const r = validateCitations(art, { allowedNoteIds, allowedVerseRefs });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ section_index: 0, reason: 'no_citations' });
  });

  it('flags a verse citation not in the allowed set', () => {
    const art = makeArtifact({
      sections: [{
        heading: 'H', body: 'B',
        citations: [{ type: 'verse', ref: 'Habakkuk 3:17' }],
      }],
    });
    const r = validateCitations(art, { allowedNoteIds, allowedVerseRefs });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ section_index: 0, reason: 'unknown_verse' });
  });

  it('flags a note citation not in the allowed set', () => {
    const art = makeArtifact({
      sections: [{
        heading: 'H', body: 'B',
        citations: [{ type: 'note', ref: 'note-99' }],
      }],
    });
    const r = validateCitations(art, { allowedNoteIds, allowedVerseRefs });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ section_index: 0, reason: 'unknown_note' });
  });

  it('does case-normalized matching on verse refs', () => {
    const art = makeArtifact({
      sections: [{
        heading: 'H', body: 'B',
        citations: [{ type: 'verse', ref: 'psalm 23:4' }],
      }],
    });
    const r = validateCitations(art, { allowedNoteIds, allowedVerseRefs });
    expect(r.ok).toBe(true);
  });
});

describe('applyContentRules', () => {
  const baseRules = {
    banned: BANNED_PHRASES,
    contested: CONTESTED_PASSAGES,
    growth: GROWTH_BANNED_PHRASES,
  };

  it('passes a clean reflective text', async () => {
    const r = await applyContentRules(
      'Scripture suggests that rest is a gift. Psalm 23 may speak to your weariness.',
      baseRules,
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags banned prophetic language', async () => {
    const r = await applyContentRules('God is telling you to forgive him.', baseRules);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.family === 'banned')).toBe(true);
  });

  it('flags every BANNED_PHRASES rule when its canonical sample is present', async () => {
    const samples = [
      'God is telling you to rest.',
      'The Lord told you to wait.',
      'The Lord is giving you a word.',
      'God says to you: be still.',
      'The Spirit is saying to you.',
      'I sense God is calling you.',
      'God revealed to you the next step.',
      'A prophetic word over you.',
      'Your destiny is greater than this.',
    ];
    for (const s of samples) {
      const r = await applyContentRules(s, baseRules);
      expect(r.ok, `expected banned-phrase to be caught: "${s}"`).toBe(false);
      expect(r.violations.some(v => v.family === 'banned')).toBe(true);
    }
  });

  it('flags contested passages mentioned by ref', async () => {
    const r = await applyContentRules(
      'On Romans 9:11 specifically, Paul argues that election rests on God\'s purpose.',
      baseRules,
    );
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.family === 'contested')).toBe(true);
  });

  it('flags growth/streak language', async () => {
    const samples = [
      '14-day streak achieved.',
      "Don't break your streak.",
      'You missed yesterday — get back on track.',
    ];
    for (const s of samples) {
      const r = await applyContentRules(s, baseRules);
      expect(r.ok, `growth phrase missed: "${s}"`).toBe(false);
      expect(r.violations.some(v => v.family === 'growth')).toBe(true);
    }
  });

  it('returns an 80-char snippet around each violation', async () => {
    const text = 'Here is a long preamble before the bad part. God is telling you to give. And then more text follows after the violation, which should also appear in the snippet for context.';
    const r = await applyContentRules(text, baseRules);
    expect(r.ok).toBe(false);
    expect(r.violations[0].snippet.length).toBeLessThanOrEqual(120); // 80 + match length
    expect(r.violations[0].snippet).toContain('God is telling you');
  });

  it('invokes the optional classifier slot when supplied', async () => {
    const r = await applyContentRules('clean text', {
      ...baseRules,
      classifier: async () => [{ family: 'banned', rule: 'classifier-rule', snippet: 'x' }],
    });
    expect(r.ok).toBe(false);
    expect(r.violations[0].rule).toBe('classifier-rule');
  });
});

import { validateDailyDevotionCitations, flattenDailyDevotionText } from './validators';
import type { DailyDevotion } from './artifacts';

function makeDevotion(overrides: Partial<DailyDevotion> = {}): DailyDevotion {
  return {
    opening: 'A quiet greeting.',
    scripture: { ref: 'Psalm 23:4', text: 'Even though I walk through the valley…' },
    reflection: 'This passage may speak to weariness.',
    prompt: 'What part of this verse reaches you today?',
    note_citations: [{ note_id: 'note-1', reason: 'recurrence of rest' }],
    ...overrides,
  };
}

describe('validateDailyDevotionCitations', () => {
  const allowed = {
    allowedNoteIds: new Set(['note-1', 'note-2']),
    allowedVerseRefs: new Set(['Psalm 23:4']),
  };

  it('passes a clean devotion', () => {
    const result = validateDailyDevotionCitations(makeDevotion(), allowed);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when scripture.ref is unknown', () => {
    const result = validateDailyDevotionCitations(
      makeDevotion({ scripture: { ref: 'Made Up 1:1', text: 'fake' } }),
      allowed,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toBe('unknown_verse');
  });

  it('fails when a note_id is outside allowedNoteIds', () => {
    const result = validateDailyDevotionCitations(
      makeDevotion({ note_citations: [{ note_id: 'note-X', reason: 'stranger' }] }),
      allowed,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toBe('unknown_note');
  });

  it('fails when note_citations is empty', () => {
    const result = validateDailyDevotionCitations(
      makeDevotion({ note_citations: [] }),
      allowed,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toBe('no_citations');
  });

  it('is case-insensitive for verse refs', () => {
    const result = validateDailyDevotionCitations(
      makeDevotion({ scripture: { ref: 'psalm 23:4', text: 't' } }),
      allowed,
    );
    expect(result.ok).toBe(true);
  });
});

describe('flattenDailyDevotionText', () => {
  it('concatenates opening + scripture.text + reflection + prompt with double newlines', () => {
    const out = flattenDailyDevotionText(makeDevotion());
    expect(out).toContain('A quiet greeting.');
    expect(out).toContain('Even though I walk');
    expect(out).toContain('This passage may speak');
    expect(out).toContain('What part of this verse');
    expect(out.split('\n\n')).toHaveLength(4);
  });
});

import {
  validateConnectionWhyShape,
  flattenConnectionWhyText,
  type ConnectionWhyArtifact,
} from './validators';

describe('validateConnectionWhyShape', () => {
  it('accepts a 24-word string', () => {
    const artifact: ConnectionWhyArtifact = {
      why: 'word '.repeat(24).trim(),
    };
    const result = validateConnectionWhyShape(artifact);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a 25-word string with word_count_exceeded', () => {
    const artifact: ConnectionWhyArtifact = {
      why: 'word '.repeat(25).trim(),
    };
    const result = validateConnectionWhyShape(artifact);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === 'word_count_exceeded')).toBe(true);
  });

  it('rejects an empty/whitespace-only string with empty rule', () => {
    const artifact: ConnectionWhyArtifact = { why: '   ' };
    const result = validateConnectionWhyShape(artifact);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === 'empty')).toBe(true);
  });

  it('rejects non-string why with not_string rule', () => {
    const artifact = { why: 42 } as unknown as ConnectionWhyArtifact;
    const result = validateConnectionWhyShape(artifact);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === 'not_string')).toBe(true);
  });
});

describe('flattenConnectionWhyText', () => {
  it('returns the why string verbatim', () => {
    const artifact: ConnectionWhyArtifact = { why: 'hello world' };
    expect(flattenConnectionWhyText(artifact)).toBe('hello world');
  });
});

import { nameMentionCount, applyNameRules, validateChatReplyCitations, expandVerseRange } from './validators';

function makeDailyDevotion(over: Partial<DailyDevotion> = {}): DailyDevotion {
  return {
    opening: 'A quiet thought for today, drawn from your recent notes.',
    scripture: { ref: 'Psalm 23:4', text: 'Even though I walk through the valley…' },
    reflection: 'The passage may speak to what you have been carrying. It often reads to those walking through grief as…',
    prompt: 'What is the valley today, and where is the rod?',
    note_citations: [{ note_id: 'n1', reason: 'recurring grief theme' }],
    ...over,
  };
}

describe('nameMentionCount', () => {
  it('returns 0 when name not present', () => {
    expect(nameMentionCount('Hello world.', 'Sarah')).toBe(0);
  });

  it('returns count of word-boundary matches', () => {
    expect(nameMentionCount('Sarah said hello. Sarah laughed.', 'Sarah')).toBe(2);
  });

  it('does not count partial matches', () => {
    // "Sarahs" should NOT match "Sarah" with \b.
    expect(nameMentionCount('Sarahs went home', 'Sarah')).toBe(0);
  });

  it('is case-sensitive (matches "Sarah" but not "sarah")', () => {
    expect(nameMentionCount('Sarah and sarah.', 'Sarah')).toBe(1);
  });

  it('escapes regex special chars in name', () => {
    // "Anne-Marie" — hyphen is literal in regex, but verify no crash and correct count.
    expect(nameMentionCount('Anne-Marie waited. Anne-Marie sang.', 'Anne-Marie')).toBe(2);
  });

  it('counts diacritic-ending name across word boundaries', () => {
    expect(nameMentionCount('José walked. Then José ran.', 'José')).toBe(2);
  });

  it('does not count partial match on diacritic name', () => {
    expect(nameMentionCount('Josése went home', 'José')).toBe(0);
  });
});

describe('applyNameRules', () => {
  it('returns no violations when firstName is null and opening has no salutation', () => {
    const artifact = makeDailyDevotion({ opening: 'A quiet thought for today.' });
    expect(applyNameRules({ artifact, firstName: null })).toEqual([]);
  });

  it('returns no violations when firstName is present and used exactly once in opening', () => {
    const artifact = makeDailyDevotion({
      opening: 'Sarah — a quiet thought for today.',
      reflection: 'The passage may speak to what you have been carrying. It often reads as…',
    });
    expect(applyNameRules({ artifact, firstName: 'Sarah' })).toEqual([]);
  });

  it('returns no violations when firstName is used twice total (opening + reflection)', () => {
    const artifact = makeDailyDevotion({
      opening: 'Sarah — a quiet thought for today.',
      reflection: 'The passage may speak, Sarah, to what you have been carrying.',
    });
    expect(applyNameRules({ artifact, firstName: 'Sarah' })).toEqual([]);
  });

  it('flags name_overuse when firstName appears more than twice', () => {
    const artifact = makeDailyDevotion({
      opening: 'Sarah — a quiet thought for today.',
      reflection: 'Sarah, this passage may speak to you. Sarah, scripture often offers…',
      prompt: 'Sarah, what is the valley?',
    });
    const violations = applyNameRules({ artifact, firstName: 'Sarah' });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ family: 'name', rule: 'name_overuse' });
  });

  it('flags spurious_salutation when firstName is null and opening begins with a vocative pattern', () => {
    const artifact = makeDailyDevotion({
      opening: 'Sarah — a quiet thought for today.',
    });
    const violations = applyNameRules({ artifact, firstName: null });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ family: 'name', rule: 'spurious_salutation' });
  });

  it('does NOT flag spurious_salutation when firstName is null and opening starts naturally', () => {
    const artifact = makeDailyDevotion({
      opening: 'A quiet thought for today, drawn from your notes.',
    });
    expect(applyNameRules({ artifact, firstName: null })).toEqual([]);
  });

  it('handles diacritic name correctly', () => {
    const artifact = makeDailyDevotion({
      opening: 'José — a quiet thought.',
      reflection: 'The passage may speak. José, scripture offers…',
    });
    expect(applyNameRules({ artifact, firstName: 'José' })).toEqual([]);
  });

  it('flags name_overuse for diacritic name appearing more than twice', () => {
    const artifact = makeDailyDevotion({
      opening: 'José — a quiet thought.',
      reflection: 'José, the passage may speak. José, scripture offers…',
    });
    const violations = applyNameRules({ artifact, firstName: 'José' });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ family: 'name', rule: 'name_overuse' });
  });
});

describe('validateChatReplyCitations', () => {
  const allowed = {
    allowedNoteIds: new Set(['note-1']),
    allowedVerseRefs: new Set(['jhn 10:11']),
  };

  it('passes a reply with zero citations', () => {
    const r = validateChatReplyCitations({ reply: 'A short answer.', citations: [] }, allowed);
    expect(r.ok).toBe(true);
  });

  it('passes valid note + verse citations (verse case-insensitive)', () => {
    const r = validateChatReplyCitations(
      { reply: 'x', citations: [{ type: 'note', ref: 'note-1' }, { type: 'verse', ref: 'John 10:11'.toLowerCase() === 'jhn 10:11' ? 'jhn 10:11' : 'JHN 10:11' }] },
      allowed,
    );
    expect(r.ok).toBe(true);
  });

  it('flags an unknown note', () => {
    const r = validateChatReplyCitations({ reply: 'x', citations: [{ type: 'note', ref: 'ghost' }] }, allowed);
    expect(r.ok).toBe(false);
    expect(r.violations[0].reason).toBe('unknown_note');
  });

  it('flags an unknown verse', () => {
    const r = validateChatReplyCitations({ reply: 'x', citations: [{ type: 'verse', ref: 'gen 1:1' }] }, allowed);
    expect(r.ok).toBe(false);
    expect(r.violations[0].reason).toBe('unknown_verse');
  });
});

describe('expandVerseRange', () => {
  it('splits a same-chapter range', () => {
    expect(expandVerseRange('heb 11:7-9')).toEqual(['heb 11:7', 'heb 11:8', 'heb 11:9']);
  });

  it('accepts the dashes the model actually emits', () => {
    expect(expandVerseRange('rom 9:11–12')).toEqual(['rom 9:11', 'rom 9:12']);   // en dash
    expect(expandVerseRange('rom 9:11—12')).toEqual(['rom 9:11', 'rom 9:12']);   // em dash
  });

  it('handles a multi-word book name', () => {
    expect(expandVerseRange('1 Corinthians 11:2-3')).toEqual(['1 Corinthians 11:2', '1 Corinthians 11:3']);
  });

  it('returns null for a single verse', () => {
    expect(expandVerseRange('psa 27:4')).toBeNull();
  });

  it('returns null for a cross-chapter span — resolving it needs chapter lengths', () => {
    expect(expandVerseRange('rom 9:30-10:4')).toBeNull();
  });

  it('returns null for a reversed or absurd span', () => {
    expect(expandVerseRange('psa 27:9-4')).toBeNull();
    expect(expandVerseRange('psa 119:1-176')).toBeNull();
  });
});

describe('validateChatReplyCitations — verse ranges', () => {
  // The 2026-08-06 study-chat eval: giving replies room to breathe made them
  // cite spans, and every span was rejected even though the whole chapter had
  // been supplied a verse at a time.
  const chapter = {
    allowedNoteIds: new Set<string>(),
    allowedVerseRefs: new Set(['heb 11:7', 'heb 11:8', 'heb 11:9', 'heb 11:10', 'heb 11:11']),
  };

  it('accepts a range whose every verse was supplied', () => {
    const r = validateChatReplyCitations({ reply: 'x', citations: [{ type: 'verse', ref: 'heb 11:7-11' }] }, chapter);
    expect(r.ok).toBe(true);
  });

  it('accepts an en-dash range too', () => {
    const r = validateChatReplyCitations({ reply: 'x', citations: [{ type: 'verse', ref: 'heb 11:8–10' }] }, chapter);
    expect(r.ok).toBe(true);
  });

  it('rejects a range that reaches past what was supplied, and names the gap', () => {
    const r = validateChatReplyCitations({ reply: 'x', citations: [{ type: 'verse', ref: 'heb 11:9-13' }] }, chapter);
    expect(r.ok).toBe(false);
    expect(r.violations[0].detail).toContain('heb 11:12, heb 11:13');
  });

  it('still rejects a single verse that was never supplied', () => {
    const r = validateChatReplyCitations({ reply: 'x', citations: [{ type: 'verse', ref: 'heb 12:1' }] }, chapter);
    expect(r.ok).toBe(false);
    expect(r.violations[0].detail).toContain('is not in the retrieved passages');
  });

  it('does not let a range widen the allowlist — a cross-ref verse stays a single verse', () => {
    // isa 40:31 arrives as a cross-reference: only that verse's text was
    // supplied, so a span around it must not be accepted.
    const withCrossRef = {
      allowedNoteIds: new Set<string>(),
      allowedVerseRefs: new Set(['psa 27:1', 'isa 40:31']),
    };
    const r = validateChatReplyCitations({ reply: 'x', citations: [{ type: 'verse', ref: 'isa 40:29-31' }] }, withCrossRef);
    expect(r.ok).toBe(false);
  });
});
