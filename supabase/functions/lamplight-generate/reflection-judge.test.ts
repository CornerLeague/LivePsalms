import { describe, it, expect } from 'vitest';
import { judgeReflectionRegister } from './reflection-judge';
import type { LLMAdapter, GenerateInput, GenerateOutput } from '../_shared/anthropic';
import type { ReflectionArtifact } from '../_shared/artifacts';

function makeAdapter(verdict: { pass: boolean; reasons: string[] }): { llm: LLMAdapter; calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  const llm: LLMAdapter = {
    async generate<T>(input: GenerateInput): Promise<GenerateOutput<T>> {
      calls.push(input);
      return { parsed: verdict as unknown as T, modelUsed: 'claude-haiku-4-5-20251001', promptTokens: 5, completionTokens: 10 };
    },
    // deno-lint-ignore no-explicit-any
    generateStream: (async () => { throw new Error('unused'); }) as any,
  };
  return { llm, calls };
}

const ARTIFACT: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter: 'You began May circling a decision. On the twelfth the circling stopped. The stone stands; the details can rest.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};
const NOTES = [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }];

describe('judgeReflectionRegister', () => {
  it('calls the small model with a tool and returns the verdict', async () => {
    const { llm, calls } = makeAdapter({ pass: true, reasons: [] });
    const r = await judgeReflectionRegister({ llm, artifact: ARTIFACT, notes: NOTES, periodLabel: 'May 2026' });
    expect(r).toEqual({ pass: true, reasons: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('haiku');
    expect(calls[0].tool.name).toBe('judge_reflection_register');
    expect(calls[0].system).toContain('witnessed, not reopened');
  });

  it('passes through a failing verdict with reasons', async () => {
    const { llm } = makeAdapter({ pass: false, reasons: ['title reads like a sermon header'] });
    const r = await judgeReflectionRegister({ llm, artifact: ARTIFACT, notes: NOTES, periodLabel: 'May 2026' });
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain('title reads like a sermon header');
  });

  it('coerces a missing reasons array to empty', async () => {
    const { llm } = makeAdapter({ pass: true, reasons: undefined as unknown as string[] });
    const r = await judgeReflectionRegister({ llm, artifact: ARTIFACT, notes: NOTES, periodLabel: 'May 2026' });
    expect(r.reasons).toEqual([]);
  });
});
