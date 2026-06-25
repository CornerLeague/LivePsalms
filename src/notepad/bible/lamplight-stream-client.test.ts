// src/notepad/bible/lamplight-stream-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeStreamInvoke, type SseEvent } from './lamplight-stream-client';

// A fake Supabase client: only auth.getSession() is exercised by the transport.
const fakeClient = {
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }),
  },
} as unknown as SupabaseClient;

function streamFromFrames(frames: SseEvent[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const f of frames) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      ctrl.close();
    },
  });
}

describe('makeStreamInvoke', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('POSTs with stream:true + bearer auth and decodes SSE frames in order', async () => {
    const frames: SseEvent[] = [
      { t: 'stage', stage: 'notes' },
      { t: 'text', field: 'reply', delta: 'Hello' },
      { t: 'piece', field: 'citations', value: [] },
      { t: 'done', payload: { ok: true } },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: streamFromFrames(frames),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const received: SseEvent[] = [];
    const invoke = makeStreamInvoke(fakeClient);
    await invoke('lamplight-chat', { book: 'jhn', chapter: 10 }, { onEvent: (ev) => received.push(ev) });

    // 1. events decoded in order
    expect(received).toEqual(frames);

    // 2. request body forces stream:true (and preserves the caller's body)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({ book: 'jhn', chapter: 10, stream: true });

    // 3. bearer auth header from the session access token
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');

    // URL targets the function endpoint
    expect(url).toBe('https://test.supabase.co/functions/v1/lamplight-chat');
  });

  it('reassembles an SSE frame split across two chunks', async () => {
    const enc = new TextEncoder();
    const whole = `data: ${JSON.stringify({ t: 'text', field: 'reply', delta: 'Hi' })}\n\n`;
    const cut = Math.floor(whole.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(enc.encode(whole.slice(0, cut)));
        ctrl.enqueue(enc.encode(whole.slice(cut)));
        ctrl.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: stream } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const received: SseEvent[] = [];
    const invoke = makeStreamInvoke(fakeClient);
    await invoke('lamplight-chat', {}, { onEvent: (ev) => received.push(ev) });

    expect(received).toEqual([{ t: 'text', field: 'reply', delta: 'Hi' }]);
  });

  it('throws on a non-OK, non-SSE response so the caller fast-paths its buffered fallback', async () => {
    // A real HTTP 500 from the edge fn: non-OK with a JSON (not SSE) body. The old
    // code read this as a stream, found zero `data:` frames, and resolved silently —
    // indistinguishable from the intended JSON-gate 403/429 no-event path.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode('{"error":"boom"}'));
          ctrl.close();
        },
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const onEvent = vi.fn();
    const invoke = makeStreamInvoke(fakeClient);
    await expect(invoke('lamplight-chat', {}, { onEvent })).rejects.toThrow(/500/);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('still parses a non-OK response that IS an event-stream (content-type guard)', async () => {
    // Defends the content-type guard: if a future edge path streams an error beat at
    // a non-200 status, parse it rather than throwing it away.
    const frames: SseEvent[] = [{ t: 'error', reason: 'validators_failed' }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: streamFromFrames(frames),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const received: SseEvent[] = [];
    const invoke = makeStreamInvoke(fakeClient);
    await invoke('lamplight-chat', {}, { onEvent: (ev) => received.push(ev) });

    expect(received).toEqual(frames);
  });
});
