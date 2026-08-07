import { describe, it, expect } from 'vitest';
import { uncitableRefs, renderDoorGrounding } from './insight-door.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

function ctxWith(refs: string[]): BibleChatContext {
  return {
    passageRef: 'Romans 9',
    passageText: 'the chapter text',
    crossRefs: [],
    notes: [],
    history: [],
    userMessage: '',
    allowedNoteIds: new Set<string>(),
    allowedVerseRefs: new Set(refs),
  } as unknown as BibleChatContext;
}

// The door and the validator must agree about what is contested. They do here
// because they run the SAME matcher over the SAME list — a hand-kept second list
// would have drifted, which is the bug this block exists to fix.
describe('uncitableRefs', () => {
  it('picks out exactly the contested verses of a mixed chapter', () => {
    const refs = uncitableRefs(ctxWith([
      'Romans 9:1', 'Romans 9:10', 'Romans 9:11', 'Romans 9:16', 'Romans 9:23',
      'Romans 9:24', 'Romans 9:33',
    ]));
    // CONTESTED_PASSAGES covers Romans 9:11–23 and nothing either side of it.
    expect(refs).toEqual(['Romans 9:11', 'Romans 9:16', 'Romans 9:23']);
  });

  it('catches a whole-chapter entry, where every verse is uncitable', () => {
    const refs = uncitableRefs(ctxWith(['Revelation 13:1', 'Revelation 13:18']));
    expect(refs).toHaveLength(2);
  });

  it('is empty for an uncontested passage, so the block never renders', () => {
    expect(uncitableRefs(ctxWith(['Psalms 27:1', 'Psalms 27:4']))).toEqual([]);
  });

  it('does not fire on a near-miss ref the substring matcher used to catch', () => {
    // '1 Corinthians 11:2' is contested; '1 Corinthians 11:20' is not, and is a
    // substring match away from it.
    expect(uncitableRefs(ctxWith(['1 Corinthians 11:20']))).toEqual([]);
    expect(uncitableRefs(ctxWith(['1 Corinthians 11:2']))).toEqual(['1 Corinthians 11:2']);
  });
});

describe('renderDoorGrounding', () => {
  it('appends the uncitable list when the passage has one', () => {
    const out = renderDoorGrounding(ctxWith(['Romans 9:1', 'Romans 9:16']));
    expect(out).toContain('Uncitable verses');
    expect(out).toContain('- Romans 9:16');
    expect(out).not.toContain('- Romans 9:1\n');
  });

  it('is byte-identical to the plain study grounding when nothing is contested', async () => {
    // Door 1 on Psalm 27 must be unchanged by this block existing.
    const { renderStudyGrounding } = await import('./study-chat.ts');
    const ctx = ctxWith(['Psalms 27:1']);
    expect(renderDoorGrounding(ctx)).toBe(renderStudyGrounding(ctx));
  });
});
