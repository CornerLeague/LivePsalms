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

export interface LLMAdapter {
  generate<T>(input: GenerateInput): Promise<GenerateOutput<T>>;
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
