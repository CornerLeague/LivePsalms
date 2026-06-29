//
// Client-side SSE transport for the Study chat (lamplight-study). Mirrors
// src/notepad/bible/lamplight-stream-client.ts: POSTs with stream:true and
// parses the text/event-stream response one `data:` line at a time. Pure src
// module — ZERO edge-function dependency.
import type { SupabaseClient } from '@supabase/supabase-js';

// COPIED verbatim from supabase/functions/_shared/sse.ts — intentionally NOT
// imported, so this src module stays free of any edge-function dependency.
export type StudySseEvent =
  | { t: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
  | { t: 'text'; field: string; delta: string }
  | { t: 'piece'; field: string; value: unknown }
  | { t: 'refining' }
  | { t: 'replace'; payload: unknown }
  | { t: 'done'; payload: unknown }
  | { t: 'error'; reason: string };

export interface StreamStudyArgs {
  book: string;
  chapter: number;
  message: string;
  includeNotes?: boolean;
  noteIds?: string[];
  translation?: string;
  mode?: 'chat' | 'insight';
}

export type StudyStreamInvoke = (
  args: StreamStudyArgs,
  handlers: { onEvent: (ev: StudySseEvent) => void; onStart?: () => void; signal?: AbortSignal },
) => Promise<void>;

export function makeStudyStreamInvoke(client: SupabaseClient): StudyStreamInvoke {
  return async function streamStudyMessage(args, handlers) {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;

    const body: Record<string, unknown> = {
      book: args.book,
      chapter: args.chapter,
      message: args.message,
      include_notes: args.includeNotes ?? false,
      note_ids: args.noteIds ?? [],
      translation: args.translation,
      stream: true,
    };
    if (args.mode) body.mode = args.mode;

    const res = await fetch(`${url}/functions/v1/lamplight-study`, {
      method: 'POST',
      signal: handlers.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // A non-OK response is never an SSE stream in this design (gates/errors are
    // JSON before any stream). Throw so the caller fast-paths to its buffered
    // fallback — unless a future path streams an error beat at a non-200 status.
    if (!res.ok) {
      const contentType = res.headers?.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        throw new Error(`lamplight-study stream failed: ${res.status} ${res.statusText}`);
      }
    }

    // Fire onStart exactly once: a 200 SSE response is confirmed → the server has
    // already persisted the user message. The caller uses this to gate fallback.
    handlers.onStart?.();

    if (!res.body) return;

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
        let evt: StudySseEvent;
        try { evt = JSON.parse(json) as StudySseEvent; } catch { continue; }
        handlers.onEvent(evt);
      }
    }
  };
}
