// Lamplight Study chat prompt — deeper, scholarly theological companion (deep tier).
// Bound by the Lamplight voice principle: never prophetic; facts cited,
// interpretation offered as possibility. Reuses the shared emit_chat_reply tool
// so citation validation in the pipeline is identical to journaling chat.
import { BIBLE_CHAT_PROMPT } from '../../lamplight-chat/prompts/bible-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const SYSTEM = [
  'You are Lamplight Study, a seasoned student of Scripture helping a reader go deeper into the Bible itself.',
  'Speak as a careful, humble scholar: connect authorship and dating, regions and cultures, cross-references and Old-to-New-Testament typology, the conversational meaning of Hebrew and Greek terms, and modern-day application.',
  "The open chapter is the reader's starting point, not a boundary. The reader may ask questions that range across all of Scripture; answer them by drawing on the supplied passage text, book context, cross-references, and the related passages retrieved from across the Bible.",
  'You never speak prophetically and never claim certainty you do not have. State facts you are given as facts (and cite them); offer interpretation as possibility, not pronouncement.',
  'Ground every claim in the supplied text. When you reference a verse, cite it with the exact supplied ref — only ever cite verses that appear in the supplied passage, the cross-references, or the related passages. Do not invent verses, dates, etymologies, or sources.',
  'You may discuss Hebrew/Greek meaning conversationally and hedged. No lexicon entries are supplied in this context, so never present a gloss as if quoting a lexicon; for verified word studies, point the reader to the Etymology panel on the verse.',
].join(' ');

function renderBookContext(ctx: BibleChatContext): string {
  const b = ctx.bookContext;
  if (!b) return '';
  return [
    `Book context for ${b.book}:`,
    `- Author: ${b.author} (${b.authorNote})`,
    `- Date: ${b.dateLabel}`,
    `- Region: ${b.region}`,
    `- Genre: ${b.genre}`,
    `- Cultural context: ${b.culturalContext}`,
    `- Summary: ${b.summary}`,
  ].join('\n');
}

function renderCrossRefs(ctx: BibleChatContext): string {
  if (ctx.crossRefs.length === 0) return '';
  return 'Cross-references:\n' + ctx.crossRefs.map((c) => `- ${c.ref}: ${c.text}`).join('\n');
}

function renderRelatedPassages(ctx: BibleChatContext): string {
  const rp = ctx.relatedPassages ?? [];
  if (rp.length === 0) return '';
  return 'Related passages from across Scripture:\n' + rp.map((p) => `- ${p.ref}: ${p.text}`).join('\n');
}

function renderNotes(ctx: BibleChatContext): string {
  if (ctx.notes.length === 0) return '';
  return 'The reader has chosen to bring in these notes:\n' +
    ctx.notes.map((n) => `- [${n.id}] ${n.title}: ${n.plaintext}`).join('\n');
}

export const STUDY_CHAT_PROMPT: ChatPromptModule = {
  promptVersion: 'study-chat-2026-08-04-v3',
  system: SYSTEM,
  tool: BIBLE_CHAT_PROMPT.tool,
  buildMessages(ctx: BibleChatContext) {
    const blocks = [
      `Passage: ${ctx.passageRef}`,
      ctx.passageText,
      renderBookContext(ctx),
      renderCrossRefs(ctx),
      renderRelatedPassages(ctx),
      renderNotes(ctx),
    ].filter((s) => s.trim().length > 0);
    const grounding = blocks.join('\n\n');
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: grounding },
    ];
    for (const h of ctx.history) out.push({ role: h.role, content: h.content });
    out.push({ role: 'user', content: ctx.userMessage });
    return out;
  },
};
