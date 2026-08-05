// The generate→validate→retry-once loop shared by every Lamplight pipeline.
//
// Pure of Supabase and persistence: it owns only the LLM control flow (compose
// system, generate, validate, retry-with-stricter-prompt) and returns a
// RetryOutcome — *data, not side effects*. Each pipeline does its own cache
// pre-check, no_notes guard, and success persistence around this call.
//
// Sits one layer below GenerationLifecycle (the quota/usage envelope): the
// envelope wraps the whole body; this wraps the per-attempt LLM loop inside it.
//
// Node-testable with a fake LLMAdapter; no Supabase fakes required.

import type { GenerateInput, LLMAdapter, LLMModel, ReasoningEffort, ToolSchema } from './openai.ts';
import { LAMPLIGHT_SYSTEM_FRAGMENT, composeSystem } from './voice.ts';

export interface GenerateWithRetryConfig<TParsed, TViolations> {
  llm: LLMAdapter;
  model: LLMModel;
  maxTokens: number;
  /** Reasoning effort; omitted means the adapter's per-tier default. Applies to every attempt. */
  effort?: ReasoningEffort;
  /** The per-artifact system stance. LAMPLIGHT_SYSTEM_FRAGMENT is baked in as the base. */
  artifactSystem: string;
  /** Template tokens substituted into the composed system prompt (e.g. { local_date }). */
  systemTokens?: Record<string, string>;
  messages: GenerateInput['messages'];
  tool: ToolSchema;
  /** Validate one generation. `ok` stops the loop; `violations` is threaded into the next stricter prompt. */
  validate: (parsed: TParsed) => Promise<{ ok: boolean; violations: TViolations }>;
  /** Turn the previous attempt's violations into a stricter-prompt suffix. Called only on retry. */
  formatStricter: (violations: TViolations) => string;
  /** Total attempts including the first. Default 2 (one retry). */
  maxAttempts?: number;
}

export type RetryOutcome<TParsed, TViolations> =
  | {
      ok: true;
      parsed: TParsed;
      modelUsed: string;
      promptTokens: number;
      completionTokens: number;
      attempts: number;
    }
  | {
      ok: false;
      violations: TViolations;
      modelUsed: string;
      attempts: number;
    };

export async function generateWithRetry<TParsed, TViolations>(
  cfg: GenerateWithRetryConfig<TParsed, TViolations>,
): Promise<RetryOutcome<TParsed, TViolations>> {
  const maxAttempts = cfg.maxAttempts ?? 2;
  let attempts = 0;
  let lastViolations: TViolations | null = null;
  let lastModelUsed = '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts++;
    const stricter = attempt === 0 ? '' : cfg.formatStricter(lastViolations as TViolations);
    const system = composeSystem({
      base: LAMPLIGHT_SYSTEM_FRAGMENT,
      artifact: cfg.artifactSystem,
      stricter,
      tokens: cfg.systemTokens,
    });

    const { parsed, modelUsed, promptTokens, completionTokens } = await cfg.llm.generate<TParsed>({
      model: cfg.model,
      system,
      messages: cfg.messages,
      tool: cfg.tool,
      maxTokens: cfg.maxTokens,
      effort: cfg.effort,
    });
    lastModelUsed = modelUsed;

    const { ok, violations } = await cfg.validate(parsed);
    if (ok) {
      return { ok: true, parsed, modelUsed, promptTokens, completionTokens, attempts };
    }
    lastViolations = violations;
  }

  return {
    ok: false,
    violations: lastViolations as TViolations,
    modelUsed: lastModelUsed,
    attempts,
  };
}
