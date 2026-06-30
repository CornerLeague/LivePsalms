import { describe, it, expect, vi } from 'vitest';
import { sendStudyMessage, requestStudyInsight } from './study-chat-client';

describe('sendStudyMessage', () => {
  it('invokes lamplight-study and surfaces offered notes', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, thread_id: 't1', reply: 'Grace.', citations: [], offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] },
      error: null,
    });
    const out = await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi' });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', { body: { book: 'jhn', chapter: 10, message: 'hi', include_notes: false, note_ids: [] } });
    expect(out).toEqual({ ok: true, threadId: 't1', reply: 'Grace.', citations: [], offeredNotes: [{ id: 'n1', title: 'A', snippet: 's' }] });
  });
  it('passes include_notes + note_ids when bringing notes in', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null });
    await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi', includeNotes: true, noteIds: ['n1'] });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', { body: { book: 'jhn', chapter: 10, message: 'hi', include_notes: true, note_ids: ['n1'] } });
  });
  it('maps a transport error to ok:false', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'network' } });
    expect(await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi' })).toEqual({ ok: false, reason: 'network' });
  });
  it('passes through a server ok:false reason', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: false, reason: 'quota_exceeded' }, error: null });
    expect(await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi' })).toEqual({ ok: false, reason: 'quota_exceeded' });
  });
});

describe('requestStudyInsight', () => {
  it('sends insight mode and maps a skipped insight to ok:false', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', skipped: true }, error: null });
    const out = await requestStudyInsight(invoke, { book: 'rom', chapter: 8 });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', { body: { book: 'rom', chapter: 8, mode: 'insight' } });
    expect(out).toEqual({ ok: false, reason: 'skipped' });
  });
});

function captureInvoke() {
  const bodies: unknown[] = [];
  const invoke = vi.fn(async (_fn: string, opts: { body: unknown }) => {
    bodies.push(opts.body);
    return { data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null };
  });
  return { invoke: invoke as Parameters<typeof sendStudyMessage>[0], bodies };
}

describe('study-chat-client passes translation', () => {
  it('sendStudyMessage forwards the active translation in the body', async () => {
    const { invoke, bodies } = captureInvoke();
    await sendStudyMessage(invoke, { book: 'jhn', chapter: 3, message: 'hi', translation: 'KJV' });
    expect(bodies[0]).toMatchObject({ book: 'jhn', chapter: 3, message: 'hi', translation: 'KJV' });
  });

  it('requestStudyInsight forwards the active translation in the body', async () => {
    const { invoke, bodies } = captureInvoke();
    await requestStudyInsight(invoke, { book: 'jhn', chapter: 3, translation: 'WEB' });
    expect(bodies[0]).toMatchObject({ book: 'jhn', chapter: 3, mode: 'insight', translation: 'WEB' });
  });
});

describe('sendStudyMessage thread_id', () => {
  it('includes thread_id in the body when provided', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null });
    await sendStudyMessage(invoke, { book: 'rom', chapter: 8, message: 'hi', threadId: 'thread-1' });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', expect.objectContaining({
      body: expect.objectContaining({ thread_id: 'thread-1' }),
    }));
  });

  it('omits thread_id when not provided', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null });
    await sendStudyMessage(invoke, { book: 'rom', chapter: 8, message: 'hi' });
    const body = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect('thread_id' in body).toBe(false);
  });
});
