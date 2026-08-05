// OpenAI Responses API adapter — direct fetch, tool-call only.
//
// Imported by:
//   - supabase/functions/lamplight-generate (Deno runtime; injected global fetch)
//   - supabase/functions/lamplight-chat, lamplight-study, etymology-insight,
//     transcribe-note
//   - vitest tests (mocked fetch)
//
// No Deno or Node globals. Same pattern as voyage.ts.
//
// OpenAI API: POST https://api.openai.com/v1/responses with tool_choice forcing
// one specific function. The response carries the artifact as a JSON *string* in
// the `function_call` output item's `arguments`, which we parse and return as
// the object.
//
// WHY Responses and not Chat Completions: on Chat Completions the gpt-5.x
// reasoning models reject function tools unless reasoning_effort is 'none', so
// every Lamplight call ran with reasoning off. The Responses API lifts that
// constraint — forced function tools and reasoning coexist — which is the whole
// point of this transport. Per-call effort is resolved from `effort` or the
// per-tier default below.
//
// PRIVACY INVARIANT: every request sends `store: false`. The Responses API
// persists response objects on OpenAI's side by default; a journaling app must
// opt out. Do not remove this without a product decision.
//
// The tier names below (fast/balanced/deep) are deliberately provider-neutral:
// every pipeline names a tier, and only MODEL_IDS maps a tier onto a vendor id.

import { createToolJsonStreamParser } from './stream-json-fields.ts';

const OPENAI_BASE = 'https://api.openai.com/v1/responses';
const MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 2048;

export type LLMModel = 'fast' | 'balanced' | 'deep';

const MODEL_IDS: Record<LLMModel, string> = {
  fast:     'gpt-5.6-luna',
  balanced: 'gpt-5.6-terra',
  deep:     'gpt-5.6-sol',
};

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Per-tier default when a call names no effort. An explicit call-site `effort`
// always wins. 'balanced'/'deep' default to 'low' rather than 'none' — the
// point of this transport is that reasoning is now available to tool calls;
// pipelines opt further up (see each pipeline's call site) where the artifact
// justifies the spend. Reasoning tokens are billed as output tokens and count
// against maxTokens, so raising effort means raising the budget too.
export const TIER_DEFAULT_EFFORT: Record<LLMModel, ReasoningEffort> = {
  fast:     'none',
  balanced: 'low',
  deep:     'low',
};

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. Sent as OpenAI's `parameters`. */
  input_schema: Record<string, unknown>;
}

export type TextBlock = { type: 'text'; text: string };
export type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};
export type ContentBlock = TextBlock | ImageBlock;

export interface GenerateInput {
  model: LLMModel;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }>;
  tool: ToolSchema;
  maxTokens?: number;
  /** Reasoning effort for this call; defaults to TIER_DEFAULT_EFFORT[model]. */
  effort?: ReasoningEffort;
}

export interface GenerateOutput<T> {
  parsed: T;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
}

export interface StreamHandlers {
  onText?: (field: string, delta: string) => void;
  onField?: (field: string, value: unknown) => void;
}

export interface GenerateStreamInput extends GenerateInput {
  textFields?: string[];
  signal?: AbortSignal;
}

export interface LLMAdapter {
  generate<T>(input: GenerateInput): Promise<GenerateOutput<T>>;
  generateStream<T>(input: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<T>>;
}

export interface OpenAIDeps {
  apiKey: string;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// ── Request shaping ───────────────────────────────────────────────────────────

type OpenAIPart =
  | { type: 'input_text' | 'output_text'; text: string }
  | { type: 'input_image'; image_url: string };

// Responses takes inline images as a data-URI STRING on image_url (Chat
// Completions nested it under an object) and distinguishes input_text from
// output_text by which side of the conversation the item is on.
function toParts(role: 'user' | 'assistant', content: ContentBlock[]): OpenAIPart[] {
  const textType = role === 'assistant' ? 'output_text' as const : 'input_text' as const;
  return content.map((block): OpenAIPart =>
    block.type === 'text'
      ? { type: textType, text: block.text }
      : { type: 'input_image', image_url: `data:${block.source.media_type};base64,${block.source.data}` },
  );
}

function toInput(input: GenerateInput) {
  // A plain string content is valid on an input message item and keeps the
  // payload identical in spirit to the old messages array; only array content
  // needs part-type mapping.
  return input.messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : toParts(m.role, m.content),
  }));
}

export function effortFor(input: GenerateInput): ReasoningEffort {
  return input.effort ?? TIER_DEFAULT_EFFORT[input.model];
}

function buildBody(input: GenerateInput, stream: boolean): Record<string, unknown> {
  return {
    model: MODEL_IDS[input.model],
    // The system prompt is a top-level field on Responses, not a leading message.
    instructions: input.system,
    input: toInput(input),
    max_output_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    reasoning: { effort: effortFor(input) },
    // See PRIVACY INVARIANT in the file header.
    store: false,
    // Function tools are FLATTENED on Responses (no nested `function` key).
    // `strict` is deliberately not sent: strict mode requires every property to
    // appear in `required` and rejects some length/count keywords, which our
    // artifact schemas use (e.g. the monthly reflection's optional `date_end`,
    // minLength/maxItems bounds). Turning it on is a schema change with its own
    // tests, not part of a transport migration.
    tools: [{
      type: 'function',
      name: input.tool.name,
      description: input.tool.description,
      parameters: input.tool.input_schema,
    }],
    tool_choice: { type: 'function', name: input.tool.name },
    ...(stream ? { stream: true } : {}),
  };
}

function headers(deps: OpenAIDeps): Record<string, string> {
  return {
    'authorization': `Bearer ${deps.apiKey}`,
    'content-type': 'application/json',
  };
}

// ── Response shapes ───────────────────────────────────────────────────────────

interface OutputContentPart {
  type?: string;
  text?: string;
  refusal?: string;
}

interface OutputItem {
  type?: string;
  name?: string;
  arguments?: string;
  content?: OutputContentPart[];
}

interface ResponseBody {
  model: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; code?: string } | null;
}

/** The first refusal string across message output items, if the model refused. */
function findRefusal(output: OutputItem[] | undefined): string | null {
  for (const item of output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === 'refusal' && typeof part.refusal === 'string') return part.refusal;
    }
  }
  return null;
}

function findToolCall(output: OutputItem[] | undefined, name: string): OutputItem | null {
  return (output ?? []).find(i => i.type === 'function_call' && i.name === name) ?? null;
}

function truncatedAtCeiling(body: Pick<ResponseBody, 'status' | 'incomplete_details'>): boolean {
  return body.status === 'incomplete' && body.incomplete_details?.reason === 'max_output_tokens';
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export function createOpenAIAdapter(deps: OpenAIDeps): LLMAdapter {
  return {
    async generate<T>(input: GenerateInput): Promise<GenerateOutput<T>> {
      return generateOnce<T>(input, deps, 0);
    },

    async generateStream<T>(input: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<T>> {
      const res = await deps.fetch(OPENAI_BASE, {
        method: 'POST',
        signal: input.signal,
        headers: headers(deps),
        body: JSON.stringify(buildBody(input, true)),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`openai stream ${res.status}: ${detail.slice(0, 500)}`);
      }

      const parser = createToolJsonStreamParser({ textFields: input.textFields });
      let modelUsed = MODEL_IDS[input.model];
      let promptTokens = 0;
      let completionTokens = 0;
      const assembled: Record<string, unknown> = {};

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const flush = (events: ReturnType<typeof parser.push>) => {
        for (const ev of events) {
          if (ev.type === 'text') {
            handlers.onText?.(ev.field, ev.delta);
          } else {
            assembled[ev.field] = ev.value;
            handlers.onField?.(ev.field, ev.value);
          }
        }
      };

      // Terminal beats (completed / incomplete / failed) carry the whole response
      // object; absorb its model + usage, then act on its status.
      const absorbTerminal = (body: ResponseBody | undefined) => {
        if (!body) return;
        if (typeof body.model === 'string') modelUsed = body.model;
        promptTokens = body.usage?.input_tokens ?? promptTokens;
        completionTokens = body.usage?.output_tokens ?? completionTokens;
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        // SSE events carry an `event:` line and a `data:` line; the JSON payload
        // repeats the event name in its own `type`, so only `data:` is needed.
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trimEnd();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json || json === '[DONE]') continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(json); } catch { continue; }

          const type = typeof evt.type === 'string' ? evt.type : '';

          if (type === 'error') {
            throw new Error(
              `openai stream error: ${(evt.code as string) ?? 'unknown'}: ${(evt.message as string) ?? JSON.stringify(evt)}`,
            );
          }

          if (type === 'response.function_call_arguments.delta') {
            const delta = evt.delta;
            if (typeof delta === 'string' && delta) flush(parser.push(delta));
            continue;
          }

          if (type === 'response.refusal.done') {
            throw new Error(`openai stream refusal: ${String(evt.refusal ?? '').slice(0, 200)}`);
          }

          if (type === 'response.failed') {
            const body = evt.response as ResponseBody | undefined;
            absorbTerminal(body);
            throw new Error(`openai stream error: ${body?.error?.code ?? 'failed'}: ${body?.error?.message ?? 'response.failed'}`);
          }

          if (type === 'response.incomplete' || type === 'response.completed') {
            const body = evt.response as ResponseBody | undefined;
            absorbTerminal(body);
            const refusal = findRefusal(body?.output);
            if (refusal) throw new Error(`openai stream refusal: ${refusal.slice(0, 200)}`);
            if (body && truncatedAtCeiling(body)) {
              throw new Error('openai stream: truncated before the tool call closed (max_output_tokens)');
            }
          }
        }
      }
      flush(parser.finish());

      return { parsed: assembled as T, modelUsed, promptTokens, completionTokens };
    },
  };
}

async function generateOnce<T>(
  input: GenerateInput,
  deps: OpenAIDeps,
  attempt: number,
): Promise<GenerateOutput<T>> {
  const sleep = deps.sleep ?? defaultSleep;
  const res = await deps.fetch(OPENAI_BASE, {
    method: 'POST',
    headers: headers(deps),
    body: JSON.stringify(buildBody(input, false)),
  });

  if (res.ok) {
    const json = await res.json() as ResponseBody;

    const refusal = findRefusal(json.output);
    if (refusal) {
      throw new Error(`openai refusal: ${refusal.slice(0, 200)}`);
    }

    const call = findToolCall(json.output, input.tool.name);
    if (!call || typeof call.arguments !== 'string') {
      const reason = json.status ? ` (status=${json.status}${json.incomplete_details?.reason ? `, reason=${json.incomplete_details.reason}` : ''})` : '';
      throw new Error(`openai: no tool_call matching name="${input.tool.name}" in response${reason}`);
    }

    // Arguments arrive as a JSON string — a truncated generation surfaces here
    // as a parse failure, so say so plainly.
    let parsed: T;
    try {
      parsed = JSON.parse(call.arguments) as T;
    } catch {
      const hint = truncatedAtCeiling(json) ? ' — truncated at max_output_tokens' : '';
      throw new Error(`openai: tool arguments were not valid JSON${hint}`);
    }

    return {
      parsed,
      modelUsed: json.model,
      promptTokens: json.usage?.input_tokens ?? 0,
      completionTokens: json.usage?.output_tokens ?? 0,
    };
  }

  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < MAX_RETRIES) {
    const backoffMs = 500 * Math.pow(2, attempt) + Math.random() * 250;
    await sleep(backoffMs);
    return generateOnce(input, deps, attempt + 1);
  }

  const detail = await res.text().catch(() => '');
  throw new Error(`openai ${res.status}: ${detail.slice(0, 500)}`);
}
