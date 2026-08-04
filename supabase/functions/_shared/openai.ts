// OpenAI Chat Completions adapter — direct fetch, tool-call only.
//
// Imported by:
//   - supabase/functions/lamplight-generate (Deno runtime; injected global fetch)
//   - supabase/functions/lamplight-chat, lamplight-study, etymology-insight,
//     transcribe-note
//   - vitest tests (mocked fetch)
//
// No Deno or Node globals. Same pattern as voyage.ts.
//
// OpenAI API: POST https://api.openai.com/v1/chat/completions with tool_choice
// forcing the model into one specific function. The response carries the
// artifact as a JSON *string* in choices[0].message.tool_calls[0].function
// .arguments, which we parse and return as the object.
//
// The tier names below (fast/balanced/deep) are deliberately provider-neutral:
// every pipeline names a tier, and only MODELS maps a tier onto a vendor id.

import { createToolJsonStreamParser } from './stream-json-fields.ts';

const OPENAI_BASE = 'https://api.openai.com/v1/chat/completions';
const MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 2048;

export type LLMModel = 'fast' | 'balanced' | 'deep';

const MODEL_IDS: Record<LLMModel, string> = {
  fast:     'gpt-5.6-luna',
  balanced: 'gpt-5.6-terra',
  deep:     'gpt-5.6-sol',
};

// Every Lamplight call forces a function tool (tool_choice pins one function).
// On Chat Completions the gpt-5.x reasoning models REJECT function tools unless
// reasoning_effort is 'none' — so reasoning is off across all tiers, and the
// flagship (deep) runs as a stronger non-reasoning model, the same role Claude
// Opus played before. Sent explicitly because the models' default effort is
// non-'none', which would 400 every one of our tool calls. Lifting this would
// mean moving to the /v1/responses API, not flipping this constant.
const REASONING_EFFORT = 'none' as const;

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
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function toPart(block: ContentBlock): OpenAIPart {
  if (block.type === 'text') return { type: 'text', text: block.text };
  // OpenAI takes inline images as data URIs rather than a separate source object.
  return {
    type: 'image_url',
    image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
  };
}

function toMessages(input: GenerateInput) {
  return [
    { role: 'system' as const, content: input.system },
    ...input.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(toPart),
    })),
  ];
}

function buildBody(input: GenerateInput, stream: boolean): Record<string, unknown> {
  return {
    model: MODEL_IDS[input.model],
    max_completion_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    reasoning_effort: REASONING_EFFORT,
    messages: toMessages(input),
    tools: [{
      type: 'function',
      function: {
        name: input.tool.name,
        description: input.tool.description,
        parameters: input.tool.input_schema,
      },
    }],
    tool_choice: { type: 'function', function: { name: input.tool.name } },
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

function headers(deps: OpenAIDeps): Record<string, string> {
  return {
    'authorization': `Bearer ${deps.apiKey}`,
    'content-type': 'application/json',
  };
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
          if (!json || json === '[DONE]') continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(json); } catch { continue; }

          const err = evt.error as { message?: string; type?: string } | undefined;
          if (err) {
            throw new Error(`openai stream error: ${err.type ?? 'unknown'}: ${err.message ?? JSON.stringify(evt)}`);
          }

          if (typeof evt.model === 'string') modelUsed = evt.model;

          // The usage-only chunk arrives last and carries an empty choices array.
          const usage = evt.usage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
          if (usage) {
            promptTokens = usage.prompt_tokens ?? promptTokens;
            completionTokens = usage.completion_tokens ?? completionTokens;
          }

          const choices = evt.choices as Array<{
            delta?: { tool_calls?: Array<{ function?: { arguments?: string } }>; refusal?: string };
            finish_reason?: string | null;
          }> | undefined;
          const choice = choices?.[0];
          if (!choice) continue;

          if (choice.delta?.refusal) {
            throw new Error(`openai stream refusal: ${choice.delta.refusal.slice(0, 200)}`);
          }
          // tool_choice pins us to exactly one function, so index 0 is the artifact.
          const frag = choice.delta?.tool_calls?.[0]?.function?.arguments;
          if (typeof frag === 'string' && frag) flush(parser.push(frag));

          if (choice.finish_reason === 'length') {
            throw new Error('openai stream: truncated before the tool call closed (max_completion_tokens)');
          }
        }
      }
      flush(parser.finish());

      return { parsed: assembled as T, modelUsed, promptTokens, completionTokens };
    },
  };
}

interface OpenAIToolCall {
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIResponse {
  choices: Array<{
    message?: { tool_calls?: OpenAIToolCall[]; refusal?: string | null };
    finish_reason?: string;
  }>;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number };
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
    const json = await res.json() as OpenAIResponse;
    const choice = json.choices?.[0];

    if (choice?.message?.refusal) {
      throw new Error(`openai refusal: ${choice.message.refusal.slice(0, 200)}`);
    }
    const call = choice?.message?.tool_calls?.find(c => c.function?.name === input.tool.name);
    if (!call || typeof call.function?.arguments !== 'string') {
      const reason = choice?.finish_reason ? ` (finish_reason=${choice.finish_reason})` : '';
      throw new Error(`openai: no tool_call matching name="${input.tool.name}" in response${reason}`);
    }

    // Unlike a tool_use block, OpenAI hands back arguments as a JSON string —
    // a truncated generation surfaces here as a parse failure, so say so plainly.
    let parsed: T;
    try {
      parsed = JSON.parse(call.function.arguments) as T;
    } catch {
      const hint = choice?.finish_reason === 'length'
        ? ' — truncated at max_completion_tokens'
        : '';
      throw new Error(`openai: tool arguments were not valid JSON${hint}`);
    }

    return {
      parsed,
      modelUsed: json.model,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
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
