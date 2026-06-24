import { describe, it, expect, vi } from 'vitest';
import { createAnthropicAdapter } from './anthropic';

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

function toolUseResponse(input: unknown, opts: Partial<{ inputTokens: number; outputTokens: number; model: string }> = {}) {
  return mockResponse({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-sonnet-4-6',
    content: [
      { type: 'tool_use', id: 'tu_1', name: 'emit_artifact', input },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: opts.inputTokens ?? 12, output_tokens: opts.outputTokens ?? 34 },
  });
}

describe('createAnthropicAdapter.generate', () => {
  it('sends the documented request shape', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return toolUseResponse({ headline: 'ok' });
    });
    const adapter = createAnthropicAdapter({ apiKey: 'sk-test', fetch: fetchMock });
    const out = await adapter.generate<{ headline: string }>({
      model: 'sonnet',
      system: 'system prompt',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
      maxTokens: 1024,
    });

    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(1024);
    expect(body.system).toBe('system prompt');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.tools).toEqual([toolSchema]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_artifact' });

    expect(out.parsed).toEqual({ headline: 'ok' });
    expect(out.modelUsed).toBe('claude-sonnet-4-6');
    expect(out.promptTokens).toBe(12);
    expect(out.completionTokens).toBe(34);
  });

  it('resolves model="haiku" to claude-haiku-4-5-20251001', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return toolUseResponse({ headline: 'h' }, { model: 'claude-haiku-4-5-20251001' });
    });
    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({
      model: 'haiku',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('defaults max_tokens to 2048 when not provided', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ url: _url, init });
      return toolUseResponse({ headline: 'ok' });
    });
    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({
      model: 'sonnet',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    expect(JSON.parse(calls[0].init.body as string).max_tokens).toBe(2048);
  });

  it('retries on 429 with backoff and succeeds', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts++;
      if (attempts === 1) return mockResponse({ error: 'rate' }, 429);
      return toolUseResponse({ headline: 'ok' });
    });
    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fetchMock, sleep: async () => {} });
    const out = await adapter.generate({
      model: 'sonnet',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    expect(out.parsed).toEqual({ headline: 'ok' });
    expect(attempts).toBe(2);
  });

  it('throws after 3 retries on persistent 5xx', async () => {
    const fetchMock = vi.fn(async () => mockResponse({ error: 'boom' }, 500));
    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fetchMock, sleep: async () => {} });
    await expect(
      adapter.generate({
        model: 'sonnet',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/anthropic 500/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('hard-fails on 2xx without a matching tool_use block', async () => {
    const fetchMock = vi.fn(async () => mockResponse({
      content: [{ type: 'text', text: 'I refuse to use the tool.' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 6 },
    }));
    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fetchMock });
    await expect(
      adapter.generate({
        model: 'sonnet',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/no tool_use block/i);
  });

  it('hard-fails on 4xx (non-429) without retry', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts++;
      return mockResponse({ error: 'bad request' }, 400);
    });
    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fetchMock, sleep: async () => {} });
    await expect(
      adapter.generate({
        model: 'sonnet',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/anthropic 400/);
    expect(attempts).toBe(1);
  });
});

describe('anthropic adapter model mapping', () => {
  it('sends the published Opus model id when model is "opus"', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'emit', input: { ok: true } }],
        model: 'claude-opus-4-8',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
    const llm = createAnthropicAdapter({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch });
    await llm.generate({
      model: 'opus',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: { name: 'emit', description: 'd', input_schema: { type: 'object' } },
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('claude-opus-4-8');
  });
});

describe('anthropic multimodal', () => {
  it('serializes image content blocks into the request body', async () => {
    let sentBody: any;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', name: 'record_transcription', input: { ok: true } }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fakeFetch });
    const out = await adapter.generate<{ ok: boolean }>({
      model: 'sonnet',
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
    expect(sentBody.messages[0].content).toEqual([
      { type: 'text', text: 'read this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
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
    const adapter = createAnthropicAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
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
