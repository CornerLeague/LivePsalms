import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeStudyStreamInvoke, type StudySseEvent } from './study-stream-client';

const fakeClient = {
  auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }) },
} as unknown as SupabaseClient;

function streamFromFrames(frames: StudySseEvent[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const f of frames) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      ctrl.close();
    },
  });
}

describe('makeStudyStreamInvoke', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('POSTs to lamplight-study with stream:true + study body + bearer auth, decodes frames in order', async () => {
    const frames: StudySseEvent[] = [
      { t: 'stage', stage: 'notes' },
      { t: 'text', field: 'reply', delta: 'Grace' },
      { t: 'done', payload: { ok: true, offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] } },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/event-stream' }), body: streamFromFrames(frames) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const received: StudySseEvent[] = [];
    const invoke = makeStudyStreamInvoke(fakeClient);
    await invoke(
      { book: 'jhn', chapter: 10, message: 'hi', includeNotes: true, noteIds: ['n1'], translation: 'BSB' },
      { onEvent: (ev) => received.push(ev) },
    );

    expect(received).toEqual(frames);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.supabase.co/functions/v1/lamplight-study');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({
      book: 'jhn', chapter: 10, message: 'hi',
      include_notes: true, note_ids: ['n1'], translation: 'BSB',
      stream: true,
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(headers.accept).toBe('text/event-stream');
  });

  it('reassembles a frame split across two chunks', async () => {
    const enc = new TextEncoder();
    const whole = `data: ${JSON.stringify({ t: 'text', field: 'reply', delta: 'Hi' })}\n\n`;
    const cut = Math.floor(whole.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) { ctrl.enqueue(enc.encode(whole.slice(0, cut))); ctrl.enqueue(enc.encode(whole.slice(cut))); ctrl.close(); },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/event-stream' }), body: stream } as unknown as Response) as unknown as typeof fetch;

    const received: StudySseEvent[] = [];
    await makeStudyStreamInvoke(fakeClient)(
      { book: 'jhn', chapter: 10, message: 'hi' },
      { onEvent: (ev) => received.push(ev) },
    );
    expect(received).toEqual([{ t: 'text', field: 'reply', delta: 'Hi' }]);
  });

  it('throws on a non-OK non-SSE response so the caller falls back to buffered', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"error":"boom"}')); c.close(); } }),
    } as unknown as Response) as unknown as typeof fetch;

    const onEvent = vi.fn();
    await expect(
      makeStudyStreamInvoke(fakeClient)({ book: 'jhn', chapter: 10, message: 'hi' }, { onEvent }),
    ).rejects.toThrow(/500/);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('throws on a non-SSE 200 response so the caller falls back to buffered (e.g. insight-skip JSON)', async () => {
    const onStart = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":true,"skipped":true}')); c.close(); } }),
    } as unknown as Response) as unknown as typeof fetch;

    const onEvent = vi.fn();
    await expect(
      makeStudyStreamInvoke(fakeClient)({ book: 'jhn', chapter: 10, message: 'hi' }, { onEvent, onStart }),
    ).rejects.toThrow(/non-SSE/);
    // started must NOT fire on a non-SSE 200 → caller treats it as pre-start → safe buffered fallback.
    expect(onStart).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });
});
