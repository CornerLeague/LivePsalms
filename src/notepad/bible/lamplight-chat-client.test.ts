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
  it('⚠️ still sends the LEGACY `insight` wire value, and that is deliberate', async () => {
    // The mode is called `opener` everywhere else after B4, and both edge
    // functions accept either spelling. The client is NOT switched, because
    // Vercel deploys it automatically on merge while `supabase functions
    // deploy` is run by hand — so the client reaches production first, and a
    // function that predates this branch would read 'opener' as 'chat', find an
    // empty message, and 400 EVERY journaling passage open.
    //
    // Do not "tidy" this to 'opener' without deploying both functions first.
    // See `supabase/functions/_shared/chat-mode.ts`.
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, thread_id: 't1', reply: 'An opening thought.', citations: [] }, error: null,
    });
    await requestOpeningInsight(invoke, { book: 'jhn', chapter: 10, translation: 'KJV' });
    const body = invoke.mock.calls[0][1].body as { mode: string };
    expect(body.mode).toBe('insight');
  });

  it('invokes lamplight-chat in opener mode and returns the reply', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, thread_id: 't1', reply: 'An opening thought.', citations: [] }, error: null,
    });
    const out = await requestOpeningInsight(invoke, { book: 'jhn', chapter: 10, translation: 'KJV' });
    expect(invoke).toHaveBeenCalledWith('lamplight-chat', { body: { book: 'jhn', chapter: 10, mode: 'insight', translation: 'KJV' } });
    expect(out).toEqual({ ok: true, threadId: 't1', reply: 'An opening thought.', citations: [] });
  });

  it('maps a skipped opener (already has messages) to ok:false reason skipped', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't1', skipped: true }, error: null });
    const out = await requestOpeningInsight(invoke, { book: 'jhn', chapter: 10, translation: 'BSB' });
    expect(out).toEqual({ ok: false, reason: 'skipped' });
  });
});
