import { describe, it, expect } from 'vitest';
import { runSmokeTestPipeline, type SmokeTestContext } from './pipeline';
import type { LLMAdapter, GenerateOutput } from '../_shared/openai';

function makeCtx(overrides: Partial<SmokeTestContext> = {}): SmokeTestContext {
  return {
    notes: [{ id: 'note-1', title: 'On rest', plaintext: 'I have been weary lately and resting feels hard.' }],
    passages: [{
      source_id: 'psa.23.4', text: 'Even though I walk through the valley of the shadow of death…',
      ref: 'Psalm 23:4', metadata: { book: 'Psalm', chapter: 23 },
    }],
    allowedNoteIds: new Set(['note-1']),
    allowedVerseRefs: new Set(['Psalm 23:4']),
    rerankUsed: false,
    ...overrides,
  };
}

function adapterThatReturns<T>(responses: T[]): { llm: LLMAdapter } {
  let i = 0;
  const llm: LLMAdapter = {
    async generate<U>(): Promise<GenerateOutput<U>> {
      const parsed = responses[Math.min(i, responses.length - 1)] as unknown as U;
      i++;
      return { parsed, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
    },
  };
  return { llm };
}

const cleanArtifact = {
  opening: 'A short opening.',
  sections: [{
    heading: 'Anchor',
    body: 'Psalm 23 may speak to the weariness you described.',
    citations: [{ type: 'verse' as const, ref: 'Psalm 23:4' }],
  }],
};

describe('runSmokeTestPipeline', () => {
  it('happy path: validators pass on first attempt', async () => {
    const { llm } = adapterThatReturns([cleanArtifact]);
    const result = await runSmokeTestPipeline({ llm, ctx: makeCtx() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.artifact.sections).toHaveLength(1);
      expect(result.usage).toEqual({
        model: 'gpt-5.6-terra',
        tokens_in: 10,
        tokens_out: 20,
        status: 'ok',
      });
    }
  });

  it('retry path: uncited section on attempt 1, clean on attempt 2', async () => {
    const dirty = {
      opening: 'preamble',
      sections: [{ heading: 'H', body: 'B', citations: [] }],
    };
    const { llm } = adapterThatReturns([dirty, cleanArtifact]);
    const result = await runSmokeTestPipeline({ llm, ctx: makeCtx() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it('hard fail: both attempts violate', async () => {
    const banned = {
      opening: 'God is telling you to forgive him.',
      sections: [{
        heading: 'H', body: 'B',
        citations: [{ type: 'verse' as const, ref: 'Psalm 23:4' }],
      }],
    };
    const { llm } = adapterThatReturns([banned, banned]);
    const result = await runSmokeTestPipeline({ llm, ctx: makeCtx() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(2);
      expect(result.violations?.content.some(v => v.family === 'banned')).toBe(true);
    }
  });

  it('no_notes short-circuit: returns reason no_notes with attempts=0, no LLM call', async () => {
    const calls = { count: 0 };
    const llm: LLMAdapter = {
      async generate() { calls.count++; throw new Error('should not be called'); },
    };
    const result = await runSmokeTestPipeline({ llm, ctx: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_notes');
      expect(result.attempts).toBe(0);
      expect(result.usage).toBeNull();
    }
    expect(calls.count).toBe(0);
  });
});
