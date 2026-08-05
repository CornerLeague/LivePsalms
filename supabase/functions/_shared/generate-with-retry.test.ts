import { describe, it, expect } from 'vitest';
import { generateWithRetry, type GenerateWithRetryConfig } from './generate-with-retry';
import type { GenerateInput, GenerateOutput, LLMAdapter, ToolSchema } from './openai';
import { LAMPLIGHT_SYSTEM_FRAGMENT } from './voice';

type Parsed = { text: string };
type Violations = { reasons: string[] };

const TOOL: ToolSchema = { name: 'emit', description: '', input_schema: {} };

/**
 * Fake LLMAdapter that returns a scripted parsed value per attempt and records
 * the system prompt it was handed each call.
 */
function fakeLLM(parsedPerAttempt: Parsed[]): {
  llm: LLMAdapter;
  systems: string[];
  inputs: GenerateInput[];
  calls: number;
} {
  const systems: string[] = [];
  const inputs: GenerateInput[] = [];
  let i = 0;
  const llm: LLMAdapter = {
    async generate<T>(input: GenerateInput): Promise<GenerateOutput<T>> {
      systems.push(input.system);
      inputs.push(input);
      const parsed = parsedPerAttempt[Math.min(i, parsedPerAttempt.length - 1)];
      i++;
      return {
        parsed: parsed as unknown as T,
        modelUsed: input.model === 'balanced' ? 'gpt-5.6-terra' : 'gpt-5.6-luna',
        promptTokens: 10,
        completionTokens: 20,
      };
    },
  };
  return { llm, get systems() { return systems; }, get inputs() { return inputs; }, get calls() { return i; } };
}

function baseConfig(
  over: Partial<GenerateWithRetryConfig<Parsed, Violations>> = {},
): GenerateWithRetryConfig<Parsed, Violations> {
  return {
    llm: fakeLLM([{ text: 'ok' }]).llm,
    model: 'balanced',
    maxTokens: 256,
    artifactSystem: 'ARTIFACT STANCE',
    messages: [{ role: 'user', content: 'hi' }],
    tool: TOOL,
    validate: async () => ({ ok: true, violations: { reasons: [] } }),
    formatStricter: (v) => `STRICTER: ${v.reasons.join(',')}`,
    ...over,
  };
}

describe('generateWithRetry', () => {
  it('first attempt valid: returns ok, one call, no stricter suffix', async () => {
    const fake = fakeLLM([{ text: 'good' }]);
    const out = await generateWithRetry(
      baseConfig({ llm: fake.llm, validate: async () => ({ ok: true, violations: { reasons: [] } }) }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.parsed).toEqual({ text: 'good' });
      expect(out.attempts).toBe(1);
      expect(out.modelUsed).toBe('gpt-5.6-terra');
      expect(out.promptTokens).toBe(10);
      expect(out.completionTokens).toBe(20);
    }
    expect(fake.calls).toBe(1);
    // No stricter suffix on the only attempt.
    expect(fake.systems[0]).toContain(LAMPLIGHT_SYSTEM_FRAGMENT);
    expect(fake.systems[0]).toContain('ARTIFACT STANCE');
    expect(fake.systems[0]).not.toContain('STRICTER:');
  });

  it('first invalid, retry valid: two attempts, stricter suffix only on retry, violations threaded forward', async () => {
    const fake = fakeLLM([{ text: 'bad' }, { text: 'fixed' }]);
    let call = 0;
    const out = await generateWithRetry(
      baseConfig({
        llm: fake.llm,
        validate: async () => {
          call++;
          return call === 1
            ? { ok: false, violations: { reasons: ['too-long'] } }
            : { ok: true, violations: { reasons: [] } };
        },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.parsed).toEqual({ text: 'fixed' });
      expect(out.attempts).toBe(2);
    }
    expect(fake.calls).toBe(2);
    expect(fake.systems[0]).not.toContain('STRICTER:');
    // Retry prompt carries the prior attempt's violations.
    expect(fake.systems[1]).toContain('STRICTER: too-long');
  });

  it('both attempts invalid: returns ok:false with the last violations, attempts=2, modelUsed from last call', async () => {
    const fake = fakeLLM([{ text: 'bad1' }, { text: 'bad2' }]);
    let call = 0;
    const out = await generateWithRetry(
      baseConfig({
        llm: fake.llm,
        model: 'fast',
        validate: async () => {
          call++;
          return { ok: false, violations: { reasons: [`fail-${call}`] } };
        },
      }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.violations).toEqual({ reasons: ['fail-2'] });
      expect(out.attempts).toBe(2);
      expect(out.modelUsed).toBe('gpt-5.6-luna');
    }
    expect(fake.calls).toBe(2);
  });

  it('maxAttempts override is honoured', async () => {
    const fake = fakeLLM([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    const out = await generateWithRetry(
      baseConfig({
        llm: fake.llm,
        maxAttempts: 3,
        validate: async () => ({ ok: false, violations: { reasons: ['x'] } }),
      }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.attempts).toBe(3);
    expect(fake.calls).toBe(3);
  });

  it('forwards cfg.effort on the first attempt AND the stricter retry', async () => {
    const fake = fakeLLM([{ text: 'bad' }, { text: 'bad' }]);
    let n = 0;
    await generateWithRetry(
      baseConfig({
        llm: fake.llm,
        effort: 'high',
        validate: async () => ({ ok: n++ > 1, violations: { reasons: ['r'] } }),
      }),
    );
    expect(fake.calls).toBe(2);
    expect(fake.inputs.map((i) => i.effort)).toEqual(['high', 'high']);
  });

  it('leaves effort undefined when the config names none (adapter applies the tier default)', async () => {
    const fake = fakeLLM([{ text: 'ok' }]);
    await generateWithRetry(baseConfig({ llm: fake.llm }));
    expect(fake.inputs[0].effort).toBeUndefined();
  });

  it('substitutes systemTokens into the composed prompt', async () => {
    const fake = fakeLLM([{ text: 'ok' }]);
    await generateWithRetry(
      baseConfig({
        llm: fake.llm,
        artifactSystem: 'Today is {{local_date}}.',
        systemTokens: { local_date: '2026-06-04' },
      }),
    );
    expect(fake.systems[0]).toContain('Today is 2026-06-04.');
  });
});

// ── Slice 1d: repaired artifacts flow through the validate seam ──────────────
// Verification repairs a near-miss verse quote in place of failing the artifact.
// The repair is returned from validate rather than mutating `parsed`, so the
// hand-off is visible in the type instead of depending on object identity.

describe('generateWithRetry — repaired', () => {
  const cfg = (validate: GenerateWithRetryConfig<{ v: string }, string[]>['validate']) => ({
    llm: {
      async generate<U>() {
        return { parsed: { v: 'original' } as unknown as U, modelUsed: 'm', promptTokens: 1, completionTokens: 2 };
      },
    } as unknown as LLMAdapter,
    model: 'balanced' as const,
    maxTokens: 100,
    artifactSystem: 'sys',
    messages: [],
    tool: { name: 't', description: 'd', input_schema: {} } as never,
    validate,
    formatStricter: () => 'stricter',
  });

  it('returns the repaired artifact when validate supplies one', async () => {
    const outcome = await generateWithRetry(cfg(
      async () => ({ ok: true, violations: [], repaired: { v: 'repaired' } }),
    ));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.parsed).toEqual({ v: 'repaired' });
  });

  it('returns the original artifact when validate supplies no repair', async () => {
    const outcome = await generateWithRetry(cfg(async () => ({ ok: true, violations: [] })));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.parsed).toEqual({ v: 'original' });
  });

  it('ignores a repair on a failing attempt — a violation still drives the retry', async () => {
    let calls = 0;
    const outcome = await generateWithRetry(cfg(async () => {
      calls++;
      return calls === 1
        ? { ok: false, violations: ['bad'], repaired: { v: 'ignored' } }
        : { ok: true, violations: [] };
    }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.parsed).toEqual({ v: 'original' });
      expect(outcome.attempts).toBe(2);
    }
  });
});
