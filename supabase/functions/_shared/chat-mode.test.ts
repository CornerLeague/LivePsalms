import { describe, it, expect } from 'vitest';
import { parseChatMode } from './chat-mode.ts';

describe('parseChatMode', () => {
  it('reads the current spelling', () => {
    expect(parseChatMode('opener')).toBe('opener');
  });

  it('⚠️ still reads the LEGACY spelling — and this is not dead code', () => {
    // The clients now send 'opener' (flipped once these functions deployed,
    // 2026-08-07). This is NOT therefore removable.
    //
    // There is no service worker, but a reader with the app open in a tab runs
    // whatever bundle they loaded until they reload, and the journaling opener
    // fires on every passage open. Dropping 'insight' would make those requests
    // fall through to `chat`, meet an empty message, and 400.
    //
    // Every client that has RELOADED sends 'opener'. That is not every client.
    expect(parseChatMode('insight')).toBe('opener');
  });

  it('falls through to chat for anything else', () => {
    for (const raw of ['chat', 'Opener', 'INSIGHT', '', 'nonsense', undefined, null, 42, {}, []]) {
      expect(parseChatMode(raw)).toBe('chat');
    }
  });
});
