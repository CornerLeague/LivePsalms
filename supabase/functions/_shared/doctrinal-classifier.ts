// Layer C (follow-up P0-5): the LLM doctrinal classifier for applyContentRules'
// `classifier` slot. A fast-tier second pass behind the regex families — it
// catches what regex cannot: tense-shifted or paraphrased prophetic claims
// ("heaven has a plan for you this week"), contested-passage interpretation in
// fresh wording, and reworded streak/effort-shaming pressure.
//
// Contract:
// - Returns the same ContentRuleViolation shape as the regex families, so
//   formatContentFamilyStricter drives the retry prompt with no callsite changes.
// - FAIL-OPEN: any classifier error resolves to [] with a console.error. The
//   regex layer still guards; availability of generation must never hinge on a
//   second model call succeeding.
// - Framework-free below the LLMAdapter seam; node-testable with a fake adapter.

import type { LLMAdapter, ToolSchema } from './openai.ts';
import type { ContentRuleViolation } from './validators.ts';
import { CONTESTED_PASSAGES } from './voice.ts';

const CLASSIFIER_FAMILIES = new Set(['banned', 'contested', 'growth']);
const MAX_VIOLATIONS = 5;
const MAX_TEXT_CHARS = 6000;

const CLASSIFIER_SYSTEM = `You are the doctrinal classifier behind a Christian journaling companion's regex guardrails. You read one generated artifact and flag ONLY violations of these three rules, however reworded:

- banned: the artifact speaks for God to the reader — prophetic, oracular, or destiny claims in any paraphrase ("heaven has a plan for you this week", "the Spirit led me to tell you", "this season is God preparing you for what he's about to do"). Claims ABOUT God from Scripture are fine; claims FROM God to this reader are not.
- contested: the artifact interprets one of the listed contested passages beyond plain reading (takes a side, resolves the debate) rather than naming it gently and deferring.
- growth: streak, missed-day, or effort-shaming pressure in any wording ("don't lose the momentum you've built", "you owe it to yourself to show up daily").

Never flag: quoted Scripture itself; describing what a passage says; possibility-framed interpretation ("this passage often means", "read against what you wrote, this may"); reverent ordinary use of divine names; encouragement that carries no divine-message or consistency-pressure claim.

Report at most ${MAX_VIOLATIONS} violations, each with the family, a short reason, and the exact offending snippet copied from the artifact. Return an empty list when the artifact is clean. You are a guardrail, not a style critic — when genuinely unsure, do not flag.`;

const CLASSIFIER_TOOL: ToolSchema = {
  name: 'report_doctrinal_violations',
  description: 'Report guardrail violations found in the artifact text; empty when clean.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['violations'],
    properties: {
      violations: {
        type: 'array',
        maxItems: MAX_VIOLATIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['family', 'reason', 'snippet'],
          properties: {
            family: { type: 'string', enum: ['banned', 'contested', 'growth'] },
            reason: { type: 'string', maxLength: 200 },
            snippet: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
  },
};

interface ClassifierParsed {
  violations?: Array<{ family?: string; reason?: string; snippet?: string }>;
}

export function makeDoctrinalClassifier(
  llm: LLMAdapter,
): (text: string) => Promise<ContentRuleViolation[]> {
  return async (text: string): Promise<ContentRuleViolation[]> => {
    if (!text.trim()) return [];
    try {
      const { parsed } = await llm.generate<ClassifierParsed>({
        model: 'fast',
        system: CLASSIFIER_SYSTEM,
        messages: [{
          role: 'user',
          content:
            `Contested passages (flag interpretation beyond plain reading of these):\n` +
            `${CONTESTED_PASSAGES.join(', ')}\n\n` +
            `Artifact text:\n${text.slice(0, MAX_TEXT_CHARS)}\n\n` +
            `Report violations with the report_doctrinal_violations tool.`,
        }],
        tool: CLASSIFIER_TOOL,
        maxTokens: 512,
      });
      const raw = Array.isArray(parsed.violations) ? parsed.violations : [];
      return raw
        .filter((v): v is { family: string; reason?: string; snippet?: string } =>
          typeof v?.family === 'string' && CLASSIFIER_FAMILIES.has(v.family))
        .slice(0, MAX_VIOLATIONS)
        .map((v) => ({
          family: v.family as ContentRuleViolation['family'],
          rule: `classifier:${(v.reason ?? 'unspecified').slice(0, 200)}`,
          snippet: (v.snippet ?? '').slice(0, 300),
        }));
    } catch (err) {
      console.error('[doctrinal-classifier] failed open', err);
      return [];
    }
  };
}
