# Lamplight Response Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream Lamplight responses piece-by-piece over SSE so honest narration and then response fields appear *while* the model generates, on both the Lamplight Chat and Today's Lamp surfaces.

**Architecture:** Keep Claude in forced tool-use mode. Add a streaming path to the shared Anthropic adapter that reads the Messages SSE stream and parses the tool's partial JSON (`input_json_delta`) into completed top-level fields. A shared stream parser turns raw JSON deltas into `text`/`complete` events. The two edge functions emit a small SSE event protocol (`stage`/`text`/`piece`/`refining`/`replace`/`done`/`error`) inside the existing quota/usage envelope; the validate-retry loop is restructured so per-field checks gate *before* a field is emitted and cross-field checks at the end trigger a gentle `refining`→`replace`. The client reads the SSE via a direct `fetch` (since `supabase.functions.invoke` can't read a streaming body), with a fallback to the existing buffered `invoke`.

**Tech Stack:** TypeScript, Deno (Supabase Edge Functions), React, Vitest, Supabase JS, Anthropic Messages API (streaming).

## Global Constraints

- Typecheck with `tsc -b` (the real build command), NEVER bare `tsc --noEmit` (root tsconfig has `files: []`).
- Verify **zero new** lint/tsc/test errors against the known pre-existing red baseline (~114 lint errors, 4 tsc errors in `force-sphere.test.ts`, 2 failing test files `Editor.toolbar-placement` + `garden-scene`). Do not gate on a globally green repo; gate on adding zero new failures.
- Test runner: `npm run test` (= `vitest run`). Single file: `npx vitest run <path>`. Single test: `npx vitest run <path> -t "<name>"`.
- Edge functions deploy **manually**, not in CI: `supabase functions deploy lamplight-chat --use-api` and `supabase functions deploy lamplight-generate --use-api`. A Vercel/frontend deploy never carries `supabase/functions/**` changes.
- The Lamplight **voice principle** (no prophetic/pronouncement voice) is load-bearing: it is a cross-field validator that MUST run at stream end before `done`. Streaming must never bypass it.
- All reveal/unfold motion MUST respect `prefers-reduced-motion` (instant, no transition).
- `connection_card_why` (the third `lamplight-generate` kind) stays buffered and untouched.
- Edge-function `_shared/*.ts` modules use `.ts` import extensions in source; their Vitest tests import without the extension (e.g. `from './anthropic'`). Match the surrounding file.
- No Deno or Node globals in `_shared/*.ts` (deps are injected — see `AnthropicDeps`). New shared modules follow the same dependency-injection pattern.

---

## File Structure

**Backend — create:**
- `supabase/functions/_shared/stream-json-fields.ts` — pure streaming parser: raw tool-JSON deltas → `text`/`complete` field events. No I/O.
- `supabase/functions/_shared/stream-json-fields.test.ts` — parser tests.
- `supabase/functions/_shared/sse.ts` — SSE event types + `encodeSseEvent()` + `sseResponse()` helper (CORS-aware streaming Response). No I/O beyond building a Response.
- `supabase/functions/_shared/sse.test.ts` — SSE encoder tests.
- `supabase/functions/_shared/generate-streaming.ts` — `generateStreamingWithRetry()`: the streaming sibling of `generate-with-retry.ts`. Orchestrates attempt-1 streaming + per-field gate + cross-field validate + `refining`/`replace` retry.
- `supabase/functions/_shared/generate-streaming.test.ts` — streaming retry-loop tests.

**Backend — modify:**
- `supabase/functions/_shared/anthropic.ts` — add `generateStream<T>()` to `LLMAdapter`.
- `supabase/functions/_shared/anthropic.test.ts` — add streaming-adapter tests.
- `supabase/functions/lamplight-chat/index.ts` — branch to an SSE response when the client asks for streaming; reuse all gates + persistence.
- `supabase/functions/lamplight-generate/index.ts` — same, for `daily_devotion`.
- `supabase/functions/lamplight-chat/bible-chat-pipeline.ts` — add a streaming pipeline entry that drives `generateStreamingWithRetry`.
- `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts` — same.

**Frontend — create:**
- `src/notepad/bible/lamplight-stream-client.ts` — `streamFunction()` transport (direct fetch + SSE reader) and typed `streamChatMessage()`/`streamDailyDevotion()` wrappers, plus a `sentence-chunker`.
- `src/notepad/bible/lamplight-stream-client.test.ts`
- `src/notepad/bible/sentence-chunker.ts` — buffer text deltas; flush whole sentences/paragraphs.
- `src/notepad/bible/sentence-chunker.test.ts`

**Frontend — modify:**
- `src/notepad/bible/lamplight-chat-client.ts` — re-export streaming types (no behavior change to buffered fns).
- `src/notepad/components/lamplight/chat/LamplightChat.tsx` — stream sends + reflections; placeholder assistant message; chunked pop-in; abort on passage change.
- `src/notepad/components/lamplight/chat/ChatMessage.tsx` — add a `streaming` flag → in-progress caret + narration line.
- `src/notepad/bible/useChatThread.ts` — add `updateLast()` (mutate the in-flight assistant message). *(Read this file before Task C2; its current shape is assumed from `append()` usage.)*
- `src/notepad/lamplight/todays-lamp-controller.ts` — new `retrieving`/`generating`/`refining` phases; delete the fake `startInterval`; consume a streaming `generate`.
- `src/notepad/lamplight/todays-lamp-controller.test.ts` — phase-transition tests. *(Read existing test before Task D2 to match conventions.)*
- `src/notepad/hooks/useTodaysLamp.ts` — wire the streaming generate dep.
- `src/notepad/components/lamplight/TodaysLampCard.tsx` — render partial artifact; unfold/grow with reduced-motion guard.
- `src/notepad/components/lamplight/TodaysLampLoading.tsx` — narration driven by real `stage`.
- `src/notepad/storage/lamplight-adapter.ts` — add `streamDailyDevotion` to the adapter interface + `DailyDevotionStreamEvent` type. *(Read this file before Task D1.)*
- `src/notepad/storage/supabase-lamplight-adapter.ts` — implement `streamDailyDevotion` via the transport, falling back to buffered `generateDailyDevotion`.
- `src/components/sections/Notepad.tsx:63,277` — pass a `streamInvoke` binding alongside `invoke`.
- `src/components/sections/notepad/mobile/useMobileWorkspaceModel.ts:49` — same binding for mobile.

**Dependency order:** Phase A (backend core) → Phase B (edge + transport) → Phase C (chat UI) → Phase D (daily-lamp UI). Each phase is independently testable; UI phases are independent of each other.

---

## SSE Event Protocol (shared contract — referenced by every phase)

One JSON object per SSE `data:` line, discriminated by `t`:

```ts
// supabase/functions/_shared/sse.ts
export type SseEvent =
  | { t: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
  | { t: 'text'; field: string; delta: string }      // incremental text for a streamed string field (chat 'reply')
  | { t: 'piece'; field: string; value: unknown }     // a completed, per-field-validated field (daily lamp)
  | { t: 'refining' }                                 // cross/per-field check failed; regenerating
  | { t: 'replace'; payload: unknown }                // validated final result after a retry
  | { t: 'done'; payload: unknown }                   // success; payload mirrors the old buffered JSON body
  | { t: 'error'; reason: string };                   // terminal failure (gates handled pre-stream as plain JSON)
```

- **Chat** emits: `stage`*, then `text{field:'reply'}` deltas, then `piece{field:'citations'}`, then `done{payload:{ok,thread_id,reply,citations}}`. On retry: `refining` then `replace`.
- **Daily Lamp** emits: `stage`*, then `piece` per field in order (`opening`,`scripture`,`reflection`,`prompt`,`note_citations`), then `done{payload:{ok,artifact,...}}`. On retry: `refining` then `replace{payload:{artifact}}`.
- Gate failures (not opted in / no entitlement / bad payload) are returned as a normal JSON error **before** the stream opens (status 4xx), exactly as today.

---

# Phase A — Backend streaming core

## Task A1: Streaming tool-JSON field parser

**Files:**
- Create: `supabase/functions/_shared/stream-json-fields.ts`
- Test: `supabase/functions/_shared/stream-json-fields.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FieldEvent =
    | { type: 'text'; field: string; delta: string }
    | { type: 'complete'; field: string; value: unknown };
  export interface ToolJsonStreamParser {
    push(deltaJson: string): FieldEvent[];   // feed raw input_json_delta fragments
    finish(): FieldEvent[];                   // call once at message_stop; flushes the last field
  }
  export function createToolJsonStreamParser(opts: { textFields?: string[] }): ToolJsonStreamParser;
  ```
  `textFields` = top-level string fields to stream as `text` deltas (chat: `['reply']`). All other completed top-level fields emit `complete`. Text fields ALSO emit a final `complete` on close (so callers that want the validated whole value still get it).

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/stream-json-fields.test.ts
import { describe, it, expect } from 'vitest';
import { createToolJsonStreamParser, type FieldEvent } from './stream-json-fields';

// Feed a full JSON string in arbitrary cuts; collect events.
function run(json: string, cuts: number[], textFields: string[] = []): FieldEvent[] {
  const p = createToolJsonStreamParser({ textFields });
  const events: FieldEvent[] = [];
  let prev = 0;
  for (const c of [...cuts, json.length]) {
    events.push(...p.push(json.slice(prev, c)));
    prev = c;
  }
  events.push(...p.finish());
  return events;
}

describe('createToolJsonStreamParser', () => {
  it('emits complete events for flat string fields in order', () => {
    const json = '{"opening":"hello","prompt":"sit"}';
    const ev = run(json, [10, 20]);
    const completes = ev.filter(e => e.type === 'complete');
    expect(completes).toEqual([
      { type: 'complete', field: 'opening', value: 'hello' },
      { type: 'complete', field: 'prompt', value: 'sit' },
    ]);
  });

  it('parses a nested object value (scripture) as one complete event', () => {
    const json = '{"scripture":{"ref":"Psalm 23:4","text":"Even though"},"prompt":"q"}';
    const ev = run(json, [5, 25, 45]);
    expect(ev).toContainEqual({ type: 'complete', field: 'scripture', value: { ref: 'Psalm 23:4', text: 'Even though' } });
    expect(ev).toContainEqual({ type: 'complete', field: 'prompt', value: 'q' });
  });

  it('parses an array value (note_citations) as one complete event', () => {
    const json = '{"note_citations":[{"note_id":"n1","reason":"a"},{"note_id":"n2","reason":"b"}]}';
    const ev = run(json, [15, 40]);
    expect(ev).toContainEqual({
      type: 'complete', field: 'note_citations',
      value: [{ note_id: 'n1', reason: 'a' }, { note_id: 'n2', reason: 'b' }],
    });
  });

  it('does NOT treat a colliding key substring inside a value as a top-level key', () => {
    // reflection text literally contains the substring "prompt":
    const json = '{"reflection":"see \\"prompt\\": here","prompt":"real"}';
    const ev = run(json, [12, 25, 40]);
    const completes = ev.filter(e => e.type === 'complete').map(e => e.field);
    expect(completes).toEqual(['reflection', 'prompt']);
    expect(ev).toContainEqual({ type: 'complete', field: 'reflection', value: 'see "prompt": here' });
  });

  it('streams text deltas for declared textFields, decoding escapes', () => {
    const json = '{"reply":"line one\\nline two","citations":[]}';
    const ev = run(json, [10, 14, 20, 30], ['reply']);
    const text = ev.filter(e => e.type === 'text' && e.field === 'reply') as Array<{ delta: string }>;
    expect(text.map(t => t.delta).join('')).toBe('line one\nline two');
    // and still emits a final complete for the text field
    expect(ev).toContainEqual({ type: 'complete', field: 'reply', value: 'line one\nline two' });
  });

  it('handles a string split mid-escape across pushes', () => {
    const json = '{"reply":"a\\"b"}';
    // cut right after the backslash
    const ev = run(json, [11], ['reply']);
    const text = ev.filter(e => e.type === 'text') as Array<{ delta: string }>;
    expect(text.map(t => t.delta).join('')).toBe('a"b');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run supabase/functions/_shared/stream-json-fields.test.ts`
Expected: FAIL — "createToolJsonStreamParser is not a function" / module not found.

- [ ] **Step 3: Implement the parser**

```ts
// supabase/functions/_shared/stream-json-fields.ts
// Pure streaming parser for the partial JSON object Claude emits as a tool's
// input (input_json_delta). Given a known root object, it identifies top-level
// (depth-1) fields, emits `text` deltas for declared string fields as they
// grow, and a `complete` event (with the JSON-parsed value) when each field
// closes. No I/O, no globals.

export type FieldEvent =
  | { type: 'text'; field: string; delta: string }
  | { type: 'complete'; field: string; value: unknown };

export interface ToolJsonStreamParser {
  push(deltaJson: string): FieldEvent[];
  finish(): FieldEvent[];
}

type Mode =
  | 'before-root'      // before the opening {
  | 'expect-key'       // at depth 1, expecting a key string or }
  | 'in-key'           // reading a depth-1 key string
  | 'expect-colon'
  | 'expect-value'
  | 'in-string-value'  // depth-1 string value
  | 'in-compound'      // depth-1 value is object/array; track until depth returns to 1
  | 'in-primitive';    // number/true/false/null

export function createToolJsonStreamParser(opts: { textFields?: string[] }): ToolJsonStreamParser {
  const textFields = new Set(opts.textFields ?? []);
  let acc = '';
  let i = 0;                 // scan cursor into acc (persists across pushes)
  let mode: Mode = 'before-root';
  let depth = 0;
  let esc = false;
  let keyStart = -1;
  let currentKey = '';
  let valueStart = -1;       // index in acc where the current top-level value begins
  let emittedTextLen = 0;    // decoded length already emitted for the active text field

  // Decode the in-progress string value [valueStart..end] (value begins at the
  // opening quote) tolerantly, returning the decoded string so far.
  function decodePartialString(): string {
    let frag = acc.slice(valueStart); // starts with the opening quote
    // Drop a trailing dangling backslash (incomplete escape) so JSON.parse succeeds.
    const trailingBackslashes = frag.length - frag.replace(/\\+$/, '').length;
    if (trailingBackslashes % 2 === 1) frag = frag.slice(0, -1);
    try {
      return JSON.parse(frag + '"') as string;
    } catch {
      return ''; // unparseable mid-stream; wait for more
    }
  }

  function push(deltaJson: string): FieldEvent[] {
    acc += deltaJson;
    const out: FieldEvent[] = [];

    while (i < acc.length) {
      const c = acc[i];

      switch (mode) {
        case 'before-root':
          if (c === '{') { depth = 1; mode = 'expect-key'; }
          i++; break;

        case 'expect-key':
          if (c === '"') { keyStart = i; mode = 'in-key'; i++; }
          else if (c === '}') { depth = 0; i++; }
          else i++; // whitespace, comma
          break;

        case 'in-key':
          if (esc) { esc = false; i++; }
          else if (c === '\\') { esc = true; i++; }
          else if (c === '"') {
            currentKey = JSON.parse(acc.slice(keyStart, i + 1)) as string;
            mode = 'expect-colon'; i++;
          } else i++;
          break;

        case 'expect-colon':
          if (c === ':') mode = 'expect-value';
          i++; break;

        case 'expect-value':
          if (c === ' ' || c === '\n' || c === '\t' || c === '\r') { i++; break; }
          valueStart = i;
          if (c === '"') { mode = 'in-string-value'; emittedTextLen = 0; i++; }
          else if (c === '{' || c === '[') { depth++; mode = 'in-compound'; i++; }
          else { mode = 'in-primitive'; i++; }
          break;

        case 'in-string-value':
          if (esc) { esc = false; i++; }
          else if (c === '\\') { esc = true; i++; }
          else if (c === '"') {
            // string value closed at depth 1
            i++;
            const value = JSON.parse(acc.slice(valueStart, i)) as string;
            if (textFields.has(currentKey)) {
              const tail = value.slice(emittedTextLen);
              if (tail) out.push({ type: 'text', field: currentKey, delta: tail });
            }
            out.push({ type: 'complete', field: currentKey, value });
            mode = 'expect-key';
          } else i++;
          break;

        case 'in-compound':
          if (esc) { esc = false; i++; break; }
          if (c === '\\') { esc = true; i++; break; }
          if (c === '"') {
            // skip a string inside the compound value wholesale
            i++;
            while (i < acc.length) {
              const d = acc[i];
              if (esc) { esc = false; i++; continue; }
              if (d === '\\') { esc = true; i++; continue; }
              if (d === '"') { i++; break; }
              i++;
            }
            break;
          }
          if (c === '{' || c === '[') { depth++; i++; break; }
          if (c === '}' || c === ']') {
            depth--; i++;
            if (depth === 1) {
              const value = JSON.parse(acc.slice(valueStart, i));
              out.push({ type: 'complete', field: currentKey, value });
              mode = 'expect-key';
            }
            break;
          }
          i++; break;

        case 'in-primitive':
          if (c === ',' || c === '}' || c === ' ' || c === '\n' || c === '\t' || c === '\r') {
            const value = JSON.parse(acc.slice(valueStart, i));
            out.push({ type: 'complete', field: currentKey, value });
            mode = (c === '}') ? 'before-root' : 'expect-key';
            if (c === '}') depth = 0;
            i++;
          } else i++;
          break;
      }
    }

    // Mid-string text streaming: emit any newly-decodable suffix of the active
    // text field without waiting for the closing quote.
    if (mode === 'in-string-value' && textFields.has(currentKey)) {
      const decoded = decodePartialString();
      if (decoded.length > emittedTextLen) {
        out.push({ type: 'text', field: currentKey, delta: decoded.slice(emittedTextLen) });
        emittedTextLen = decoded.length;
      }
    }

    return out;
  }

  function finish(): FieldEvent[] { return []; }

  return { push, finish };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run supabase/functions/_shared/stream-json-fields.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stream-json-fields.ts supabase/functions/_shared/stream-json-fields.test.ts
git commit -m "feat(lamplight): streaming tool-JSON field parser"
```

---

## Task A2: SSE encoder + streaming Response helper

**Files:**
- Create: `supabase/functions/_shared/sse.ts`, `supabase/functions/_shared/sse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SseEvent = /* the SSE Event Protocol union above */;
  export function encodeSseEvent(ev: SseEvent): string;          // "data: {...}\n\n"
  export function sseResponse(
    cors: Record<string, string>,
    body: ReadableStream<Uint8Array>,
  ): Response;                                                   // text/event-stream + CORS + no-cache
  export function sseStreamFromWriter(
    write: (emit: (ev: SseEvent) => Promise<void>) => Promise<void>,
  ): ReadableStream<Uint8Array>;                                 // drives `write`, encodes each event, closes
  ```

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run supabase/functions/_shared/sse.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run to verify pass** → `npx vitest run supabase/functions/_shared/sse.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/sse.ts supabase/functions/_shared/sse.test.ts
git commit -m "feat(lamplight): SSE encoder + streaming Response helper"
```

---

## Task A3: Streaming method on the Anthropic adapter

**Files:**
- Modify: `supabase/functions/_shared/anthropic.ts`
- Test: `supabase/functions/_shared/anthropic.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `createToolJsonStreamParser` (A1).
- Produces — add to `LLMAdapter`:
  ```ts
  export interface StreamHandlers {
    onText?: (field: string, delta: string) => void;
    onField?: (field: string, value: unknown) => void;
  }
  export interface GenerateStreamInput extends GenerateInput {
    textFields?: string[];
    signal?: AbortSignal;        // propagate client abort → stop spend
  }
  // on LLMAdapter:
  generateStream<T>(input: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<T>>;
  ```
  Sets `stream: true`, reads the Messages SSE, feeds `input_json_delta.partial_json` into the parser, fires handlers, and resolves with the fully-parsed object + token usage. **Before implementing, confirm the Anthropic streaming event shapes via Context7 / the Messages streaming docs** — the relevant events are `message_start` (usage.input_tokens), `content_block_start` (the `tool_use` block), `content_block_delta` with `delta.type === 'input_json_delta'` and `delta.partial_json`, `message_delta` (usage.output_tokens), `message_stop`.

- [ ] **Step 1: Write the failing test** (append to `anthropic.test.ts`)

```ts
import { createAnthropicAdapter as _mkAdapter } from './anthropic'; // already imported above; reuse

function sseStreamResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('createAnthropicAdapter.generateStream', () => {
  it('streams tool-JSON field events and resolves the parsed object + usage', async () => {
    const lines = [
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":11,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"emit_chat_reply","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"reply\\":\\"He"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"llo\\",\\"citations\\":[]}"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{},"usage":{"output_tokens":7}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = _mkAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const texts: string[] = [];
    const fields: Array<{ field: string; value: unknown }> = [];
    const out = await adapter.generateStream<{ reply: string; citations: unknown[] }>(
      { model: 'sonnet', system: 's', messages: [{ role: 'user', content: 'hi' }],
        tool: { name: 'emit_chat_reply', description: 'd', input_schema: { type: 'object' } },
        textFields: ['reply'] },
      { onText: (_f, d) => texts.push(d), onField: (f, v) => fields.push({ field: f, value: v }) },
    );
    expect(texts.join('')).toBe('Hello');
    expect(fields).toContainEqual({ field: 'citations', value: [] });
    expect(out.parsed).toEqual({ reply: 'Hello', citations: [] });
    expect(out.promptTokens).toBe(11);
    expect(out.completionTokens).toBe(7);
    // request body sets stream:true
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run supabase/functions/_shared/anthropic.test.ts -t generateStream` → FAIL ("generateStream is not a function").

- [ ] **Step 3: Implement** — add to `anthropic.ts`:

```ts
import { createToolJsonStreamParser } from './stream-json-fields.ts';

export interface StreamHandlers {
  onText?: (field: string, delta: string) => void;
  onField?: (field: string, value: unknown) => void;
}
export interface GenerateStreamInput extends GenerateInput {
  textFields?: string[];
  signal?: AbortSignal;
}
```

Add `generateStream` to the `LLMAdapter` interface, and to the object returned by `createAnthropicAdapter`:

```ts
async generateStream<T>(input: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<T>> {
  const res = await deps.fetch(ANTHROPIC_BASE, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'x-api-key': deps.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_IDS[input.model],
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: input.system,
      messages: input.messages,
      tools: [input.tool],
      tool_choice: { type: 'tool', name: input.tool.name },
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`anthropic stream ${res.status}: ${detail.slice(0, 500)}`);
  }

  const parser = createToolJsonStreamParser({ textFields: input.textFields });
  let modelUsed = MODEL_IDS[input.model];
  let promptTokens = 0;
  let completionTokens = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const flush = (events: ReturnType<typeof parser.push>) => {
    for (const ev of events) {
      if (ev.type === 'text') handlers.onText?.(ev.field, ev.delta);
      else handlers.onField?.(ev.field, ev.value);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    // SSE events are separated by blank lines; we only need the `data:` payloads.
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(json); } catch { continue; }
      const type = evt.type as string;
      if (type === 'message_start') {
        const u = (evt.message as { model?: string; usage?: { input_tokens?: number } })?.usage;
        modelUsed = (evt.message as { model?: string })?.model ?? modelUsed;
        promptTokens = u?.input_tokens ?? 0;
      } else if (type === 'content_block_delta') {
        const delta = evt.delta as { type?: string; partial_json?: string };
        if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          flush(parser.push(delta.partial_json));
        }
      } else if (type === 'message_delta') {
        const u = (evt.usage as { output_tokens?: number }) ?? {};
        if (typeof u.output_tokens === 'number') completionTokens = u.output_tokens;
      }
    }
  }
  flush(parser.finish());

  // Reconstruct the full parsed object from the accumulated raw JSON. Simplest:
  // the parser's `complete` events for top-level fields already gave us values;
  // assemble them. (Track them during flush via a local accumulator.)
  // -- see assembledObject below.
  return { parsed: assembled as T, modelUsed, promptTokens, completionTokens };
}
```

Implementation note for the assembled object: maintain `const assembled: Record<string, unknown> = {}` and set `assembled[ev.field] = ev.value` inside `flush` on `complete` events; return it as `parsed`. (Add that accumulator in the real edit.)

- [ ] **Step 4: Run to verify pass** → `npx vitest run supabase/functions/_shared/anthropic.test.ts` → PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/anthropic.ts supabase/functions/_shared/anthropic.test.ts
git commit -m "feat(lamplight): streaming generate on the Anthropic adapter"
```

---

## Task A4: Streaming retry loop (`generateStreamingWithRetry`)

**Files:**
- Create: `supabase/functions/_shared/generate-streaming.ts`, `supabase/functions/_shared/generate-streaming.test.ts`

**Interfaces:**
- Consumes: `LLMAdapter.generateStream` (A3), `composeSystem`/`LAMPLIGHT_SYSTEM_FRAGMENT` (`./voice.ts`, as in `generate-with-retry.ts`).
- Produces:
  ```ts
  export interface StreamingRetryConfig<TParsed, TViolations>
    extends Omit<GenerateWithRetryConfig<TParsed, TViolations>, never> {
    textFields?: string[];
    signal?: AbortSignal;
    // per-field gate: return violations for a single just-completed field; if
    // non-empty, the field is NOT emitted and the loop aborts to a retry.
    perFieldValidate?: (field: string, value: unknown) => TViolations | null;
    onStage?: (stage: 'composing') => void;
    onText?: (field: string, delta: string) => void;
    onPiece?: (field: string, value: unknown) => void;
    onRefining?: () => void;
  }
  export function generateStreamingWithRetry<TParsed, TViolations>(
    cfg: StreamingRetryConfig<TParsed, TViolations>,
  ): Promise<RetryOutcome<TParsed, TViolations>>;
  ```
  Behavior: attempt 1 streams. As fields complete, run `perFieldValidate`; if it returns violations, suppress the field, mark the attempt failed, finish reading the stream, then go to a non-streaming retry (`cfg.llm.generate`) — calling `onRefining()` once before the retry **only if any piece/text was already emitted**. On stream success, run the full `cfg.validate`; pass → `onPiece`/`onText` were already fired and we return ok; cross-field fail → `onRefining()` + non-streaming retry. Return the same `RetryOutcome` shape so pipelines stay uniform.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/generate-streaming.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateStreamingWithRetry } from './generate-streaming';
import type { LLMAdapter } from './anthropic';

// Fake adapter: generateStream replays scripted field events; generate returns a fixed object.
function fakeLlm(opts: {
  streamFields: Array<{ field: string; value: unknown }>;
  streamParsed: unknown;
  retryParsed?: unknown;
}): LLMAdapter {
  return {
    generate: vi.fn(async () => ({ parsed: opts.retryParsed ?? opts.streamParsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 5, completionTokens: 6 })) as any,
    generateStream: vi.fn(async (_input, handlers) => {
      for (const f of opts.streamFields) handlers.onField?.(f.field, f.value);
      return { parsed: opts.streamParsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 5, completionTokens: 9 };
    }) as any,
  };
}

const baseCfg = {
  model: 'sonnet' as const, maxTokens: 1024, artifactSystem: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tool: { name: 'emit', description: 'd', input_schema: { type: 'object' } },
  formatStricter: () => 'stricter',
};

describe('generateStreamingWithRetry', () => {
  it('emits pieces as fields complete and returns ok when validate passes', async () => {
    const pieces: string[] = [];
    const out = await generateStreamingWithRetry({
      ...baseCfg,
      llm: fakeLlm({ streamFields: [{ field: 'opening', value: 'hi' }, { field: 'prompt', value: 'q' }], streamParsed: { opening: 'hi', prompt: 'q' } }),
      validate: async () => ({ ok: true, violations: null }),
      onPiece: (f) => pieces.push(f),
    });
    expect(pieces).toEqual(['opening', 'prompt']);
    expect(out.ok).toBe(true);
  });

  it('calls onRefining and retries when a cross-field validator fails after pieces showed', async () => {
    const refining = vi.fn();
    let calls = 0;
    const out = await generateStreamingWithRetry({
      ...baseCfg,
      llm: fakeLlm({ streamFields: [{ field: 'opening', value: 'hi' }], streamParsed: { opening: 'hi' }, retryParsed: { opening: 'fixed' } }),
      validate: async () => { calls++; return calls === 1 ? { ok: false, violations: ['bad'] } : { ok: true, violations: null }; },
      onRefining: refining,
    });
    expect(refining).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
  });

  it('suppresses a field that fails its per-field gate (no onPiece) and retries', async () => {
    const pieces: string[] = [];
    const refining = vi.fn();
    const out = await generateStreamingWithRetry({
      ...baseCfg,
      llm: fakeLlm({ streamFields: [{ field: 'reflection', value: 'too short' }], streamParsed: { reflection: 'too short' }, retryParsed: { reflection: 'long enough now' } }),
      perFieldValidate: (f, v) => (f === 'reflection' && String(v).length < 10 ? ['too_short'] : null),
      validate: async () => ({ ok: true, violations: null }),
      onPiece: (f) => pieces.push(f),
      onRefining: refining,
    });
    expect(pieces).not.toContain('reflection'); // suppressed on attempt 1
    expect(refining).toHaveBeenCalled();
    expect(out.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run supabase/functions/_shared/generate-streaming.test.ts` → FAIL.

- [ ] **Step 3: Implement** (model the system-composition + retry shape on `generate-with-retry.ts`):

```ts
// supabase/functions/_shared/generate-streaming.ts
import type { GenerateStreamInput, LLMAdapter } from './anthropic.ts';
import { LAMPLIGHT_SYSTEM_FRAGMENT, composeSystem } from './voice.ts';
import type { GenerateWithRetryConfig, RetryOutcome } from './generate-with-retry.ts';

export interface StreamingRetryConfig<TParsed, TViolations>
  extends GenerateWithRetryConfig<TParsed, TViolations> {
  textFields?: string[];
  signal?: AbortSignal;
  perFieldValidate?: (field: string, value: unknown) => TViolations | null;
  onStage?: (stage: 'composing') => void;
  onText?: (field: string, delta: string) => void;
  onPiece?: (field: string, value: unknown) => void;
  onRefining?: () => void;
}

export async function generateStreamingWithRetry<TParsed, TViolations>(
  cfg: StreamingRetryConfig<TParsed, TViolations>,
): Promise<RetryOutcome<TParsed, TViolations>> {
  const system = composeSystem({ base: LAMPLIGHT_SYSTEM_FRAGMENT, artifact: cfg.artifactSystem, stricter: '', tokens: cfg.systemTokens });
  const input: GenerateStreamInput = {
    model: cfg.model, system, messages: cfg.messages, tool: cfg.tool,
    maxTokens: cfg.maxTokens, textFields: cfg.textFields, signal: cfg.signal,
  };

  let emittedAnything = false;
  let perFieldFailed: TViolations | null = null;
  cfg.onStage?.('composing');

  const stream = await cfg.llm.generateStream<TParsed>(input, {
    onText: (f, d) => { if (perFieldFailed) return; emittedAnything = true; cfg.onText?.(f, d); },
    onField: (f, v) => {
      if (perFieldFailed) return;
      const gate = cfg.perFieldValidate?.(f, v) ?? null;
      const empty = gate === null || (Array.isArray(gate) && gate.length === 0);
      if (!empty) { perFieldFailed = gate; return; }      // suppress; will retry
      emittedAnything = true;
      cfg.onPiece?.(f, v);
    },
  });

  // Cross-field validation on the fully-streamed object.
  const crossFail = perFieldFailed ? { ok: false as const, violations: perFieldFailed }
    : await cfg.validate(stream.parsed);

  if (crossFail.ok) {
    return { ok: true, parsed: stream.parsed, modelUsed: stream.modelUsed, promptTokens: stream.promptTokens, completionTokens: stream.completionTokens, attempts: 1 };
  }

  // Gentle "refining" beat only if something was already on screen.
  if (emittedAnything) cfg.onRefining?.();

  // Non-streaming stricter retry (mirrors generate-with-retry attempt 2).
  const stricterSystem = composeSystem({ base: LAMPLIGHT_SYSTEM_FRAGMENT, artifact: cfg.artifactSystem, stricter: cfg.formatStricter(crossFail.violations), tokens: cfg.systemTokens });
  const retry = await cfg.llm.generate<TParsed>({ model: cfg.model, system: stricterSystem, messages: cfg.messages, tool: cfg.tool, maxTokens: cfg.maxTokens });
  const retryValidate = await cfg.validate(retry.parsed);
  if (retryValidate.ok) {
    return { ok: true, parsed: retry.parsed, modelUsed: retry.modelUsed, promptTokens: retry.promptTokens, completionTokens: retry.completionTokens, attempts: 2 };
  }
  return { ok: false, violations: retryValidate.violations, modelUsed: retry.modelUsed, attempts: 2 };
}
```

- [ ] **Step 4: Run to verify pass** → `npx vitest run supabase/functions/_shared/generate-streaming.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/generate-streaming.ts supabase/functions/_shared/generate-streaming.test.ts
git commit -m "feat(lamplight): streaming validate/retry loop with refining beat"
```

---

# Phase B — Edge functions emit SSE + client transport

## Task B1: Streaming entry on the daily-devotion pipeline

**Files:**
- Modify: `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts`

**Interfaces:**
- Consumes: `generateStreamingWithRetry` (A4), existing validators.
- Produces: `runDailyDevotionStreaming(args, handlers)` where `handlers = { onStage, onPiece, onRefining }`; returns the same `DailyDevotionPipelineResult`. The cache pre-check, `no_notes` guard, persistence and race-handling are reused verbatim — only the `generateWithRetry` call is swapped for `generateStreamingWithRetry`, passing `perFieldValidate` for `opening` (80–280), `reflection` (400–900), `prompt` (1–200) length and `onStage('composing')`/`onPiece`/`onRefining` through. Field order for `textFields` is `[]` (daily lamp pops whole pieces). The existing `runDailyDevotionPipeline` stays as the buffered fallback.

- [ ] **Step 1: Write the failing test** — add to (or create) `supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts`: a test that injects a fake `llm` with `generateStream` replaying the five fields and a fake `supabase` (reuse the existing test's supabase fake), asserts `onPiece` fires for each field in order and the result persists. *(Read the existing pipeline test first to reuse its supabase fake + valid-artifact fixture; copy its fixture rather than inventing one.)*

- [ ] **Step 2: Run** → FAIL (`runDailyDevotionStreaming` not exported).

- [ ] **Step 3: Implement** `runDailyDevotionStreaming`: copy `runDailyDevotionPipeline`, replace the `generateWithRetry<DailyDevotion, DailyViolations>({...})` call with `generateStreamingWithRetry<DailyDevotion, DailyViolations>({ ...sameConfig, onStage: handlers.onStage, onPiece: handlers.onPiece, onRefining: handlers.onRefining, perFieldValidate: (field, value) => devotionFieldGate(field, value) })`, where `devotionFieldGate` returns `{ citation: [], content: [{ family: 'length', ... }] }`-shaped violations when a string field is out of its `minLength`/`maxLength` (numbers copied verbatim from the tool schema: opening 80–280, reflection 400–900, prompt 1–200). Everything after the outcome (persist/race/return) is unchanged.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(lamplight-generate): streaming daily-devotion pipeline entry`.

---

## Task B2: Streaming entry on the bible-chat pipeline

**Files:**
- Modify: `supabase/functions/lamplight-chat/bible-chat-pipeline.ts`

**Interfaces:**
- Produces: `runBibleChatStreaming(args, handlers)` where `handlers = { onStage, onText, onPiece, onRefining }`; returns the same `BibleChatPipelineResult`. Swaps `generateWithRetry` for `generateStreamingWithRetry` with `textFields: ['reply']`, forwarding `onText` (reply deltas) and `onPiece` (citations). No `perFieldValidate` (chat has no per-field length rule) — the existing citation + content validators run as the cross-field `validate`.

- [ ] **Step 1: Write the failing test** in `bible-chat-pipeline.test.ts` (or create): fake `llm.generateStream` replaying reply text deltas + a `citations` field; assert `onText` deltas concatenate to the reply and `onPiece('citations', …)` fires; result `ok` with the reply.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `runBibleChatStreaming` mirroring `runBibleChatPipeline` with the streaming call.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lamplight-chat): streaming bible-chat pipeline entry`.

---

## Task B3: `lamplight-generate` emits SSE for `daily_devotion`

**Files:**
- Modify: `supabase/functions/lamplight-generate/index.ts`

**Approach:** When the request asks for streaming (header `accept: text/event-stream` OR body `stream: true`) and `kind === 'daily_devotion'`, run the same gates (JWT → opt-in → quota via `runGeneration`'s `checkQuota`) FIRST. If a gate blocks, return the normal JSON error (no SSE). Otherwise return `sseResponse(cors, sseStreamFromWriter(async (emit) => { ... }))`. Inside the writer: `emit({t:'stage',stage:'notes'})` before `buildDailyDevotionContext`, `emit({t:'stage',stage:'scripture'})` before the bible search (or simply both around context build), then call `runDailyDevotionStreaming` forwarding `onStage→emit stage`, `onPiece→emit piece`, `onRefining→emit refining`. On the pipeline result, `emit({t:'done',payload:<the existing buffered body>})` (or `{t:'error',reason}` on `ok:false`). Record usage via the same `recordLamplightUsage` call the envelope used (call it directly inside the writer since `runGeneration` returns a single Response; factor the quota check + usage recording so both the buffered and streaming paths share them).

**Key constraint:** quota check must still gate streaming. Extract a small helper `checkQuotaOrError()` reused by both paths; record usage after the stream completes (success or validators_failed) exactly as `runGeneration` did.

- [ ] **Step 1: Write the failing test** — `supabase/functions/lamplight-generate/index.stream.test.ts`: build a `Request` with `accept: text/event-stream` and `{kind:'daily_devotion', local_date}`; inject fakes (there is an existing pattern — *read `lamplight-generate`'s current test to reuse its Deno-env + supabase + fetch fakes*). Assert the Response `content-type` is `text/event-stream` and the body contains `"t":"stage"` then `"t":"piece"` then `"t":"done"`. Assert a not-opted-in user still gets a JSON 403 (no stream).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the streaming branch + shared quota/usage helper.
- [ ] **Step 4: Run** → PASS; also run the existing `lamplight-generate` tests to confirm the buffered path is unchanged.
- [ ] **Step 5: Commit** `feat(lamplight-generate): SSE streaming for daily_devotion`.

---

## Task B4: `lamplight-chat` emits SSE + the client transport

**Files:**
- Modify: `supabase/functions/lamplight-chat/index.ts`
- Create: `src/notepad/bible/lamplight-stream-client.ts`, `src/notepad/bible/lamplight-stream-client.test.ts`
- Create: `src/notepad/bible/sentence-chunker.ts`, `src/notepad/bible/sentence-chunker.test.ts`

**B4a — edge:** mirror B3 in `lamplight-chat/index.ts`. Stream path: gates first (opt-in + `hasChatAccess` + quota), persist the user message before generation, forward `runBibleChatStreaming` handlers to `emit`, persist the assistant message + thread bump on success, then `emit({t:'done',payload:{ok,thread_id,reply,citations}})`. Insight-mode on a non-empty thread still returns the buffered `{ok:true,skipped:true}` JSON.

**B4b — sentence chunker:**

**Interfaces:**
```ts
// src/notepad/bible/sentence-chunker.ts
export function createSentenceChunker(): {
  push(delta: string): string[];   // returns whole sentence/paragraph chunks ready to reveal
  flush(): string;                  // remaining buffered tail
};
```
Flush a chunk when the buffer ends in `.`/`!`/`?` followed by whitespace, or contains a paragraph break (`\n\n`).

- [ ] **Step 1 (chunker): failing test**

```ts
// src/notepad/bible/sentence-chunker.test.ts
import { describe, it, expect } from 'vitest';
import { createSentenceChunker } from './sentence-chunker';

it('emits a chunk at a sentence boundary, holds a partial', () => {
  const c = createSentenceChunker();
  expect(c.push('Hello world. ')).toEqual(['Hello world. ']);
  expect(c.push('Half a sen')).toEqual([]);
  expect(c.push('tence? Next.')).toEqual(['Half a sentence? ']);
  expect(c.flush()).toBe('Next.');
});

it('breaks on a paragraph break', () => {
  const c = createSentenceChunker();
  expect(c.push('Para one\n\nPara two')).toEqual(['Para one\n\n']);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

**B4c — transport:**

**Interfaces:**
```ts
// src/notepad/bible/lamplight-stream-client.ts
import type { SupabaseClient } from '@supabase/supabase-js';
export type StreamInvoke = (name: string, body: unknown, handlers: {
  onEvent: (ev: import('...sse-type').SseEvent) => void;
  signal?: AbortSignal;
}) => Promise<void>;
// Build a StreamInvoke from a Supabase client (direct fetch + SSE reader).
export function makeStreamInvoke(client: SupabaseClient): StreamInvoke;
```
`makeStreamInvoke`: read `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (import from `src/lib/supabase.ts`'s constants, or re-read `import.meta.env`), `await client.auth.getSession()` for the access token, `fetch(`${url}/functions/v1/${name}`, { method:'POST', signal, headers:{ Authorization:`Bearer ${token}`, apikey: anon, accept:'text/event-stream', 'content-type':'application/json' }, body: JSON.stringify({ ...body, stream:true }) })`, then read `res.body` with the same SSE line-parsing as the adapter, calling `onEvent` per decoded event. (The `SseEvent` type is mirrored client-side — copy the union into this file; do not import from `supabase/functions`.)

- [ ] **Step 1 (transport): failing test** — inject a fake `client` whose `auth.getSession` returns a token and a fake global `fetch` returning an SSE `ReadableStream`; assert `onEvent` is called with the decoded events in order, and the request body has `stream:true` + the bearer header.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lamplight): SSE chat endpoint + client transport + sentence chunker`.

---

# Phase C — Chat UI streaming

## Task C1: `ChatMessage` streaming affordance

**Files:**
- Modify: `src/notepad/components/lamplight/chat/ChatMessage.tsx`

**Interfaces:**
- Produces: `ChatMessageProps` gains `streaming?: boolean` and `stage?: 'notes'|'scripture'|'composing'|null`. When `streaming` and `content` is empty, render the narration line (mapped from `stage`); when `streaming` and content present, append an in-progress caret (a `<span aria-hidden> ▍</span>` with a `prefers-reduced-motion`-aware blink). Existing rendering otherwise unchanged.

- [ ] **Step 1: failing test** — `ChatMessage.test.tsx` (RTL): renders narration "Reading your recent notes…" when `streaming` + empty + `stage='notes'`; renders content + caret when `streaming` + content. *(Check for an existing RTL setup; the repo uses Vitest — confirm `@testing-library/react` is available before writing.)*
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (map stage→copy reusing the same strings as `TodaysLampLoading`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lamplight-chat): streaming caret + narration in ChatMessage`.

## Task C2: `useChatThread.updateLast()`

**Files:**
- Modify: `src/notepad/bible/useChatThread.ts` (+ its test)

*(Read `useChatThread.ts` first.)* Add `updateLast(patch: Partial<ChatThreadMessage>)` that immutably replaces the last message (used to grow the streaming assistant message's `content` and attach `citations`/clear the `streaming` flag). TDD: test that `append` then `updateLast({content})` mutates only the last message.

- [ ] Steps 1–5 as standard TDD; commit `feat(lamplight-chat): updateLast on useChatThread`.

## Task C3: Wire streaming into `LamplightChat`

**Files:**
- Modify: `src/notepad/components/lamplight/chat/LamplightChat.tsx`, `src/components/sections/Notepad.tsx:63,277`, `src/components/sections/notepad/mobile/useMobileWorkspaceModel.ts:49`

**Approach:** add a `streamInvoke?: StreamInvoke` prop (bound in `Notepad.tsx`/mobile from `makeStreamInvoke(supabase!)`). In `send()`/`requestReflection()`: append the user message, then append a placeholder assistant message `{ role:'assistant', content:'', citations:[], streaming:true }`; create an `AbortController` stored in a ref; call `streamInvoke('lamplight-chat', { book, chapter, message, translation }, { onEvent, signal })`. `onEvent` handles: `stage`→`updateLast({stage})`; `text`→push delta through a per-send `createSentenceChunker()` and on each chunk `updateLast({content: content+chunk, stage:null})`; `piece{field:'citations'}`→`updateLast({citations})`; `refining`→`updateLast({content:'', stage:'composing'})` then accept the forthcoming `replace`/`done`; `done`→flush chunker tail, `updateLast({streaming:false, content:<final reply>, citations})`; `error`→`updateLast({streaming:false})` + `setError`. Abort the controller in the existing `passageKey` effect and on unmount. **Fallback:** if `streamInvoke` is undefined or throws synchronously, fall back to the current `sendChatMessage`/`requestOpeningInsight` buffered path (keep those imports).

- [ ] **Step 1: failing test** — extend `LamplightChat`'s test (or create) with a fake `streamInvoke` that emits `stage`,`text`×2,`piece(citations)`,`done`; assert the assistant bubble grows and ends with the full reply + citations, and that changing `book`/`chapter` aborts (the controller's `abort` is called). 
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** + bind in `Notepad.tsx` and mobile model. **Step 4: Run** → PASS; `npm run test` for chat suite.
- [ ] **Step 5: Commit** `feat(lamplight-chat): live streaming send + reflection with abort + fallback`.

---

# Phase D — Today's Lamp UI streaming

## Task D1: Adapter `streamDailyDevotion`

**Files:**
- Modify: `src/notepad/storage/lamplight-adapter.ts` (interface + `DailyDevotionStreamEvent`), `src/notepad/storage/supabase-lamplight-adapter.ts`

*(Read `lamplight-adapter.ts` first.)*

**Interfaces:**
```ts
export type DailyDevotionStreamEvent =
  | { kind: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
  | { kind: 'piece'; field: keyof DailyDevotion; value: unknown }
  | { kind: 'refining' }
  | { kind: 'done'; artifact: DailyDevotion; cached: boolean }
  | { kind: 'error'; reason: 'no_notes' | 'validators_failed' | 'network' };
// on LamplightAdapter:
streamDailyDevotion?(
  userId: string, localDate: string,
  onEvent: (ev: DailyDevotionStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void>;
```
`SupabaseLamplightAdapter.streamDailyDevotion`: if a `StreamInvoke` is available (inject `makeStreamInvoke(this.#client)` lazily), map SSE `SseEvent`→`DailyDevotionStreamEvent` and forward; on any transport failure call `onEvent({kind:'error',reason:'network'})` — callers fall back to buffered `generateDailyDevotion`. Keep `generateDailyDevotion` as-is for cache hits and fallback.

- [ ] TDD: fake `StreamInvoke`; assert events map correctly + a transport throw yields a single `error` event. Commit `feat(lamplight): streamDailyDevotion adapter`.

## Task D2: Controller streaming phases

**Files:**
- Modify: `src/notepad/lamplight/todays-lamp-controller.ts` (+ test)

**Interfaces:**
```ts
export type TodaysLampState =
  | { phase: 'idle' }
  | { phase: 'retrieving'; stage: 'notes' | 'scripture' | 'composing' }
  | { phase: 'generating'; pieces: Partial<DailyDevotion> }
  | { phase: 'refining'; pieces: Partial<DailyDevotion> }
  | { phase: 'ready'; artifact: DailyDevotion }
  | { phase: 'error'; reason: 'no_notes' | 'validators_failed' | 'network' };
```
Delete `startInterval`/`stopInterval`/`loadingStep`/`loadingStepIntervalMs` and the `setInterval`/`clearInterval` deps. `run()`: `getExisting` first (cache hit → `ready` immediately, no streaming). On miss + `shouldGenerate`: call the streaming `generate` dep (now `streamDailyDevotion`-shaped: takes `onEvent`); map `stage`→`retrieving{stage}`, the first `piece`→transition to `generating{pieces}` accumulating fields, `refining`→`refining{pieces}`, `done`→`ready{artifact}`, `error`→`error`. Keep the `generation`-counter stale-fence (apply it inside `onEvent` via `isStale(gen)`). Provide an `abort()` via an `AbortController` created per run and aborted in `dispose()`/on a new run.

- [ ] **Step 1: failing test** *(read existing controller test first)* — fake streaming `generate` replaying `stage`,`piece`×5,`done`; assert phases progress `retrieving→generating(accumulating)→ready`, and a `refining` event yields a `refining` phase then `ready`. Assert cache hit → `ready` with no generate call. Assert a superseding `setInputs` drops late events (stale fence).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lamplight): Today's Lamp controller streaming phases`.

## Task D3: `useTodaysLamp` + `TodaysLampLoading` wiring

**Files:**
- Modify: `src/notepad/hooks/useTodaysLamp.ts`, `src/notepad/components/lamplight/TodaysLampLoading.tsx`

`useTodaysLamp`: drop `loadingStepIntervalMs`; build the controller `generate` dep from `adapter.streamDailyDevotion` (fall back to wrapping `adapter.generateDailyDevotion` as a one-shot `done`/`error` emitter when `streamDailyDevotion` is absent). `TodaysLampLoading`: change props from `step` to `stage: 'notes'|'scripture'|'composing'`; map `notes`→"Reading your recent notes…", `scripture`→"Searching Scripture…", `composing`→`loadingState(firstName)`. Update `TodaysLampCard` to pass `state.stage` for the `retrieving` phase.

- [ ] TDD where practical (hook is thin; rely on controller tests). Commit `feat(lamplight): wire Today's Lamp loading narration to real stages`.

## Task D4: `TodaysLampCard` incremental unfold

**Files:**
- Modify: `src/notepad/components/lamplight/TodaysLampCard.tsx`

Render for `retrieving` → `<TodaysLampLoading stage={state.stage} firstName={firstName} />`. For `generating`/`refining` → render `<Devotion>` from a **partial** artifact: only render each block when its field is present in `state.pieces`; show a small "Lamplight is refining this…" line above the card when `phase==='refining'`. Each block wraps in a reveal element with a fade+rise transition gated behind `@media (prefers-reduced-motion: no-preference)` (use an existing motion utility/class if the repo has one — otherwise a small inline CSS-in-JS with a `motion-safe:` Tailwind variant). The `ready` phase renders the full `<Devotion>` exactly as today.

- [ ] **Step 1: failing test** (RTL): given `generating` with `pieces={opening}` only, the opening renders and scripture/reflection do NOT; given full `pieces`, all render. Given `prefers-reduced-motion`, no transition class is applied.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (extract `<Devotion>` to accept `Partial<DailyDevotion>` + a `partial` flag). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lamplight): Today's Lamp card unfolds pieces with reduced-motion guard`.

---

## Final verification (run after Phase D)

- [ ] `npx vitest run supabase/functions/_shared src/notepad/bible src/notepad/lamplight src/notepad/components/lamplight` — all new + existing pass.
- [ ] `npm run test` — confirm only the known pre-existing failures (`Editor.toolbar-placement`, `garden-scene`) remain; zero new failures.
- [ ] `npx eslint .` — zero NEW lint errors vs the ~114 baseline.
- [ ] `npx tsc -b` — zero NEW tsc errors vs the 4 baseline in `force-sphere.test.ts`.
- [ ] Manual smoke (local `supabase functions serve` + `npm run dev`): first-of-day Today's Lamp streams `retrieving → unfold → ready`; a chat send streams narration → chunked reply → citations; a cache-hit Today's Lamp loads instantly (no streaming); `prefers-reduced-motion` shows no transitions; force a validator failure (e.g. temporarily tighten a length gate) to watch the `refining` beat then `replace`.

## Deploy (manual — NOT carried by Vercel)

- [ ] `supabase functions deploy lamplight-generate --use-api`
- [ ] `supabase functions deploy lamplight-chat --use-api`
- [ ] Verify live: a real first-of-day devotion and a chat send stream end-to-end on the deployed functions.

---

## Plan self-review notes (author checklist — done)

- **Spec coverage:** structured reveal (A1+D4), pop-in whole + chat chunked (A1 textFields + B4b chunker + C3), genuine streaming (A3+B3/B4), honest pre-text narration (`stage` events A4/B3/B4 → C1/D3), gentle refining beat (A4 `onRefining` → C3/D4), unfold/grow (D4), reduced-motion (C1/D4), transport fallback (C3/D1), gates pre-stream (B3/B4), voice principle as cross-field validate (A4), quota unchanged + abort propagation (A3 `signal`, B3 shared helper), cache hit instant (D2), connection_why untouched (no task). All covered.
- **Type consistency:** `SseEvent` (`t`-discriminated) is the wire type (sse.ts + mirrored client copy in B4c); `FieldEvent` (`type`-discriminated) is the parser type; `DailyDevotionStreamEvent` (`kind`-discriminated) is the adapter type; `TodaysLampState` uses `phase`. These are intentionally distinct layers — do not unify.
- **Open reads flagged inline** (`useChatThread.ts`, `lamplight-adapter.ts`, existing pipeline/controller tests): read before the task that touches them; their internals weren't quoted in the spec so the task notes say "read first" rather than guessing private shapes.
