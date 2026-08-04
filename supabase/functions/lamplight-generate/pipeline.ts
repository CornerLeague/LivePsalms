// Smoke-test pipeline. Pure function of (LLMAdapter, ctx) — no I/O of its
// own. The HTTP shell (index.ts) builds ctx via buildSmokeTestContext and
// hands it here. Unit-testable by injecting a fake adapter + handcrafted ctx.

import type { LLMAdapter } from '../_shared/openai.ts';
import type { UsageCore } from '../_shared/usage.ts';
import {
  BANNED_PHRASES,
  CONTESTED_PASSAGES,
  GROWTH_BANNED_PHRASES,
} from '../_shared/voice.ts';
import {
  validateCitations,
  applyContentRules,
  flattenArtifactText,
  formatContentFamilyStricter,
  type ArtifactSection,
  type CitationViolation,
  type ContentRuleViolation,
} from '../_shared/validators.ts';
import { generateWithRetry } from '../_shared/generate-with-retry.ts';
import { SMOKE_TEST_PROMPT } from './prompts/smoke-test.ts';

export interface SmokeTestNote {
  id: string;
  title: string;
  plaintext: string;
}

export interface SmokeTestPassage {
  source_id: string;
  text: string;
  ref: string;
  metadata: Record<string, unknown>;
}

export interface SmokeTestContext {
  notes: SmokeTestNote[];
  passages: SmokeTestPassage[];
  allowedNoteIds: Set<string>;
  allowedVerseRefs: Set<string>;
  rerankUsed: boolean;
}

export interface SmokeTestArtifact {
  opening: string;
  sections: ArtifactSection[];
}

export type PipelineResult =
  | {
      ok: true;
      artifact: SmokeTestArtifact;
      model_used: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
      retrieval: { note_neighbors: number; bible_passages: number; reranked: boolean };
    }
  | {
      ok: false;
      reason: 'no_notes' | 'validators_failed';
      violations?: { citation: CitationViolation[]; content: ContentRuleViolation[] };
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    };

type SmokeViolations = { citation: CitationViolation[]; content: ContentRuleViolation[] };

export async function runSmokeTestPipeline(args: {
  llm: LLMAdapter;
  ctx: SmokeTestContext | null;
}): Promise<PipelineResult> {
  const promptVersion = SMOKE_TEST_PROMPT.promptVersion;

  if (!args.ctx) {
    return { ok: false, reason: 'no_notes', prompt_version: promptVersion, attempts: 0, usage: null };
  }
  const ctx = args.ctx;

  const outcome = await generateWithRetry<SmokeTestArtifact, SmokeViolations>({
    llm: args.llm,
    model: 'balanced',
    maxTokens: 2048,
    artifactSystem: SMOKE_TEST_PROMPT.system,
    messages: SMOKE_TEST_PROMPT.buildMessages(ctx),
    tool: SMOKE_TEST_PROMPT.tool,
    validate: async (parsed) => {
      const citation = validateCitations(parsed, {
        allowedNoteIds: ctx.allowedNoteIds,
        allowedVerseRefs: ctx.allowedVerseRefs,
      });
      const content = await applyContentRules(flattenArtifactText(parsed), {
        banned: BANNED_PHRASES,
        contested: CONTESTED_PASSAGES,
        growth: GROWTH_BANNED_PHRASES,
      });
      return {
        ok: citation.ok && content.ok,
        violations: { citation: citation.violations, content: content.violations },
      };
    },
    formatStricter: formatStricterSuffix,
  });

  if (outcome.ok) {
    return {
      ok: true,
      artifact: outcome.parsed,
      model_used: outcome.modelUsed,
      prompt_version: promptVersion,
      attempts: outcome.attempts,
      usage: { model: outcome.modelUsed, tokens_in: outcome.promptTokens, tokens_out: outcome.completionTokens, status: 'ok' },
      retrieval: {
        note_neighbors: ctx.notes.length,
        bible_passages: ctx.passages.length,
        reranked: ctx.rerankUsed,
      },
    };
  }

  return {
    ok: false,
    reason: 'validators_failed',
    violations: outcome.violations,
    model_used: outcome.modelUsed,
    prompt_version: promptVersion,
    attempts: outcome.attempts,
    usage: null,
  };
}

function formatStricterSuffix(violations: SmokeViolations): string {
  const parts: string[] = [];
  if (violations.citation.length > 0) {
    parts.push(
      'On retry: every section MUST include at least one entry in citations[], and every cited verse ref MUST match exactly one of the refs supplied in the user prompt.',
    );
  }
  parts.push(...formatContentFamilyStricter(violations.content));
  return parts.join(' ');
}
