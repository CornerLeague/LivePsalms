// Lamplight Study chat prompt — deeper, scholarly theological companion (deep tier).
// Bound by the Lamplight voice principle: never prophetic; facts cited,
// interpretation offered as possibility. Reuses the shared emit_chat_reply tool
// so citation validation in the pipeline is identical to journaling chat.
import { makeChatReplyTool } from '../../lamplight-chat/prompts/bible-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

/**
 * Study answers carry more than a journaling reply does — a named voice, a
 * cross-reference, the hedge a contested reading needs — so the surface gets its
 * own ceiling rather than inheriting journaling's 1400.
 *
 * The ceiling is a backstop set comfortably ABOVE the word target in SYSTEM
 * below. It has to be: without `strict`, the model writes up to `maxLength` and
 * stops mid-word when it arrives. Sharing journaling's tool while saying nothing
 * about length is exactly how study replies came to be chopped at 1400
 * characters — two of three in the 2026-08-06 eval baseline, one of them
 * emitting corrupted text at the boundary.
 */
const STUDY_REPLY_MAX_CHARS = 3000;

// The voices/lexicon rules are phrased conditionally ("when … is supplied
// below") rather than injected per-context: ChatPromptModule.system is a static
// string, and a chapter with no library coverage must produce exactly today's
// behaviour rather than a dangling promise of material that never arrives.
/**
 * The rules every study-grounded surface obeys: how to treat supplied text, how
 * to name a voice, what a lexicon block does and does not license.
 *
 * Exported so Door 1 (`passage-insight.ts`) composes the SAME sentences rather
 * than a hand-written paraphrase. Two copies of a guardrail drift, and the one
 * that drifts is the one nobody re-reads — which is exactly how the contested
 * guard came to match a spelling study chat never emits.
 */
export const STUDY_GROUNDING_RULES: readonly string[] = [
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
];

const SYSTEM = [
  'You are Lamplight Study, a seasoned student of Scripture helping a reader go deeper into the Bible itself.',
  'Speak as a careful, humble scholar: connect authorship and dating, regions and cultures, cross-references and Old-to-New-Testament typology, the conversational meaning of Hebrew and Greek terms, and modern-day application.',
  "The open chapter is the reader's starting point, not a boundary. The reader may ask questions that range across all of Scripture; answer them by drawing on the supplied passage text, book context, cross-references, and the related passages retrieved from across the Bible.",
  ...STUDY_GROUNDING_RULES,
  // ── Contested questions ──
  // Study chat is exempt from the blanket CONTESTED_PASSAGES rejection (see
  // ChatPromptModule.allowContestedRefs), so the requirement lives here instead
  // of in a validator. This is the surface readers bring hard questions to;
  // refusing to name the verses would have been an answer nobody wanted.
  'On questions the church is genuinely divided about, do not adjudicate. Name the readings and who holds them ("Reformed readings emphasize…", "Wesleyan readings…", "Catholic teaching holds…"), give the textual reasoning behind each, say plainly that it is disputed among orthodox Christians, and point the reader to their own pastor or church. Discuss and cite the passage freely — but never settle it, and never imply the matter is obvious.',
  // ── Length ──
  // Load-bearing. Without a target the model writes to the schema ceiling and
  // stops mid-word; this is set well below it so a reply always finishes its
  // own last sentence. Finishing the thought matters more than the number.
  'Aim for 200–400 words: enough to develop one line of thought with its grounding, and then stop. Finish your final sentence — never break off mid-thought.',
].join(' ');

// Verse scope only. The selected verse with its immediate neighbours, marked so
// "what comes before and after" is a question the model can actually answer.
// Absent at chapter scope, where the whole passage text is already supplied.
function renderFocusVerses(ctx: BibleChatContext): string {
  const verses = ctx.focusVerses ?? [];
  if (verses.length === 0) return '';
  return 'The reader has selected a verse. Its immediate context:\n' +
    verses.map((v) => `- ${v.ref}${v.isFocus ? ' [the selected verse]' : ''}: ${v.text}`).join('\n');
}

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

/**
 * The grounding turn every study-grounded surface sends: passage, focus verses,
 * book apparatus, cross-references, related passages, library voices, lexicon,
 * and any notes the reader brought in.
 *
 * Shared with Door 1 so the two surfaces are grounded identically. A block
 * renders only when its data is present, so a caller that supplies less simply
 * sends less — no dangling promise of material that never arrives.
 */
export function renderStudyGrounding(ctx: BibleChatContext): string {
  return [
    `Passage: ${ctx.passageRef}`,
    ctx.passageText,
    renderFocusVerses(ctx),
    renderBookContext(ctx),
    renderCrossRefs(ctx),
    renderRelatedPassages(ctx),
    renderLibraryVoices(ctx),
    renderLexicon(ctx),
    renderNotes(ctx),
  ].filter((s) => s.trim().length > 0).join('\n\n');
}

export const STUDY_CHAT_PROMPT: ChatPromptModule = {
  // v6: own reply ceiling (3000, was journaling's 1400) + the word target that
  // keeps the model away from it; exempt from the contested-passage rejection,
  // with the labeled-readings requirement moved into SYSTEM above.
  promptVersion: 'study-chat-2026-08-06-v6',
  system: SYSTEM,
  allowContestedRefs: true,
  tool: makeChatReplyTool({ maxReplyChars: STUDY_REPLY_MAX_CHARS }),
  buildMessages(ctx: BibleChatContext) {
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: renderStudyGrounding(ctx) },
    ];
    for (const h of ctx.history) out.push({ role: h.role, content: h.content });
    out.push({ role: 'user', content: ctx.userMessage });
    return out;
  },
};
