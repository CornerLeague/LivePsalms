// Pure LLM control flow for one chat turn: generate → validate (citations +
// content rules) → retry once. No Supabase / persistence (the handler owns
// thread + message writes). Node-testable with a fake LLMAdapter.

import type { LLMAdapter, LLMModel } from '../_shared/anthropic.ts';
import { BANNED_PHRASES, CONTESTED_PASSAGES, GROWTH_BANNED_PHRASES } from '../_shared/voice.ts';
import {
  validateChatReplyCitations,
  applyContentRules,
  formatContentFamilyStricter,
  type ChatReply,
  type CitationViolation,
  type ContentRuleViolation,
} from '../_shared/validators.ts';
import { generateWithRetry } from '../_shared/generate-with-retry.ts';
import { BIBLE_CHAT_PROMPT } from './prompts/bible-chat.ts';
import type { UsageCore } from '../_shared/usage.ts';

export interface ChatPromptModule {
  promptVersion: string;
  system: string;
  tool: unknown;
  buildMessages: (ctx: BibleChatContext) => Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface BookContext {
  book: string;            // human name, e.g. "John"
  author: string;
  authorNote: string;
  dateLabel: string;
  region: string;
  culturalContext: string;
  genre: string;
  summary: string;
}

export interface BibleChatContext {
  passageRef: string;                  // e.g. "jhn 10"
  passageText: string;                 // open chapter text (joined)
  crossRefs: Array<{ ref: string; text: string }>;
  notes: Array<{ id: string; title: string; plaintext: string }>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  allowedNoteIds: Set<string>;
  allowedVerseRefs: Set<string>;
  bookContext?: BookContext | null;    // study apparatus grounding (optional; chat leaves undefined)
}

export type BibleChatPipelineResult =
  | { ok: true; reply: string; citations: ChatReply['citations']; modelUsed: string; promptVersion: string; attempts: number; usage: UsageCore | null }
  | { ok: false; reason: 'validators_failed'; promptVersion: string; attempts: number; usage: UsageCore | null };

type ChatViolations = { citation: CitationViolation[]; content: ContentRuleViolation[] };

export async function runBibleChatPipeline(args: {
  llm: LLMAdapter;
  ctx: BibleChatContext;
  prompt?: ChatPromptModule;
  model?: LLMModel;
}): Promise<BibleChatPipelineResult> {
  const prompt: ChatPromptModule = args.prompt ?? BIBLE_CHAT_PROMPT;
  const promptVersion = prompt.promptVersion;
  const ctx = args.ctx;

  const outcome = await generateWithRetry<ChatReply, ChatViolations>({
    llm: args.llm,
    model: args.model ?? 'sonnet',
    maxTokens: 1024,
    artifactSystem: prompt.system,
    messages: prompt.buildMessages(ctx),
    // `as const` on the nested schema produces literal types narrower than
    // ToolSchema.input_schema (Record<string, unknown>); cast is type-only.
    tool: prompt.tool as Parameters<LLMAdapter['generate']>[0]['tool'],
    validate: async (parsed) => {
      const citation = validateChatReplyCitations(parsed, {
        allowedNoteIds: ctx.allowedNoteIds,
        allowedVerseRefs: ctx.allowedVerseRefs,
      });
      const content = await applyContentRules(parsed.reply ?? '', {
        banned: BANNED_PHRASES,
        contested: CONTESTED_PASSAGES,
        growth: GROWTH_BANNED_PHRASES,
      });
      return { ok: citation.ok && content.ok, violations: { citation: citation.violations, content: content.violations } };
    },
    formatStricter: (v) => {
      const parts: string[] = [];
      if (v.citation.length > 0) parts.push('On retry: cite only the supplied verse refs and note ids, or return an empty citations array.');
      parts.push(...formatContentFamilyStricter(v.content));
      return parts.join(' ');
    },
  });

  if (!outcome.ok) {
    return {
      ok: false,
      reason: 'validators_failed',
      promptVersion,
      attempts: outcome.attempts,
      usage: { model: outcome.modelUsed, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'validators_failed' },
    };
  }

  return {
    ok: true,
    reply: outcome.parsed.reply,
    citations: outcome.parsed.citations ?? [],
    modelUsed: outcome.modelUsed,
    promptVersion,
    attempts: outcome.attempts,
    usage: { model: outcome.modelUsed, tokens_in: outcome.promptTokens, tokens_out: outcome.completionTokens, status: 'ok' },
  };
}
