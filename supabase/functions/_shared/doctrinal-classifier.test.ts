import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeDoctrinalClassifier } from './doctrinal-classifier';
import type { GenerateInput, GenerateOutput, LLMAdapter } from './openai';

function makeLlm(respond: (input: GenerateInput) => unknown): LLMAdapter & { calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  return {
    calls,
    async generate<T>(input: GenerateInput): Promise<GenerateOutput<T>> {
      calls.push(input);
      return {
        parsed: respond(input) as T,
        modelUsed: 'gpt-5.6-luna',
        promptTokens: 10,
        completionTokens: 5,
      };
    },
    async generateStream<T>(): Promise<GenerateOutput<T>> {
      throw new Error('not used');
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeDoctrinalClassifier', () => {
  it('returns [] for clean text and calls the fast tier with the artifact text', async () => {
    const llm = makeLlm(() => ({ violations: [] }));
    const classify = makeDoctrinalClassifier(llm);
    const out = await classify('A quiet reflection on Psalm 27.');
    expect(out).toEqual([]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].model).toBe('fast');
    const content = llm.calls[0].messages[0].content as string;
    expect(content).toContain('A quiet reflection on Psalm 27.');
    // rule lists ride along per P0-5 ("reads the artifact + rule lists")
    expect(content).toContain('Revelation 13');
  });

  it('maps reported violations into the ContentRuleViolation shape', async () => {
    const llm = makeLlm(() => ({
      violations: [
        { family: 'banned', reason: 'paraphrased prophetic claim', snippet: 'heaven has a plan for you this week' },
        { family: 'growth', reason: 'reworded streak pressure', snippet: "don't lose the momentum you've built" },
      ],
    }));
    const classify = makeDoctrinalClassifier(llm);
    const out = await classify('…heaven has a plan for you this week…');
    expect(out).toEqual([
      {
        family: 'banned',
        rule: 'classifier:paraphrased prophetic claim',
        snippet: 'heaven has a plan for you this week',
      },
      {
        family: 'growth',
        rule: 'classifier:reworded streak pressure',
        snippet: "don't lose the momentum you've built",
      },
    ]);
  });

  it('drops violations with families outside banned/contested/growth', async () => {
    const llm = makeLlm(() => ({
      violations: [
        { family: 'name', reason: 'not a classifier family', snippet: 'x' },
        { family: 'style', reason: 'made up', snippet: 'y' },
        { family: 'contested', reason: 'resolves Romans 9 debate', snippet: 'this settles election' },
      ],
    }));
    const out = await makeDoctrinalClassifier(llm)('text');
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe('contested');
  });

  it('caps reported violations at 5', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      family: 'banned', reason: `r${i}`, snippet: `s${i}`,
    }));
    const out = await makeDoctrinalClassifier(makeLlm(() => ({ violations: many })))('text');
    expect(out).toHaveLength(5);
  });

  it('fails OPEN: a throwing adapter yields [] and logs', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const llm: LLMAdapter = {
      async generate<T>(): Promise<GenerateOutput<T>> {
        throw new Error('openai 500');
      },
      async generateStream<T>(): Promise<GenerateOutput<T>> {
        throw new Error('not used');
      },
    };
    const out = await makeDoctrinalClassifier(llm)('some text');
    expect(out).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
  });

  it('skips the model call entirely for blank text', async () => {
    const llm = makeLlm(() => ({ violations: [] }));
    const out = await makeDoctrinalClassifier(llm)('   ');
    expect(out).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('tolerates a malformed parse (missing violations array)', async () => {
    const llm = makeLlm(() => ({}));
    const out = await makeDoctrinalClassifier(llm)('text');
    expect(out).toEqual([]);
  });
});
