// src/notepad/bible/lamplight-chat-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendChatMessage, requestOpeningInsight } from './lamplight-chat-client';

describe('sendChatMessage', () => {
  it('invokes lamplight-chat with the passage + message and returns the reply', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, thread_id: 't1', reply: 'Grace.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] },
      error: null,
    });
    const out = await sendChatMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi', translation: 'KJV' });
    expect(invoke).toHaveBeenCalledWith('lamplight-chat', { body: { book: 'jhn', chapter: 10, message: 'hi', translation: 'KJV' } });
    expect(out).toEqual({ ok: true, threadId: 't1', reply: 'Grace.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] });
  });

  it('maps a function transport error to ok:false', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'network' } });
    const out = await sendChatMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi', translation: 'BSB' });
    expect(out).toEqual({ ok: false, reason: 'network' });
  });

  it('passes through a server ok:false reason (e.g. no_entitlement)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: false, reason: 'no_entitlement' }, error: null });
    const out = await sendChatMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi', translation: 'BSB' });
    expect(out).toEqual({ ok: false, reason: 'no_entitlement' });
  });
});

describe('requestOpeningInsight', () => {
  it('invokes lamplight-chat in insight mode and returns the reply', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, thread_id: 't1', reply: 'An opening thought.', citations: [] }, error: null,
    });
    const out = await requestOpeningInsight(invoke, { book: 'jhn', chapter: 10, translation: 'KJV' });
    expect(invoke).toHaveBeenCalledWith('lamplight-chat', { body: { book: 'jhn', chapter: 10, mode: 'insight', translation: 'KJV' } });
    expect(out).toEqual({ ok: true, threadId: 't1', reply: 'An opening thought.', citations: [] });
  });

  it('maps a skipped insight (already has messages) to ok:false reason skipped', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't1', skipped: true }, error: null });
    const out = await requestOpeningInsight(invoke, { book: 'jhn', chapter: 10, translation: 'BSB' });
    expect(out).toEqual({ ok: false, reason: 'skipped' });
  });
});
