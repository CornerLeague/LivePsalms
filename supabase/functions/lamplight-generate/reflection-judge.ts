// Layer-3 register judge (§6.3): one small-model tool-call that grades a
// candidate reflection against the §5 voice rules the deterministic validators
// can't see (title register, battle-handling given the ACTUAL notes,
// scorecard-feel, exemplar fidelity). Returns { pass, reasons }; the pipeline
// (Task 6) runs it only after the deterministic gates pass.

import type { LLMAdapter, ToolSchema } from '../_shared/anthropic.ts';
import type { ReflectionArtifact } from '../_shared/artifacts.ts';
import type { MonthNote } from './prompts/monthly-reflection.ts';

export interface ReflectionJudgeInput {
  llm: LLMAdapter;
  artifact: ReflectionArtifact;
  notes: MonthNote[];
  periodLabel: string;
}

export interface ReflectionJudgeResult {
  pass: boolean;
  reasons: string[];
}

const JUDGE_SYSTEM = `You are the register guardian for Waymarks — monthly reflections that read a person's month back to them as a letter. You are given the reflection AND the month's raw notes. Judge ONLY whether it holds the register; you do not rewrite.

Fail it if ANY of these are true:
- The title is a devotional/sermon header rather than something underline-worthy a person would want to keep.
- A hard season is REOPENED rather than witnessed: it recounts the painful detail, quotes the darkest lines back, or re-narrates the wound instead of naming that the season happened and was written through.
- The letter reads like a scorecard: it tallies or celebrates how often the person showed up, counts entries/days, or uses streak language.
- The letter drifts from the notes: it invents events the notes don't support, or feels generic enough to belong to any month.
- It abandons the graceful floor for a sparse month (shames the gaps, or manufactures an arc the little writing can't hold).

Pass it if the reflection is faithful to the notes, witnessed, not reopened, names without counting, and sounds like a hand on the shoulder. Report concrete reasons for any failure.`;

const JUDGE_TOOL: ToolSchema = {
  name: 'judge_reflection_register',
  description: 'Return whether the reflection holds the Waymarks register, with concrete reasons for any failure.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['pass', 'reasons'],
    properties: {
      pass: { type: 'boolean', description: 'true iff the reflection holds the register.' },
      reasons: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete reasons for a failure; empty when pass is true.',
      },
    },
  },
};

function buildJudgeMessages(
  artifact: ReflectionArtifact,
  notes: MonthNote[],
  periodLabel: string,
): Array<{ role: 'user'; content: string }> {
  const notesBlock = notes.map((n) => `[${n.day}] ${n.text}`).join('\n');
  return [{
    role: 'user',
    content:
      `Month: ${periodLabel}.\n\n` +
      `The reader's raw notes:\n${notesBlock}\n\n` +
      `The reflection to judge:\n${JSON.stringify(artifact, null, 2)}\n\n` +
      `Judge it with the judge_reflection_register tool.`,
  }];
}

export async function judgeReflectionRegister(input: ReflectionJudgeInput): Promise<ReflectionJudgeResult> {
  const { parsed } = await input.llm.generate<ReflectionJudgeResult>({
    model: 'haiku',
    system: JUDGE_SYSTEM,
    messages: buildJudgeMessages(input.artifact, input.notes, input.periodLabel),
    tool: JUDGE_TOOL,
    maxTokens: 512,
  });
  return { pass: parsed.pass === true, reasons: parsed.reasons ?? [] };
}
