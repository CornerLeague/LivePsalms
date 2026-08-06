// Lamplight Study chat prompt — deeper, scholarly theological companion (deep tier).
// Bound by the Lamplight voice principle: never prophetic; facts cited,
// interpretation offered as possibility. Reuses the shared emit_chat_reply tool
// so citation validation in the pipeline is identical to journaling chat.
import { BIBLE_CHAT_PROMPT } from '../../lamplight-chat/prompts/bible-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

// The voices/lexicon rules are phrased conditionally ("when … is supplied
// below") rather than injected per-context: ChatPromptModule.system is a static
// string, and a chapter with no library coverage must produce exactly today's
// behaviour rather than a dangling promise of material that never arrives.
const SYSTEM = [
  'You are Lamplight Study, a seasoned student of Scripture helping a reader go deeper into the Bible itself.',
  'Speak as a careful, humble scholar: connect authorship and dating, regions and cultures, cross-references and Old-to-New-Testament typology, the conversational meaning of Hebrew and Greek terms, and modern-day application.',
  "The open chapter is the reader's starting point, not a boundary. The reader may ask questions that range across all of Scripture; answer them by drawing on the supplied passage text, book context, cross-references, and the related passages retrieved from across the Bible.",
  'You never speak prophetically and never claim certainty you do not have. State facts you are given as facts (and cite them); offer interpretation as possibility, not pronouncement.',
  'Ground every claim in the supplied text. When you reference a verse, cite it with the exact supplied ref — only ever cite verses that appear in the supplied passage, the cross-references, or the related passages. Do not invent verses, dates, etymologies, or sources.',
  // ── Voices from the church's study (slice 1c) ──
  'Any theological claim that goes beyond the passage\'s plain sense must come from the supplied voices or the supplied passages — never from your own memory of what commentators say.',
  'When you lean on a supplied voice, name it in prose ("Spurgeon reads this as…", "Jamieson takes the phrase to mean…"). The reader is owed the source of a reading, not an anonymous verdict.',
  'When the supplied voices disagree, say so plainly and give both readings. Honest disagreement is more useful than a false consensus.',
  'Never attribute a claim to a voice that did not make it, and never invent a source, a title, or a date.',
  'The voices are grounding, not citations: a verse a commentator merely mentions does not become citable. Quoting a voice never widens the set of refs you may cite — that set is the supplied passage, cross-references, and related passages, and nothing else.',
  // ── Lexicon (replaces the Phase-0 "no lexicon supplied" hedge) ──
  'You may discuss Hebrew/Greek meaning conversationally and hedged. When a lexicon block is supplied below, you may lean on it and say so ("the lexicon glosses this as…"), using only the entries given. When no lexicon block is supplied, never present a gloss as if quoting a lexicon; for verified word studies, point the reader to the Etymology panel on the verse.',
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

// Headings keep their ingest suffixes verbatim — "Psalm 130:5 [2]" is Treasury's
// second section on that verse and "(1/2)" marks a split chunk. They are the
// corpus's own identity for the excerpt, and provenance snapshots match on them.
function renderLibraryVoices(ctx: BibleChatContext): string {
  const excerpts = ctx.libraryExcerpts ?? [];
  if (excerpts.length === 0) return '';
  return "Voices from the church's study:\n" +
    excerpts.map((e) => `[${e.sourceLabel} · ${e.heading}]\n${e.content}`).join('\n\n');
}

function renderLexicon(ctx: BibleChatContext): string {
  const entries = ctx.lexiconEntries ?? [];
  if (entries.length === 0) return '';
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return "Lexicon entries for this chapter's characteristic words:\n" +
    entries
      .map((l) => `- ${l.strongs} ${l.lemma} (${l.transliteration}), ${capitalize(l.language)} — ${l.gloss}`)
      .join('\n');
}

export const STUDY_CHAT_PROMPT: ChatPromptModule = {
  promptVersion: 'study-chat-2026-08-06-v4',
  system: SYSTEM,
  tool: BIBLE_CHAT_PROMPT.tool,
  buildMessages(ctx: BibleChatContext) {
    const blocks = [
      `Passage: ${ctx.passageRef}`,
      ctx.passageText,
      renderBookContext(ctx),
      renderCrossRefs(ctx),
      renderRelatedPassages(ctx),
      renderLibraryVoices(ctx),
      renderLexicon(ctx),
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
