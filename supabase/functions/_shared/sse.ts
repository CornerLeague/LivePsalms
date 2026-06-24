// supabase/functions/_shared/sse.ts
export type SseEvent =
  | { t: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
  | { t: 'text'; field: string; delta: string }
  | { t: 'piece'; field: string; value: unknown }
  | { t: 'refining' }
  | { t: 'replace'; payload: unknown }
  | { t: 'done'; payload: unknown }
  | { t: 'error'; reason: string };

export function encodeSseEvent(ev: SseEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

export function sseResponse(cors: Record<string, string>, body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
    },
  });
}

export function sseStreamFromWriter(
  write: (emit: (ev: SseEvent) => Promise<void>) => Promise<void>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = async (ev: SseEvent) => { controller.enqueue(enc.encode(encodeSseEvent(ev))); };
      try {
        await write(emit);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        controller.enqueue(enc.encode(encodeSseEvent({ t: 'error', reason })));
      } finally {
        controller.close();
      }
    },
  });
}
