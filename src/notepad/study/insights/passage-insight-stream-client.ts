// Client-side contract for Insights Door 1 ("The Passage").
//
// Mirrors src/notepad/study/study-stream-client.ts: POSTs and parses the
// text/event-stream response one `data:` line at a time. Pure src module —
// ZERO edge-function dependency, which is why the types and the section list
// below are COPIED rather than imported.
import type { SupabaseClient } from '@supabase/supabase-js';

// COPIED verbatim from supabase/functions/_shared/sse.ts — intentionally NOT
// imported, so this src module stays free of any edge-function dependency.
export type PassageInsightSseEvent =
  | { t: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
  | { t: 'text'; field: string; delta: string }
  | { t: 'piece'; field: string; value: unknown }
  | { t: 'refining' }
  | { t: 'replace'; payload: unknown }
  | { t: 'done'; payload: unknown }
  | { t: 'error'; reason: string };

// The section lists moved to ./insight-doors.ts in B3, where both doors' live
// together and a parity test compares them to the server registry directly.
// Re-exported here so B2's importers keep working.
export type { InsightSectionView as PassageSection } from './insight-doors';
export { PASSAGE_SECTIONS } from './insight-doors';

export interface PassageInsightScope {
  book: string;
  chapter: number;
  /** null = the whole chapter. */
  verse: number | null;
}

/**
 * The cache key, composed exactly as the server composes it.
 *
 * MUST stay identical to `parsePassageInsightBody` in
 * `supabase/functions/lamplight-study/passage-insight-stream.ts`. The server
 * writes the row under its version of this string and the client reads under
 * this one; if they ever disagree the cache silently never hits — every reader
 * pays to generate a door that is already sitting in the table. Pinned by test
 * on both sides.
 */
export function passageRefId(scope: PassageInsightScope): string {
  const book = scope.book.trim().toLowerCase();
  return scope.verse === null
    ? `${book}.${scope.chapter}`
    : `${book}.${scope.chapter}.${scope.verse}`;
}

export function passageScopeKind(scope: PassageInsightScope): 'verse' | 'chapter' {
  return scope.verse === null ? 'chapter' : 'verse';
}

export type PassageInsightInvoke = (
  scope: PassageInsightScope,
  handlers: {
    /** Which door to generate. Omitted means Door 1, matching the server default. */
    doorId?: string;
    onEvent: (ev: PassageInsightSseEvent) => void;
    /** A cache hit answers in JSON, not SSE — the door was already warm. */
    onCached: (payload: { sections: Record<string, string> }) => void;
    signal?: AbortSignal;
  },
) => Promise<void>;

export function makePassageInsightStreamInvoke(client: SupabaseClient): PassageInsightInvoke {
  return async function streamPassageInsight(scope, handlers) {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;

    const res = await fetch(`${url}/functions/v1/passage-insight`, {
      method: 'POST',
      signal: handlers.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        book: scope.book,
        chapter: scope.chapter,
        ...(scope.verse !== null ? { verse: scope.verse } : {}),
        // Omitted rather than defaulted here: the server's own default is
        // 'passage', and sending nothing is exactly what a B2 client does.
        ...(handlers.doorId !== undefined ? { door: handlers.doorId } : {}),
      }),
    });

    // Every gate answers in JSON before any stream starts, so a non-OK response
    // is never a partial door.
    if (!res.ok) {
      throw new Error(`passage-insight failed: ${res.status} ${res.statusText}`);
    }

    // A 200 that is NOT an event stream is the cache-hit path: another reader
    // warmed this door between our read and our press.
    const contentType = res.headers?.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const payload = await res.json() as { sections?: Record<string, string> };
      handlers.onCached({ sections: payload.sections ?? {} });
      return;
    }

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
        let evt: PassageInsightSseEvent;
        try { evt = JSON.parse(json) as PassageInsightSseEvent; } catch { continue; }
        handlers.onEvent(evt);
      }
    }
  };
}
