import { describe, it, expect } from 'vitest';
import { parseChatMode } from './chat-mode.ts';

describe('parseChatMode', () => {
  it('reads the current spelling', () => {
    expect(parseChatMode('opener')).toBe('opener');
  });

  it('⚠️ still reads the LEGACY spelling', () => {
    // `requestOpeningInsight` is called on every journaling passage open and
    // sends `mode: 'insight'`. Vercel deploys the client automatically on merge
    // while edge functions deploy by hand, so the client reaches production
    // FIRST — and a function that stopped understanding 'insight' would 400
    // every opener until somebody ran a deploy. The tolerance is what makes the
    // rename safe to land in one PR.
    expect(parseChatMode('insight')).toBe('opener');
  });

  it('falls through to chat for anything else', () => {
    for (const raw of ['chat', 'Opener', 'INSIGHT', '', 'nonsense', undefined, null, 42, {}, []]) {
      expect(parseChatMode(raw)).toBe('chat');
    }
  });
});
