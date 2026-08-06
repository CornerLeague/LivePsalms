import { describe, it, expect } from 'vitest';
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import { BIBLE_CHAT_PROMPT } from '../../lamplight-chat/prompts/bible-chat.ts';

type ToolShape = { input_schema: { properties: { reply: { maxLength: number } } } };
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';
import type { LibraryExcerpt, LexiconEntry } from '../../_shared/library-retrieval.ts';

const EXCERPTS: LibraryExcerpt[] = [
  {
    chunkId: 'lc1', sourceId: 'treasury-of-david',
    sourceLabel: 'The Treasury of David · Charles H. Spurgeon, 1869–1885',
    heading: 'Psalm 27:4 [2]',
    content: 'One thing — the unity of desire.',
    score: 0.9,
  },
  {
    chunkId: 'lc2', sourceId: 'jfb',
    sourceLabel: 'Jamieson-Fausset-Brown · Robert Jamieson, 1871',
    heading: 'Psalm 27:4',
    content: 'The one petition of a soul at war.',
    score: 0.7,
  },
];

const LEXICON: LexiconEntry[] = [
  { strongs: 'H216', lemma: 'אוֹר', transliteration: 'or', gloss: 'illumination', language: 'hebrew', occurrences: 3 },
];

function baseCtx(overrides: Partial<BibleChatContext> = {}): BibleChatContext {
  return {
    passageRef: 'jhn 10',
    passageText: '11 I am the good shepherd.',
    crossRefs: [],
    notes: [],
    history: [],
    userMessage: 'How does this connect to Psalm 23?',
    allowedNoteIds: new Set<string>(),
    allowedVerseRefs: new Set<string>(),
    ...overrides,
  };
}

const ctxFull: BibleChatContext = {
  passageRef: 'jhn 10',
  passageText: '11 I am the good shepherd.',
  crossRefs: [{ ref: 'psa 23:1', text: 'The LORD is my shepherd.' }],
  notes: [],
  history: [],
  userMessage: 'What does shepherd mean here?',
  allowedNoteIds: new Set(),
  allowedVerseRefs: new Set(['jhn 10:11', 'psa 23:1']),
  bookContext: {
    book: 'John', author: 'John the Apostle (traditional)', authorNote: 'authorship debated',
    dateLabel: '~85–95 AD', region: 'Ephesus (traditional)', culturalContext: 'Greco-Roman',
    genre: 'Gospel', summary: 'The signs and discourses of Jesus.',
  },
};

describe('STUDY_CHAT_PROMPT', () => {
  it('bumps the prompt version', () => {
    expect(STUDY_CHAT_PROMPT.promptVersion).toBe('study-chat-2026-08-06-v5');
  });

  it('renders the related-passages block when present', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx({
      relatedPassages: [{ ref: 'Psalm 23:1', text: 'The LORD is my shepherd' }],
    }));
    const grounding = msgs[0].content;
    expect(grounding).toContain('Related passages from across Scripture:');
    expect(grounding).toContain('- Psalm 23:1: The LORD is my shepherd');
  });

  it('omits the related-passages block when absent or empty', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx({ relatedPassages: [] }));
    expect(msgs[0].content).not.toContain('Related passages from across Scripture:');
    const msgsUndef = STUDY_CHAT_PROMPT.buildMessages(baseCtx());
    expect(msgsUndef[0].content).not.toContain('Related passages from across Scripture:');
  });

  it('keeps the user message as the final turn', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx());
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'How does this connect to Psalm 23?' });
  });

  it('has a versioned id and emits the shared chat-reply tool', () => {
    expect(STUDY_CHAT_PROMPT.promptVersion).toMatch(/^study-chat-/);
    expect((STUDY_CHAT_PROMPT.tool as { name: string }).name).toBe('emit_chat_reply');
  });

  // The 2026-08-06 eval baseline caught study replies stopping at exactly 1400
  // characters mid-word, one of them emitting corrupted text at the boundary.
  // Two things fix that together, so both are pinned.
  it('carries its own reply ceiling, not the journaling one', () => {
    const reply = (STUDY_CHAT_PROMPT.tool as ToolShape).input_schema.properties.reply;
    expect(reply.maxLength).toBe(3000);
    expect((BIBLE_CHAT_PROMPT.tool as ToolShape).input_schema.properties.reply.maxLength).toBe(1400);
  });

  it('states a word target, without which the model writes to the ceiling', () => {
    expect(STUDY_CHAT_PROMPT.system).toMatch(/200.{0,3}400 words/);
    expect(STUDY_CHAT_PROMPT.system).toContain('Finish your final sentence');
  });

  it('keeps the ceiling comfortably above the target — a backstop, not a goal', () => {
    const reply = (STUDY_CHAT_PROMPT.tool as ToolShape).input_schema.properties.reply;
    // 400 words is roughly 2400 characters at ~6 chars/word.
    expect(reply.maxLength).toBeGreaterThan(400 * 6);
  });

  it('grounds messages in the book context, cross refs, and the question', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(ctxFull);
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('John the Apostle');
    expect(joined).toContain('psa 23:1');
    expect(joined).toContain('What does shepherd mean here?');
  });
});

describe('STUDY_CHAT_PROMPT — library voices and lexicon (slice 1c)', () => {
  it('renders each excerpt labelled [sourceLabel · heading]', () => {
    const grounding = STUDY_CHAT_PROMPT.buildMessages(baseCtx({ libraryExcerpts: EXCERPTS }))[0].content;
    expect(grounding).toContain("Voices from the church's study:");
    expect(grounding).toContain('[The Treasury of David · Charles H. Spurgeon, 1869–1885 · Psalm 27:4 [2]]');
    expect(grounding).toContain('One thing — the unity of desire.');
    expect(grounding).toContain('[Jamieson-Fausset-Brown · Robert Jamieson, 1871 · Psalm 27:4]');
  });

  it('renders the lexicon block with lemma, transliteration, language and gloss', () => {
    const grounding = STUDY_CHAT_PROMPT.buildMessages(baseCtx({ lexiconEntries: LEXICON }))[0].content;
    expect(grounding).toContain('Lexicon entries');
    expect(grounding).toContain('H216');
    expect(grounding).toContain('אוֹר');
    expect(grounding).toContain('or');
    expect(grounding).toContain('illumination');
    expect(grounding).toContain('Hebrew');
  });

  it('omits both blocks entirely when empty or undefined (no empty headers)', () => {
    for (const ctx of [baseCtx(), baseCtx({ libraryExcerpts: [], lexiconEntries: [] })]) {
      const grounding = STUDY_CHAT_PROMPT.buildMessages(ctx)[0].content;
      expect(grounding).not.toContain('Voices');
      expect(grounding).not.toContain('Lexicon');
    }
  });

  it('renders identically to the pre-1c prompt when no library is supplied', () => {
    // The journaling-chat context shape (no library fields) must produce the
    // same grounding block as an explicitly-empty one.
    const withoutFields = STUDY_CHAT_PROMPT.buildMessages(baseCtx())[0].content;
    const withEmpty = STUDY_CHAT_PROMPT.buildMessages(baseCtx({ libraryExcerpts: [], lexiconEntries: [] }))[0].content;
    expect(withoutFields).toBe(withEmpty);
  });

  it('instructs the model to name a voice in prose and never invent one', () => {
    const system = STUDY_CHAT_PROMPT.system;
    expect(system).toMatch(/name (it|them|the voice)/i);
    expect(system).toMatch(/never (invent|attribute)/i);
    expect(system).toMatch(/disagree/i);
  });

  it('drops the unconditional "no lexicon supplied" hedge but keeps a conditional one', () => {
    const system = STUDY_CHAT_PROMPT.system;
    expect(system).not.toContain('No lexicon entries are supplied in this context');
    expect(system).toMatch(/lexicon/i);
    expect(system).toMatch(/when no lexicon/i);
  });

  it('restates that citations come only from the supplied refs, not from the voices', () => {
    expect(STUDY_CHAT_PROMPT.system).toMatch(/voices .*(are not|never).*citable|do not (widen|extend|expand)/i);
  });
});
