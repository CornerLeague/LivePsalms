import { describe, it, expect, vi } from 'vitest';
import { makeCrisisClassifier, CRISIS_CLASSIFIER_VERSION } from './crisis-classifier.ts';
import type { LLMAdapter } from './openai.ts';

// These are CONTRACT tests, driven by a fake adapter. Whether the classifier
// actually tells lament from risk is not answerable here — that is a live
// measurement against the corpus, and it lives in scripts/eval-crisis.ts.
// What is answerable here is everything around the model call, and the most
// important of it is which way this thing falls over.

function fakeLLM(impl: (args: unknown) => unknown): LLMAdapter {
  return { generate: vi.fn(async (args: unknown) => ({ parsed: impl(args), usage: null })) } as unknown as LLMAdapter;
}

describe('makeCrisisClassifier — how it falls over', () => {
  it('⚠️ fails CLOSED on a thrown error — the OPPOSITE of the doctrinal classifier', () => {
    // `makeDoctrinalClassifier` fails OPEN on purpose: generation must never
    // hinge on a second model call succeeding. Copying that here would be a
    // silent hole — an unavailable classifier would wave every note through.
    // Anyone reusing that module's shape must invert this one deliberately.
    const llm = { generate: vi.fn(async () => { throw new Error('upstream down'); }) } as unknown as LLMAdapter;
    return expect(makeCrisisClassifier(llm)('anything')).resolves.toMatchObject({ safety_class: 'risk' });
  });

  it('fails closed on a malformed response', async () => {
    const classify = makeCrisisClassifier(fakeLLM(() => ({ nonsense: true })));
    await expect(classify('anything')).resolves.toMatchObject({ safety_class: 'risk' });
  });

  it('fails closed on a class outside the enum', async () => {
    const classify = makeCrisisClassifier(fakeLLM(() => ({ safety_class: 'probably_fine' })));
    await expect(classify('anything')).resolves.toMatchObject({ safety_class: 'risk' });
  });

  it('records WHY it fell closed, so a model outage is distinguishable from a real verdict', async () => {
    const llm = { generate: vi.fn(async () => { throw new Error('upstream down'); }) } as unknown as LLMAdapter;
    const v = await makeCrisisClassifier(llm)('anything');
    expect(v.failedClosed).toBe(true);
    expect(v.reason).toMatch(/classifier/i);
  });

  it('does NOT mark a genuine risk verdict as failedClosed', async () => {
    const classify = makeCrisisClassifier(fakeLLM(() => ({ safety_class: 'risk', reason: 'stated intent' })));
    const v = await classify('anything');
    expect(v.safety_class).toBe('risk');
    expect(v.failedClosed).toBe(false);
  });
});

describe('makeCrisisClassifier — the ordinary path', () => {
  it('passes lament through as lament, not as risk', async () => {
    const classify = makeCrisisClassifier(fakeLLM(() => ({ safety_class: 'lament', reason: 'grief' })));
    await expect(classify('anything')).resolves.toMatchObject({ safety_class: 'lament' });
  });

  it('passes ok through', async () => {
    const classify = makeCrisisClassifier(fakeLLM(() => ({ safety_class: 'ok' })));
    await expect(classify('anything')).resolves.toMatchObject({ safety_class: 'ok' });
  });

  it('treats empty text as ok without calling the model', async () => {
    // Nothing written cannot be anything. Withholding every blank note would
    // cost calls and buy nothing.
    const gen = vi.fn();
    const classify = makeCrisisClassifier({ generate: gen } as unknown as LLMAdapter);
    await expect(classify('   \n  ')).resolves.toMatchObject({ safety_class: 'ok' });
    expect(gen).not.toHaveBeenCalled();
  });

  it('runs at the fast tier and bounds the text it sends', async () => {
    let seen: { model?: string; messages?: Array<{ content: string }> } = {};
    const classify = makeCrisisClassifier(fakeLLM((args) => {
      seen = args as typeof seen;
      return { safety_class: 'ok' };
    }));
    await classify('x'.repeat(20_000));
    expect(seen.model).toBe('fast');
    expect(seen.messages?.[0].content.length).toBeLessThan(10_000);
  });

  it('carries a version so a prompt change is attributable', async () => {
    const classify = makeCrisisClassifier(fakeLLM(() => ({ safety_class: 'ok' })));
    const v = await classify('anything');
    expect(v.classifier_version).toBe(CRISIS_CLASSIFIER_VERSION);
    expect(CRISIS_CLASSIFIER_VERSION).toMatch(/^crisis-\d{4}-\d{2}-\d{2}-v\d+$/);
  });
});
