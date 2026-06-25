// src/notepad/bible/lamplight-stream-client.ts
//
// Client-side SSE transport for Lamplight streaming endpoints (bible-chat +
// daily-devotion). POSTs to a Supabase edge function with `stream: true` and parses
// the `text/event-stream` response one `data:` line at a time, invoking onEvent for
// each decoded frame. Pure src module — ZERO edge-function dependency.
import type { SupabaseClient } from '@supabase/supabase-js';

// COPIED verbatim from supabase/functions/_shared/sse.ts — intentionally NOT
// imported, so this src module stays free of any edge-function dependency. Keep in
// sync with the edge encoder if the wire shape changes.
export type SseEvent =
  | { t: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
  | { t: 'text'; field: string; delta: string }
  | { t: 'piece'; field: string; value: unknown }
  | { t: 'refining' }
  | { t: 'replace'; payload: unknown }
  | { t: 'done'; payload: unknown }
  | { t: 'error'; reason: string };

export type StreamInvoke = (
  name: string,
  body: unknown,
  handlers: { onEvent: (ev: SseEvent) => void; signal?: AbortSignal },
) => Promise<void>;

// Build a StreamInvoke from a Supabase client (direct fetch + SSE reader).
export function makeStreamInvoke(client: SupabaseClient): StreamInvoke {
  return async function streamInvoke(name, body, handlers) {
    // Re-read import.meta.env here (same as src/lib/supabase.ts, which reads it
    // inline rather than exporting named constants).
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;

    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      signal: handlers.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      // Spread the caller's body, then force stream:true so the edge fn takes the
      // SSE path regardless of what the caller passed.
      body: JSON.stringify({ ...(body as Record<string, unknown>), stream: true }),
    });

    // A non-OK response is never an SSE stream in this design: the edge fns emit
    // `text/event-stream` only at HTTP 200, and surface gate failures (403/402/429)
    // and server errors (500) as non-OK JSON *before* any stream. Throw so the
    // caller fast-paths to its buffered fallback instead of reading a non-SSE body
    // to EOF, finding zero `data:` frames, and falling back anyway (which doubles
    // latency before the user sees an error) — and so a 500 is distinguishable from
    // a deliberate gate response in logs. The content-type guard keeps the door open
    // for a future path that streams an error beat at a non-200 status (parse it).
    if (!res.ok) {
      const contentType = res.headers?.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        throw new Error(`lamplight stream ${name} failed: ${res.status} ${res.statusText}`);
      }
    }

    if (!res.body) return;

    // Parse SSE the same way the Anthropic adapter does (see
    // supabase/functions/_shared/anthropic.ts ~117-145): pull one line at a time
    // out of a rolling buffer, keep only the `data:` payloads.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        let evt: SseEvent;
        try {
          evt = JSON.parse(json) as SseEvent;
        } catch {
          continue;
        }
        handlers.onEvent(evt);
      }
    }
  };
}
