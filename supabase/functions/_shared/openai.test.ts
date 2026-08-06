import { describe, it, expect, vi } from 'vitest';
import { createOpenAIAdapter, TIER_DEFAULT_EFFORT } from './openai';

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

/**
 * A Responses-API success body. `output` deliberately leads with a `reasoning`
 * item so every parse test proves non-function items are skipped rather than
 * assumed absent.
 */
function toolCallResponse(
  args: unknown,
  opts: Partial<{ promptTokens: number; completionTokens: number; model: string; name: string }> = {},
) {
  return mockResponse({
    id: 'resp_test',
    object: 'response',
    model: opts.model ?? 'gpt-5.6-terra',
    status: 'completed',
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: opts.name ?? 'emit_artifact',
        arguments: JSON.stringify(args),
      },
    ],
    usage: {
      input_tokens: opts.promptTokens ?? 12,
      output_tokens: opts.completionTokens ?? 34,
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string);
}

describe('createOpenAIAdapter.generate', () => {
  it('sends the documented Responses request shape', async () => {
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

    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    expect(headers['content-type']).toBe('application/json');

    const body = bodyOf(calls[0].init);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.max_output_tokens).toBe(1024);
    // The system prompt is a top-level field on Responses, not a leading message.
    expect(body.instructions).toBe('system prompt');
    expect(body.input).toEqual([{ role: 'user', content: 'hi' }]);
    // Function tools are FLATTENED (no nested `function` key).
    expect(body.tools).toEqual([{
      type: 'function',
      name: 'emit_artifact',
      description: 'Return the artifact JSON.',
      parameters: toolSchema.input_schema,
    }]);
    expect(body.tool_choice).toEqual({ type: 'function', name: 'emit_artifact' });

    expect(out.parsed).toEqual({ headline: 'ok' });
    expect(out.modelUsed).toBe('gpt-5.6-terra');
    expect(out.promptTokens).toBe(12);
    expect(out.completionTokens).toBe(34);
  });

  it('PRIVACY INVARIANT: never asks OpenAI to store the response', async () => {
    const calls: Array<RequestInit> = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(init);
      return toolCallResponse({ headline: 'ok' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({ model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: toolSchema });
    expect(bodyOf(calls[0]).store).toBe(false);
  });

  it('does not send `strict` on the tool (our artifact schemas are not strict-mode clean)', async () => {
    const calls: Array<RequestInit> = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(init);
      return toolCallResponse({ headline: 'ok' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({ model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: toolSchema });
    const tools = bodyOf(calls[0]).tools as Array<Record<string, unknown>>;
    expect('strict' in tools[0]).toBe(false);
  });

  it('resolves effort from input.effort, else the tier default', async () => {
    const calls: Array<RequestInit> = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(init);
      return toolCallResponse({ headline: 'ok' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    const base = { system: 's', messages: [{ role: 'user' as const, content: 'hi' }], tool: toolSchema };

    await adapter.generate({ ...base, model: 'deep' });
    expect(bodyOf(calls[0]).reasoning).toEqual({ effort: 'low' });      // deep default

    await adapter.generate({ ...base, model: 'deep', effort: 'high' });
    expect(bodyOf(calls[1]).reasoning).toEqual({ effort: 'high' });     // explicit wins

    await adapter.generate({ ...base, model: 'fast' });
    expect(bodyOf(calls[2]).reasoning).toEqual({ effort: 'none' });     // fast default

    await adapter.generate({ ...base, model: 'balanced' });
    expect(bodyOf(calls[3]).reasoning).toEqual({ effort: 'low' });      // balanced default
  });

  it('exports the tier default map the pipelines reason about', () => {
    expect(TIER_DEFAULT_EFFORT).toEqual({ fast: 'none', balanced: 'low', deep: 'low' });
  });

  it('resolves model="fast" to gpt-5.6-luna', async () => {
    const calls: Array<RequestInit> = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(init);
      return toolCallResponse({ headline: 'h' }, { model: 'gpt-5.6-luna' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({
      model: 'fast',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    expect(bodyOf(calls[0]).model).toBe('gpt-5.6-luna');
  });

  it('resolves model="deep" to gpt-5.6-sol and passes the caller budget through', async () => {
    const calls: Array<RequestInit> = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(init);
      return toolCallResponse({ headline: 'h' }, { model: 'gpt-5.6-sol' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({
      model: 'deep',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
      maxTokens: 8192,
    });
    const body = bodyOf(calls[0]);
    expect(body.model).toBe('gpt-5.6-sol');
    expect(body.max_output_tokens).toBe(8192);
  });

  it('defaults max_output_tokens to 2048 when not provided', async () => {
    const calls: Array<RequestInit> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return toolCallResponse({ headline: 'ok' });
    });
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await adapter.generate({
      model: 'balanced',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: toolSchema,
    });
    expect(bodyOf(calls[0]).max_output_tokens).toBe(2048);
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

  it('hard-fails on 2xx without a matching function_call item', async () => {
    const fetchMock = vi.fn(async () => mockResponse({
      model: 'gpt-5.6-terra',
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I refuse to use the tool.' }] }],
      usage: { input_tokens: 5, output_tokens: 6 },
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
      model: 'gpt-5.6-terra',
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }],
      usage: { input_tokens: 5, output_tokens: 6 },
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
      model: 'gpt-5.6-terra',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'function_call', name: 'emit_artifact', arguments: '{"headline":"half' }],
      usage: { input_tokens: 5, output_tokens: 6 },
    }));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await expect(
      adapter.generate({
        model: 'balanced',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/truncated at max_output_tokens/);
  });

  it('names the incomplete status when the ceiling cut the call before any tool item', async () => {
    const fetchMock = vi.fn(async () => mockResponse({
      model: 'gpt-5.6-sol',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning', id: 'rs_1', summary: [] }],
      usage: { input_tokens: 5, output_tokens: 4096 },
    }));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock });
    await expect(
      adapter.generate({
        model: 'deep',
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
        tool: toolSchema,
      })
    ).rejects.toThrow(/status=incomplete, reason=max_output_tokens/);
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

describe('openai multimodal', () => {
  it('serializes image content blocks as data-URI input_image parts', async () => {
    let sentBody: { input: Array<{ content: unknown }> } | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return mockResponse({
        model: 'gpt-5.6-terra',
        status: 'completed',
        output: [{ type: 'function_call', name: 'record_transcription', arguments: '{"ok":true}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
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
    // image_url is a plain data-URI STRING on Responses (Chat Completions nested it).
    expect(sentBody?.input[0].content).toEqual([
      { type: 'input_text', text: 'read this' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' },
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

const streamTool = { name: 'emit_chat_reply', description: 'd', input_schema: { type: 'object' } };

describe('createOpenAIAdapter.generateStream', () => {
  it('throws when the stream emits a mid-stream error event', async () => {
    const lines = [
      'event: response.created\ndata: {"type":"response.created","response":{"model":"gpt-5.6-terra"}}\n\n',
      'event: error\ndata: {"type":"error","code":"server_error","message":"Overloaded","param":null,"sequence_number":2}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: streamTool },
        {},
      )
    ).rejects.toThrow(/openai stream error/i);
  });

  it('throws when the response terminates in response.failed', async () => {
    const lines = [
      'data: {"type":"response.failed","response":{"model":"gpt-5.6-terra","status":"failed","error":{"code":"server_error","message":"upstream died"}},"sequence_number":3}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: streamTool },
        {},
      )
    ).rejects.toThrow(/openai stream error: server_error: upstream died/);
  });

  it('streams tool-JSON field events and resolves the parsed object + usage', async () => {
    const lines = [
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","name":"emit_chat_reply","arguments":""}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"sequence_number":2,"delta":"{\\"reply\\":\\"He"}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"sequence_number":3,"delta":"llo\\",\\"citations\\":[]}"}\n\n',
      'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":0,"sequence_number":4,"arguments":"{\\"reply\\":\\"Hello\\",\\"citations\\":[]}"}\n\n',
      'data: {"type":"response.completed","sequence_number":5,"response":{"model":"gpt-5.6-terra","status":"completed","output":[{"type":"function_call","name":"emit_chat_reply","arguments":"{}"}],"usage":{"input_tokens":11,"output_tokens":7,"output_tokens_details":{"reasoning_tokens":3}}}}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const texts: string[] = [];
    const fields: Array<{ field: string; value: unknown }> = [];
    const out = await adapter.generateStream<{ reply: string; citations: unknown[] }>(
      { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }],
        tool: streamTool, textFields: ['reply'] },
      { onText: (_f, d) => texts.push(d), onField: (f, v) => fields.push({ field: f, value: v }) },
    );
    expect(texts.join('')).toBe('Hello');
    expect(fields).toContainEqual({ field: 'citations', value: [] });
    expect(out.parsed).toEqual({ reply: 'Hello', citations: [] });
    // usage rides response.completed — there is no stream_options on Responses.
    expect(out.promptTokens).toBe(11);
    expect(out.completionTokens).toBe(7);
    expect(out.modelUsed).toBe('gpt-5.6-terra');

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect('stream_options' in body).toBe(false);
  });

  it('throws when the stream is cut off at the token ceiling', async () => {
    const lines = [
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"reply\\":\\"partial","sequence_number":1}\n\n',
      'data: {"type":"response.incomplete","sequence_number":2,"response":{"model":"gpt-5.6-terra","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":5,"output_tokens":1024}}}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: streamTool },
        {},
      )
    ).rejects.toThrow(/truncated/i);
  });

  it('throws when the connection drops before response.completed, even after streaming deltas', async () => {
    // EOF with no terminal event — the interrupted-stream case. The reply field
    // never closes, so before the completeness check this resolved with a
    // silently partial object after the caller had already watched text arrive.
    const lines = [
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"reply\\":\\"Hel","sequence_number":1}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const texts: string[] = [];
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }],
          tool: streamTool, textFields: ['reply'] },
        { onText: (_f, d) => texts.push(d) },
      )
    ).rejects.toThrow(/connection closed before response\.completed/);
    // Deltas did reach the handler — the throw is what keeps them from being
    // blessed as a finished artifact.
    expect(texts.join('')).toBe('Hel');
  });

  it('throws on response.incomplete for reasons other than the token ceiling', async () => {
    const lines = [
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"reply\\":\\"par","sequence_number":1}\n\n',
      'data: {"type":"response.incomplete","sequence_number":2,"response":{"model":"gpt-5.6-terra","status":"incomplete","incomplete_details":{"reason":"content_filter"},"usage":{"input_tokens":5,"output_tokens":9}}}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: streamTool },
        {},
      )
    ).rejects.toThrow(/response incomplete \(content_filter\)/);
  });

  it('resolves when response.completed arrives without a trailing newline', async () => {
    // The terminal event as the stream's final bytes, no newline after it: the
    // decoder tail must be processed before the completeness check.
    const lines = [
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"reply\\":\\"Hello\\"}","sequence_number":1}\n\n',
      'data: {"type":"response.completed","sequence_number":2,"response":{"model":"gpt-5.6-terra","status":"completed","usage":{"input_tokens":3,"output_tokens":2}}}',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const out = await adapter.generateStream<{ reply: string }>(
      { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }],
        tool: streamTool, textFields: ['reply'] },
      {},
    );
    expect(out.parsed).toEqual({ reply: 'Hello' });
    expect(out.completionTokens).toBe(2);
  });

  it('surfaces a streamed refusal as a distinct error', async () => {
    const lines = [
      'data: {"type":"response.refusal.done","refusal":"I cannot help with that.","sequence_number":2}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: streamTool },
        {},
      )
    ).rejects.toThrow(/openai stream refusal/i);
  });

  it('forwards effort on the streaming path too', async () => {
    const lines = [
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"reply\\":\\"hi\\"}","sequence_number":1}\n\n',
      'data: {"type":"response.completed","sequence_number":2,"response":{"model":"gpt-5.6-sol","status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseStreamResponse(lines));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await adapter.generateStream(
      { model: 'deep', effort: 'medium', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: streamTool, textFields: ['reply'] },
      {},
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.store).toBe(false);
  });

  it('propagates a non-2xx stream start as an error', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 503 }));
    const adapter = createOpenAIAdapter({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.generateStream(
        { model: 'balanced', system: 's', messages: [{ role: 'user', content: 'hi' }], tool: streamTool },
        {},
      )
    ).rejects.toThrow(/openai stream 503/);
  });
});
