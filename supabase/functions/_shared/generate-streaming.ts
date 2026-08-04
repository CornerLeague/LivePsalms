// Streaming validate/retry loop for Lamplight pipelines.
//
// Sibling of generate-with-retry.ts: same RetryOutcome shape, same system
// composition, but attempt-1 is a streaming call that fires onText/onPiece
// callbacks as each field completes. If a per-field gate rejects a field, or
// the cross-field validate fails after streaming, a single non-streaming retry
// runs with a stricter system prompt.
//
// No Deno or Node globals. No I/O.

import type { GenerateStreamInput } from './openai.ts';
import { LAMPLIGHT_SYSTEM_FRAGMENT, composeSystem } from './voice.ts';
import type { GenerateWithRetryConfig, RetryOutcome } from './generate-with-retry.ts';

export interface StreamingRetryConfig<TParsed, TViolations>
  extends GenerateWithRetryConfig<TParsed, TViolations> {
  textFields?: string[];
  signal?: AbortSignal;
  // per-field gate: return violations for a single just-completed field; if
  // non-empty, the field is NOT emitted and the loop aborts to a retry.
  perFieldValidate?: (field: string, value: unknown) => TViolations | null;
  onStage?: (stage: 'composing') => void;
  onText?: (field: string, delta: string) => void;
  onPiece?: (field: string, value: unknown) => void;
  onRefining?: () => void;
}

export async function generateStreamingWithRetry<TParsed, TViolations>(
  cfg: StreamingRetryConfig<TParsed, TViolations>,
): Promise<RetryOutcome<TParsed, TViolations>> {
  const system = composeSystem({
    base: LAMPLIGHT_SYSTEM_FRAGMENT,
    artifact: cfg.artifactSystem,
    stricter: '',
    tokens: cfg.systemTokens,
  });

  const input: GenerateStreamInput = {
    model: cfg.model,
    system,
    messages: cfg.messages,
    tool: cfg.tool,
    maxTokens: cfg.maxTokens,
    textFields: cfg.textFields,
    signal: cfg.signal,
  };

  let perFieldFailed: TViolations | null = null;
  let emittedAnything = false;

  cfg.onStage?.('composing');

  const stream = await cfg.llm.generateStream<TParsed>(input, {
    onText: (f, d) => {
      if (perFieldFailed) return;
      emittedAnything = true;
      cfg.onText?.(f, d);
    },
    onField: (f, v) => {
      if (perFieldFailed) return;
      const gate = cfg.perFieldValidate?.(f, v) ?? null;
      const empty = gate === null || (Array.isArray(gate) && gate.length === 0);
      if (!empty) {
        perFieldFailed = gate;
        return; // suppress field; will retry
      }
      emittedAnything = true;
      cfg.onPiece?.(f, v);
    },
  });

  // Determine whether this attempt succeeded.
  const crossFail = perFieldFailed
    ? { ok: false as const, violations: perFieldFailed }
    : await cfg.validate(stream.parsed);

  if (crossFail.ok) {
    return {
      ok: true,
      parsed: stream.parsed,
      modelUsed: stream.modelUsed,
      promptTokens: stream.promptTokens,
      completionTokens: stream.completionTokens,
      attempts: 1,
    };
  }

  // Gentle "refining" beat before the retry — only when something was already on
  // screen (emittedAnything) or a per-field gate suppressed a field (perFieldFailed,
  // which itself forces the retry). Keeps a blank screen from flashing "Refining…".
  if (emittedAnything || perFieldFailed) cfg.onRefining?.();

  // Non-streaming stricter retry (mirrors generate-with-retry attempt 2).
  const stricterSystem = composeSystem({
    base: LAMPLIGHT_SYSTEM_FRAGMENT,
    artifact: cfg.artifactSystem,
    stricter: cfg.formatStricter(crossFail.violations),
    tokens: cfg.systemTokens,
  });

  const retry = await cfg.llm.generate<TParsed>({
    model: cfg.model,
    system: stricterSystem,
    messages: cfg.messages,
    tool: cfg.tool,
    maxTokens: cfg.maxTokens,
  });

  const retryValidate = await cfg.validate(retry.parsed);
  if (retryValidate.ok) {
    return {
      ok: true,
      parsed: retry.parsed,
      modelUsed: retry.modelUsed,
      promptTokens: retry.promptTokens,
      completionTokens: retry.completionTokens,
      attempts: 2,
    };
  }

  return {
    ok: false,
    violations: retryValidate.violations,
    modelUsed: retry.modelUsed,
    attempts: 2,
  };
}
