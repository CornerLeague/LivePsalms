// supabase/functions/etymology-insight/prompts/verse-insight.ts
export const VERSE_INSIGHT_PROMPT_VERSION = 'etymology-verse-insight-2026-07-08-v1';

export interface EtymologyInsightContext {
  reference: string;
  verseText: string;
  lemma: string;
  root: string;
  rootGloss: string;
  development: string;
  related: Array<{ word: string; gloss: string }>;
}

export const VERSE_INSIGHT_PROMPT = {
  promptVersion: VERSE_INSIGHT_PROMPT_VERSION,
  system: [
    'You explain how one already-studied Hebrew word functions in one specific verse.',
    'You are given VERIFIED facts about the word (its root, a short "how it grew" note,',
    'and related words) plus the verse text. In ≤40 words, connect the word to the verse.',
    '',
    'Hard rules:',
    '- Retell ONLY the verified facts supplied. NEVER invent etymology, cognates, or roots.',
    '- Describe — do not advise. No "you should…", no application, no devotional turn.',
    '- Quote at most two or three words of the verse; do not transcribe the whole line.',
    '- No prophetic claims, no interpretation of contested passages beyond plain reading.',
  ].join('\n'),
  tool: {
    name: 'emit_verse_insight',
    description: 'Return the one-paragraph, grounded insight about the word in this verse.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['body'],
      properties: {
        body: { type: 'string', minLength: 12, maxLength: 400 },
      },
    },
  },
  buildMessages(ctx: EtymologyInsightContext): Array<{ role: 'user'; content: string }> {
    const related = ctx.related.length
      ? ctx.related.map((r) => `${r.word} (${r.gloss})`).join(', ')
      : 'none';
    return [{
      role: 'user',
      content:
        `Verse — ${ctx.reference}: "${ctx.verseText}"\n\n` +
        `Word (lemma): ${ctx.lemma}\n` +
        `Verified root: ${ctx.root} — ${ctx.rootGloss}\n` +
        `Verified development: ${ctx.development}\n` +
        `Verified related words: ${related}\n\n` +
        `In ≤40 words, explain how this word works in this verse, using only the facts above.`,
    }];
  },
} as const;
