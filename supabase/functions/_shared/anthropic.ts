// Anthropic Messages API adapter — direct fetch, tool-use only.
//
// Imported by:
//   - supabase/functions/lamplight-generate (Deno runtime; injected global fetch)
//   - vitest tests (mocked fetch)
//
// No Deno or Node globals. Same pattern as voyage.ts.
//
// Anthropic API: POST https://api.anthropic.com/v1/messages with tool_choice
// forcing the model into one specific tool. Response contains a content[]
// array; we locate the tool_use block whose name matches the requested tool
// and return its `input` as the parsed object.

import { createToolJsonStreamParser } from './stream-json-fields.ts';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 2048;

export type LLMModel = 'sonnet' | 'haiku' | 'opus';

const MODEL_IDS: Record<LLMModel, string> = {
  sonnet: 'claude-sonnet-4-6',
  haiku:  'claude-haiku-4-5-20251001',
  opus:   'claude-opus-4-8',
};

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ToolSchema {
  name: string;
  description: string;
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

export interface AnthropicDeps {
  apiKey: string;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createAnthropicAdapter(deps: AnthropicDeps): LLMAdapter {
  return {
    async generate<T>(input: GenerateInput): Promise<GenerateOutput<T>> {
      return generateOnce<T>(input, deps, 0);
    },

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
            const msg = evt.message as { model?: string; usage?: { input_tokens?: number } };
            modelUsed = msg?.model ?? modelUsed;
            promptTokens = msg?.usage?.input_tokens ?? 0;
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

      return { parsed: assembled as T, modelUsed, promptTokens, completionTokens };
    },
  };
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function generateOnce<T>(
  input: GenerateInput,
  deps: AnthropicDeps,
  attempt: number,
): Promise<GenerateOutput<T>> {
  const sleep = deps.sleep ?? defaultSleep;
  const res = await deps.fetch(ANTHROPIC_BASE, {
    method: 'POST',
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
    }),
  });

  if (res.ok) {
    const json = await res.json() as AnthropicResponse;
    const block = json.content.find(b => b.type === 'tool_use' && b.name === input.tool.name);
    if (!block || block.input === undefined) {
      throw new Error(`anthropic: no tool_use block matching name="${input.tool.name}" in response`);
    }
    return {
      parsed: block.input as T,
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
  throw new Error(`anthropic ${res.status}: ${detail.slice(0, 500)}`);
}
