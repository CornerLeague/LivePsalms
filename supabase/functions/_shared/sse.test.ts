// supabase/functions/_shared/sse.test.ts
import { describe, it, expect } from 'vitest';
import { encodeSseEvent, sseResponse, sseStreamFromWriter } from './sse';

describe('encodeSseEvent', () => {
  it('serializes one event as a data line with a blank-line terminator', () => {
    expect(encodeSseEvent({ t: 'stage', stage: 'notes' })).toBe('data: {"t":"stage","stage":"notes"}\n\n');
  });
});

describe('sseResponse', () => {
  it('sets event-stream headers and merges CORS', () => {
    const r = sseResponse({ 'access-control-allow-origin': '*' }, new ReadableStream());
    expect(r.headers.get('content-type')).toBe('text/event-stream');
    expect(r.headers.get('cache-control')).toContain('no-cache');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('sseStreamFromWriter', () => {
  it('encodes each emitted event and closes', async () => {
    const stream = sseStreamFromWriter(async (emit) => {
      await emit({ t: 'stage', stage: 'notes' });
      await emit({ t: 'done', payload: { ok: true } });
    });
    const text = await new Response(stream).text();
    expect(text).toBe(
      'data: {"t":"stage","stage":"notes"}\n\n' +
      'data: {"t":"done","payload":{"ok":true}}\n\n'
    );
  });

  it('emits an error event if the writer throws', async () => {
    const stream = sseStreamFromWriter(async () => { throw new Error('boom'); });
    const text = await new Response(stream).text();
    expect(text).toContain('"t":"error"');
  });
});
