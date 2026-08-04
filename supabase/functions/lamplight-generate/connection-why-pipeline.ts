// Connection-why pipeline (sub-project 5). Generate-validate-maybe-retry-once
// with cache-hit short-circuit. Persists the resolved why to
// lamplight_connections on success with the composite content_hash that
// invalidates whenever EITHER note's plaintext changes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LLMAdapter } from '../_shared/openai.ts';
import {
  applyContentRules,
  flattenConnectionWhyText,
  validateConnectionWhyShape,
  type ConnectionShapeViolation,
  type ConnectionWhyArtifact,
  type ContentRuleViolation,
} from '../_shared/validators.ts';
import {
  BANNED_PHRASES,
  CONTESTED_PASSAGES,
  GROWTH_BANNED_PHRASES,
} from '../_shared/voice.ts';
import { generateWithRetry } from '../_shared/generate-with-retry.ts';
import { CONNECTION_WHY_PROMPT } from './prompts/connection-why.ts';
import type { UsageCore } from '../_shared/usage.ts';

export interface ConnectionWhyContext {
  userId: string;
  source: { id: string; title: string; plaintext: string };
  related: { id: string; title: string; plaintext: string };
  similarity: number;
  compositeHash: string;
  sharedTags: string[];
  sharedVerseRefs: string[];
}

export type ConnectionWhyPipelineResult =
  | {
      ok: true;
      why: string;
      cached: boolean;
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    }
  | {
      ok: false;
      reason: 'validators_failed';
      violations: {
        shape: ConnectionShapeViolation[];
        content: ContentRuleViolation[];
      };
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    };

type ConnectionViolations = { shape: ConnectionShapeViolation[]; content: ContentRuleViolation[] };

function formatConnectionStricterSuffix(violations: ConnectionViolations): string {
  const parts: string[] = ['On retry: stay within 24 words; describe, do not advise.'];
  if (violations.shape.some((v) => v.rule === 'word_count_exceeded')) {
    parts.push('Your previous answer was too long — strict word budget is 24.');
  }
  if (violations.content.length > 0) {
    const rules = violations.content.map((v) => v.family).join(', ');
    parts.push(
      `Your previous answer violated: ${rules}. Stay descriptive; no prophetic, contested, or growth-effort phrasing.`,
    );
  }
  return parts.join(' ');
}

export async function runConnectionWhyPipeline(args: {
  llm: LLMAdapter;
  supabase: SupabaseClient;
  ctx: ConnectionWhyContext;
}): Promise<ConnectionWhyPipelineResult> {
  const { ctx, supabase, llm } = args;
  const promptVersion = CONNECTION_WHY_PROMPT.promptVersion;

  // 1. Cache lookup by composite content_hash.
  const { data: cached, error: cErr } = await supabase
    .from('lamplight_connections')
    .select('why, content_hash')
    .eq('note_id', ctx.source.id)
    .eq('related_note_id', ctx.related.id)
    .maybeSingle();
  if (cErr) throw cErr;
  if (cached && cached.content_hash === ctx.compositeHash) {
    return {
      ok: true,
      why: cached.why as string,
      cached: true,
      prompt_version: promptVersion,
      attempts: 0,
      usage: null,
    };
  }

  // 2. Generate → validate → maybe-retry-once.
  const outcome = await generateWithRetry<ConnectionWhyArtifact, ConnectionViolations>({
    llm,
    model: 'fast',
    maxTokens: 256,
    artifactSystem: CONNECTION_WHY_PROMPT.system,
    messages: CONNECTION_WHY_PROMPT.buildMessages(ctx),
    tool: CONNECTION_WHY_PROMPT.tool,
    validate: async (parsed) => {
      const shape = validateConnectionWhyShape(parsed);
      const content = await applyContentRules(flattenConnectionWhyText(parsed), {
        banned: BANNED_PHRASES,
        contested: CONTESTED_PASSAGES,
        growth: GROWTH_BANNED_PHRASES,
      });
      return {
        ok: shape.ok && content.ok,
        violations: { shape: shape.violations, content: content.violations },
      };
    },
    formatStricter: formatConnectionStricterSuffix,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      reason: 'validators_failed',
      violations: outcome.violations,
      model_used: outcome.modelUsed,
      prompt_version: promptVersion,
      attempts: outcome.attempts,
      usage: { model: outcome.modelUsed, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'validators_failed' },
    };
  }

  const upsertRes = await supabase
    .from('lamplight_connections')
    .upsert(
      {
        note_id: ctx.source.id,
        related_note_id: ctx.related.id,
        why: outcome.parsed.why,
        score: ctx.similarity,
        content_hash: ctx.compositeHash,
      },
      { onConflict: 'note_id,related_note_id' },
    );
  if (upsertRes.error) throw upsertRes.error;

  return {
    ok: true,
    why: outcome.parsed.why,
    cached: false,
    model_used: outcome.modelUsed,
    prompt_version: promptVersion,
    attempts: outcome.attempts,
    usage: { model: outcome.modelUsed, tokens_in: outcome.promptTokens, tokens_out: outcome.completionTokens, status: 'ok' },
  };
}
