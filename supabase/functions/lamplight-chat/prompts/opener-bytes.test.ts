// The byte-identity gate on the journaling OPENER prompt.
//
// The Study twin (`lamplight-study/prompts/opener-bytes.test.ts`) explains the
// discipline; this is the same gate on the other surface, and the surface that
// makes the rename risky.
//
// ⚠️ THIS ONE IS A LIVE WIRE. `requestOpeningInsight` is called from
// `LamplightChat.tsx` on every journaling passage open, POSTing
// `{ book, chapter, mode: 'insight' }` with no message. `lamplight-chat`'s
// parser reads `body.mode === 'insight' ? 'insight' : 'chat'` and then rejects
// a chat-mode request with an empty message — so a client that ships `'opener'`
// against a function that has not been redeployed returns `400 bad payload` for
// every reader, on every passage open. Its Study twin is genuinely parked,
// which is probably why the handoff read the whole mode as dormant. It is not.
//
// Hence both rules: the wire accepts BOTH spellings, and the functions deploy
// before the client ships.
//
// `bible-insight-2026-06-10-v3` stays verbatim for the same reason its Study
// twin does — it is a stored value, and the rename changes no emitted byte.
import { describe, it, expect } from 'vitest';
import { BIBLE_INSIGHT_PROMPT } from './bible-insight.ts';
import expected from './__fixtures__/bible-opener-v3.json' with { type: 'json' };

describe('Journaling opener prompt — byte identity (B4 rename gate)', () => {
  it('keeps its promptVersion verbatim, "insight" and all', () => {
    expect(BIBLE_INSIGHT_PROMPT.promptVersion).toBe(expected.promptVersion);
    expect(BIBLE_INSIGHT_PROMPT.promptVersion).toBe('bible-insight-2026-06-10-v3');
  });

  it('emits a byte-identical system prompt', () => {
    expect(BIBLE_INSIGHT_PROMPT.system.length).toBe(expected.system.length);
    expect(BIBLE_INSIGHT_PROMPT.system).toBe(expected.system);
  });

  it('emits a byte-identical tool schema', () => {
    expect(JSON.stringify(BIBLE_INSIGHT_PROMPT.tool)).toBe(JSON.stringify(expected.tool));
  });
});
