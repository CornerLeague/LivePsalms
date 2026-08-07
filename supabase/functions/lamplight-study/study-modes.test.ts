import { describe, it, expect } from 'vitest';
import { STUDY_EFFORT, STUDY_MAX_TOKENS, LIBRARY_K } from './study-modes.ts';

// These three are keyed BY MODE, which makes them the part of B4's rename that
// no byte gate covers: the prompt strings can be provably identical while the
// opener quietly starts running at chat's effort, chat's token ceiling, or —
// worst — chat's library budget, which would change its grounding without
// changing a single character of its prompt.
//
// So the values are pinned by mode name, not just carried across.
describe('per-mode generation settings', () => {
  it('gives the opener the effort it has always had', () => {
    // Chat streams while the reader waits, so it stays low to protect
    // first-token latency. The opener fires on passage-open with nobody typing.
    expect(STUDY_EFFORT).toEqual({ chat: 'low', opener: 'medium' });
  });

  it('gives the opener the token ceiling it has always had', () => {
    expect(STUDY_MAX_TOKENS).toEqual({ chat: 4096, opener: 3072 });
  });

  it('⚠️ gives the opener HALF chat’s library budget, as before', () => {
    // The one that would change grounding rather than length. Chat carries a
    // real question worth answering from the church's study; the opener is one
    // observation, so it takes half.
    expect(LIBRARY_K).toEqual({ chat: 4, opener: 2 });
  });
});
