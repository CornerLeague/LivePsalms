import { describe, it, expect, vi } from 'vitest';
import { createOpenAIAdapter } from './openai';

const toolSchema = {
  name: 'emit_artifact',
  description: 'Return the artifact JSON.',
  input_schema: {
    type: 'object',
    properties: { headline: { type: 'string' } },
    required: ['headline'],
  },
};

function mockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toolCallResponse(
  args: unknown,
  opts: Partial<{ promptTokens: number; completionTokens: number; model: string; name: string }> = {},
) {
  return mockResponse({
    id: 'chatcmpl_test',
    object: 'chat.completion',
    model: opts.model ?? 'gpt-5.6-terra',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: opts.name ?? 'emit_artifact', arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: {
      prompt_tokens: opts.promptTokens ?? 12,
      completion_tokens: opts.completionTokens ?? 34,
    },
  });
}

describe('createOpenAIAdapter.generate', () => {
  it('sends the documented request shape', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return toolCallResponse({ headline: 'ok' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', fetch: fetchMock });
    const out = await adapter.generate<{ headline: string }>({
      model: 'balanced',
      system: 'system prompt',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
      maxTokens: 1024,
    });

    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.max_completion_tokens).toBe(1024);
    // The system prompt rides as the leading message, not a top-level field.
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hi' },
    ]);
    expect(body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'emit_artifact',
        description: 'Return the artifact JSON.',
        parameters: toolSchema.input_schema,
      },
    }]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'emit_artifact' } });

    expect(out.parsed).toEqual({ headline: 'ok' });
    expect(out.modelUsed).toBe('gpt-5.6-terra');
    expect(out.promptTokens).toBe(12);
    expect(out.completionTokens).toBe(34);
  });

  it('resolves model="fast" to gpt-5.6-luna', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return toolCallResponse({ headline: 'h' }, { model: 'gpt-5.6-luna' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({
      model: 'fast',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('gpt-5.6-luna');
  });

  it('defaults max_completion_tokens to 2048 when not provided', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ url: _url, init });
      return toolCallResponse({ headline: 'ok' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({
      model: 'balanced',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    expect(JSON.parse(calls[0].init.body as string).max_completion_tokens).toBe(2048);
  });

  it('retries on 429 with backoff and succeeds', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts++;
      if (attempts === 1) return mockResponse({ error: 'rate' }, 429);
      return toolCallResponse({ headline: 'ok' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock, sleep: async () => {} });
    const out = await adapter.generate({
      model: 'balanced',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    expect(out.parsed).toEqual({ headline: 'ok' });
    expect(attempts).toBe(2);
  });

  it('throws after 3 retries on persistent 5xx', async () => {
    const fetchMock = vi.fn(async () => mockResponse({ error: 'boom' }, 500));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock, sleep: async () => {} });
    await expect(
      adapter.generate({
        model: 'balanced',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/openai 500/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('hard-fails on 2xx without a matching tool_call', async () => {
    const fetchMock = vi.fn(async () => mockResponse({
      choices: [{ message: { role: 'assistant', content: 'I refuse to use the tool.' }, finish_reason: 'stop' }],
      model: 'gpt-5.6-terra',
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    }));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await expect(
      adapter.generate({
        model: 'balanced',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/no tool_call/i);
  });

  it('surfaces a model refusal as a distinct error', async () => {
    const fetchMock = vi.fn(async () => mockResponse({
      choices: [{ message: { role: 'assistant', refusal: 'I cannot help with that.' }, finish_reason: 'stop' }],
      model: 'gpt-5.6-terra',
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    }));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await expect(
      adapter.generate({
        model: 'balanced',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/openai refusal/i);
  });

  it('reports truncated tool arguments instead of a raw JSON parse error', async () => {
    const fetchMock = vi.fn(async () => mockResponse({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{ type: 'function', function: { name: 'emit_artifact', arguments: '{"headline":"half' } }],
        },
        finish_reason: 'length',
      }],
      model: 'gpt-5.6-terra',
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    }));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await expect(
      adapter.generate({
        model: 'balanced',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/truncated at max_completion_tokens/);
  });

  it('hard-fails on 4xx (non-429) without retry', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts++;
      return mockResponse({ error: 'bad request' }, 400);
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock, sleep: async () => {} });
    await expect(
      adapter.generate({
        model: 'balanced',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/openai 400/);
    expect(attempts).toBe(1);
  });
});

describe('openai adapter model mapping', () => {
  it('sends the flagship model id with reasoning disabled when model is "deep"', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'emit', arguments: '{"ok":true}' } }] } }],
        model: 'gpt-5.6-sol',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
    const llm = createOpenAIAdapter({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch });
    await llm.generate({
      model: 'deep',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: { name: 'emit', description: 'd', input_schema: { type: 'object' } },
      maxTokens: 1024,
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-5.6-sol');
    // Chat Completions rejects function tools unless reasoning_effort is 'none',
    // so every tier — flagship included — disables it and the caller's token
    // budget is passed through untouched.
    expect(body.reasoning_effort).toBe('none');
    expect(body.max_completion_tokens).toBe(1024);
  });

  it('disables reasoning on the streaming-facing tiers', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'emit', arguments: '{"ok":true}' } }] } }],
        model: 'gpt-5.6-terra',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
    const llm = createOpenAIAdapter({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch });
    await llm.generate({
      model: 'balanced',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: { name: 'emit', description: 'd', input_schema: { type: 'object' } },
      maxTokens: 1024,
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reasoning_effort).toBe('none');
    expect(body.max_completion_tokens).toBe(1024);
  });
});

describe('openai multimodal', () => {
  it('serializes image content blocks as data-URI image parts', async () => {
    let sentBody: { messages: Array<{ content: unknown }> } | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{ type: 'function', function: { name: 'record_transcription', arguments: '{"ok":true}' } }],
          },
        }],
        model: 'gpt-5.6-terra',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fakeFetch });
    const out = await adapter.generate<{ ok: boolean }>({
      model: 'balanced',
      system: 'sys',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'read this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
        ],
      }],
      tool: { name: 'record_transcription', description: 'd', input_schema: { type: 'object' } },
    });

    expect(out.parsed).toEqual({ ok: true });
    expect(sentBody?.messages[1].content).toEqual([
      { type: 'text', text: 'read this' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);
  });
});

function sseStreamResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('createOpenAIAdapter.generateStream', () => {
  it('throws when the stream emits a mid-stream error payload', async () => {
    const lines = [
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
      'data: {"error":{"type":"server_error","message":"Overloaded"}}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }],
          tool: { name: 'emit_artifact', description: 'd', input_schema: { type: 'object' } } },
        {},
      )
    ).rejects.toThrow(/openai stream error/i);
  });

  it('streams tool-JSON field events and resolves the parsed object + usage', async () => {
    const lines = [
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"emit_chat_reply","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"reply\\":\\"He"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"llo\\",\\"citations\\":[]}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const texts: string[] = [];
    const fields: Array<{ field: string; value: unknown }> = [];
    const out = await adapter.generateStream<{ reply: string; citations: unknown[] }>(
      { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }],
        tool: { name: 'emit_chat_reply', description: 'd', input_schema: { type: 'object' } },
        textFields: ['reply'] },
      { onText: (_f, d) => texts.push(d), onField: (f, v) => fields.push({ field: f, value: v }) },
    );
    expect(texts.join('')).toBe('Hello');
    expect(fields).toContainEqual({ field: 'citations', value: [] });
    expect(out.parsed).toEqual({ reply: 'Hello', citations: [] });
    expect(out.promptTokens).toBe(11);
    expect(out.completionTokens).toBe(7);
    // request body opts into streaming *and* the trailing usage chunk
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('throws when the stream is cut off at the token ceiling', async () => {
    const lines = [
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"reply\\":\\"partial"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","model":"gpt-5.6-terra","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }],
          tool: { name: 'emit_chat_reply', description: 'd', input_schema: { type: 'object' } } },
        {},
      )
    ).rejects.toThrow(/truncated/i);
  });
});
