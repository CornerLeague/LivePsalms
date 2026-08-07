import { describe, it, expect, vi } from 'vitest';
import {
  runPassageInsightPipeline,
  runPassageInsightStreaming,
  type PassageInsightEmit,
} from './passage-insight-pipeline.ts';
import {
  PASSAGE_DOOR_SPEC,
  PASSAGE_INSIGHT_PROMPT,
  PASSAGE_INSIGHT_SECTIONS,
} from './prompts/passage-insight.ts';
import { buildInsightTool, type InsightDoorSpec } from './prompts/insight-door.ts';
import type { BibleChatContext } from '../lamplight-chat/bible-chat-pipeline.ts';
import type { LLMAdapter } from '../_shared/openai.ts';
import type { ScriptureDeps } from '../_shared/scripture-verify.ts';

const baseCtx: BibleChatContext = {
  passageRef: 'psa 27',
  passageText: '1 The LORD is my light and my salvation; whom shall I fear? 4 One thing I have asked of the LORD.',
  crossRefs: [{ ref: 'isa 40:31', text: 'They will renew their strength.' }],
  notes: [],
  history: [],
  userMessage: '',
  allowedNoteIds: new Set<string>(),
  allowedVerseRefs: new Set(['psa 27:1', 'psa 27:4', 'isa 40:31']),
  bookContext: {
    book: 'Psalms', author: 'David and others', authorNote: 'multiple authors',
    dateLabel: '~1000–400 BC', region: 'Israel', culturalContext: 'Temple worship',
    genre: 'Poetry', summary: 'The songbook of Israel.',
  },
};

/** A clean four-section emit; individual tests override single fields. */
function emit(over: Partial<PassageInsightEmit> = {}): PassageInsightEmit {
  return {
    overview: 'David opens by naming the LORD his light and his salvation.',
    in_chapter: 'The confidence of the opening verses gives way to petition.',
    chapter_shape: 'The psalm turns at verse 7 from declaration to plea.',
    reflection: 'The one thing asked for is presence, not rescue.',
    citations: [{ type: 'verse', ref: 'psa 27:1' }],
    ...over,
  };
}

function fakeLLM(...replies: unknown[]): LLMAdapter {
  const generate = vi.fn();
  for (const r of replies) {
    generate.mockResolvedValueOnce({
      parsed: r, modelUsed: 'gpt-5.6-terra', promptTokens: 900, completionTokens: 1400,
    });
  }
  // Every later attempt repeats the last reply, so a retry that never improves
  // still terminates.
  generate.mockResolvedValue({
    parsed: replies.at(-1), modelUsed: 'gpt-5.6-terra', promptTokens: 900, completionTokens: 1400,
  });
  return { generate } as unknown as LLMAdapter;
}

describe('runPassageInsightPipeline — the four-field emit', () => {
  it('returns all four sections, keyed as the prompt declares them', async () => {
    const out = await runPassageInsightPipeline({ llm: fakeLLM(emit()), ctx: baseCtx });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out.sections)).toEqual(PASSAGE_INSIGHT_SECTIONS.map((s) => s.key));
    expect(out.sections.overview).toContain('light and his salvation');
    expect(out.sections.reflection).toContain('presence, not rescue');
    expect(out.citations).toEqual([{ type: 'verse', ref: 'psa 27:1' }]);
    expect(out.promptVersion).toBe(PASSAGE_INSIGHT_PROMPT.promptVersion);
    expect(out.usage?.status).toBe('ok');
  });

  it('grounds on the study context — one turn, carrying the supplied apparatus', async () => {
    const llm = fakeLLM(emit());
    await runPassageInsightPipeline({ llm, ctx: baseCtx });

    const call = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].content).toContain('psa 27');
    expect(call.messages[0].content).toContain('Book context for Psalms');
    expect(call.messages[0].content).toContain('isa 40:31');
    expect(call.tool.name).toBe('emit_passage_insight');
  });

  it('preserves an empty section as empty rather than defaulting it to filler', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ chapter_shape: '' })),
      ctx: baseCtx,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Present and empty — not missing, not a placeholder, not an apology.
    expect(out.sections.chapter_shape).toBe('');
    expect(out.sections.overview.length).toBeGreaterThan(0);
  });

  it('treats a section the model omits entirely as empty, not undefined', async () => {
    const partial = emit();
    delete (partial as Record<string, unknown>).reflection;
    const out = await runPassageInsightPipeline({ llm: fakeLLM(partial), ctx: baseCtx });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.reflection).toBe('');
  });
});

describe('runPassageInsightPipeline — the validator stack', () => {
  it('rejects a citation outside the allowlist, and retries once first', async () => {
    const llm = fakeLLM(emit({ citations: [{ type: 'verse', ref: 'gen 1:1' }] }));
    const out = await runPassageInsightPipeline({ llm, ctx: baseCtx });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('validators_failed');
    expect((llm.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('accepts a verse RANGE whose every verse was supplied', async () => {
    // #114: a section describing a chapter's movement cites spans constantly.
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ citations: [{ type: 'verse', ref: 'psa 27:1-4' }] })),
      ctx: { ...baseCtx, allowedVerseRefs: new Set(['psa 27:1', 'psa 27:2', 'psa 27:3', 'psa 27:4']) },
    });
    expect(out.ok).toBe(true);
  });

  it('runs content rules over every section, not just the first', async () => {
    // A banned phrase in the LAST section must fail the door: flattening that
    // stopped at the overview would let three quarters of it through unchecked.
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ reflection: 'God is telling you that today is your breakthrough.' })),
      ctx: baseCtx,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.content.some((v) => v.family === 'banned')).toBe(true);
  });

  it('KEEPS the contested-passage rejection — Door 1 takes no exemption', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ in_chapter: 'Compare the argument of rom 9:16 about the will of God.' })),
      ctx: baseCtx,
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.content.some((v) => v.family === 'contested')).toBe(true);
    expect(PASSAGE_INSIGHT_PROMPT.allowContestedRefs).toBeUndefined();
  });

  it('carries its violations on validators_failed — the #114 lesson, applied at birth', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ citations: [{ type: 'verse', ref: 'gen 1:1' }] })),
      ctx: baseCtx,
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    // A caller must be able to see WHY without going back to the model.
    expect(out.violations.citation).toHaveLength(1);
    expect(out.violations.citation[0].reason).toBe('unknown_verse');
    expect(out.violations.citation[0].detail).toContain('gen 1:1');
    expect(out.usage?.error_code).toBe('validators_failed');
  });

  it('feeds the previous attempt’s violations into a stricter retry', async () => {
    const llm = fakeLLM(
      emit({ citations: [{ type: 'verse', ref: 'gen 1:1' }] }),
      emit(),
    );
    const out = await runPassageInsightPipeline({ llm, ctx: baseCtx });

    expect(out.ok).toBe(true);
    const [first, second] = (llm.generate as ReturnType<typeof vi.fn>).mock.calls;
    expect(second[0].system.length).toBeGreaterThan(first[0].system.length);
    // Matched on the stricter SUFFIX, not the word "citations": the artifact
    // system already asks for the array, so a looser pattern matches attempt 1.
    expect(second[0].system).toContain('spelled exactly as supplied');
    expect(first[0].system).not.toContain('spelled exactly as supplied');
  });

  it('runs the Layer C classifier over the door’s prose', async () => {
    const classifier = vi.fn().mockResolvedValue([]);
    await runPassageInsightPipeline({ llm: fakeLLM(emit()), ctx: baseCtx, classifier });

    expect(classifier).toHaveBeenCalledTimes(1);
    const seen = classifier.mock.calls[0][0] as string;
    for (const s of PASSAGE_INSIGHT_SECTIONS) {
      const body = emit()[s.key];
      expect(seen).toContain(body as string);
    }
  });
});

describe('runPassageInsightPipeline — Scripture verification', () => {
  // A near-miss quote of psa 27:4 — one word wrong — is repaired, not rejected.
  // Verse 4 rather than verse 1 deliberately: verse 1 of a psalm runs through
  // the superscription-stripping branch, which is not what this is testing.
  const CANONICAL = 'One thing I have asked of the LORD, this is what I seek.';
  const MISQUOTE = 'He writes, "One thing I have sought of the LORD, this is what I seek." (Psalm 27:4)';

  function scriptureDeps(): ScriptureDeps {
    return {
      translation: 'BSB',
      verifyRefs: async (refs) => refs.map((ref) => ({ ref, status: 'found' as const, canonicalText: CANONICAL })),
    };
  }

  it('repairs a near-miss quote in place rather than failing the door', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ overview: MISQUOTE })),
      ctx: baseCtx,
      verifyScripture: scriptureDeps(),
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.overview).toContain('I have asked of the LORD');
    expect(out.sections.overview).not.toContain('I have sought of the LORD');
    // Repaired in the section it came from — the other three are untouched.
    expect(out.sections.in_chapter).toBe(emit().in_chapter);
  });

  it('verifies each section separately, so a repair splices at the right offset', async () => {
    // Flattening first and repairing the join would write the fix into the
    // wrong section, or into no section at all.
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ reflection: MISQUOTE })),
      ctx: baseCtx,
      verifyScripture: scriptureDeps(),
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections.reflection).toContain('I have asked of the LORD');
    expect(out.sections.overview).toBe(emit().overview);
  });

  it('fails the door on a quote that is not a near-miss', async () => {
    const fabricated = 'He writes, "Behold I make the desert bloom with rivers of gladness" (Psalm 27:4)';
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ overview: fabricated })),
      ctx: baseCtx,
      verifyScripture: scriptureDeps(),
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.content.some((v) => v.family === 'scripture')).toBe(true);
  });

  it('is optional — a door generates without it, exactly as before', async () => {
    const out = await runPassageInsightPipeline({ llm: fakeLLM(emit({ overview: MISQUOTE })), ctx: baseCtx });
    expect(out.ok).toBe(true);
  });
});

// ── Door-genericity (B3) ─────────────────────────────────────────────────────
// The pipeline is the SHARED engine, not Door 1's. It reads the section list and
// the prompt from the spec it is handed, so a second door needs no second
// pipeline. These tests drive it with a spec that is deliberately nothing like
// Door 1's — different keys, different count — because a pipeline that silently
// falls back to Door 1's four sections would pass every Door 1 test ever written.
describe('runPassageInsightPipeline — door-generic', () => {
  const FAKE_SECTIONS = [
    { key: 'alpha', label: 'Alpha', minWords: 10, maxWords: 40, brief: 'the first thing' },
    { key: 'beta', label: 'Beta', minWords: 10, maxWords: 40, brief: 'the second thing' },
  ] as const;

  const FAKE_DOOR: InsightDoorSpec = {
    id: 'fake',
    sections: FAKE_SECTIONS,
    prompt: {
      promptVersion: 'fake-door-v9',
      system: 'You are a fake door.',
      tool: buildInsightTool({ name: 'emit_fake', description: 'fake', sections: FAKE_SECTIONS }),
      buildMessages: () => [{ role: 'user' as const, content: 'grounding' }],
    },
  };

  it('returns the spec’s sections, not Door 1’s', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM({ alpha: 'first body', beta: 'second body', citations: [] }),
      ctx: baseCtx,
      door: FAKE_DOOR,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out.sections)).toEqual(['alpha', 'beta']);
    // The load-bearing half: no leakage the other way either.
    expect(out.sections).not.toHaveProperty('overview');
    expect(out.promptVersion).toBe('fake-door-v9');
  });

  it('sends the spec’s system prompt and tool to the model', async () => {
    const llm = fakeLLM({ alpha: 'a', beta: 'b', citations: [] });
    await runPassageInsightPipeline({ llm, ctx: baseCtx, door: FAKE_DOOR });

    const call = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // `artifactSystem` is composed into `system` by generateWithRetry, so assert
    // on what the model is actually sent.
    expect(call.system).toContain('You are a fake door.');
    expect(call.system).not.toContain('Lamplight Study, writing a short study');
    expect(call.tool.name).toBe('emit_fake');
  });

  it('streams the spec’s section keys as text fields', async () => {
    const parsed = { alpha: 'first body', beta: 'second body', citations: [] };
    const streamingLLM = {
      generate: vi.fn(),
      generateStream: vi.fn(async (input: { textFields?: string[] }, handlers: {
        onText?: (f: string, d: string) => void;
      }) => {
        // Echo back exactly the fields the caller declared — so the assertion
        // below is about what the SPEC asked to stream, not what a fake decided.
        for (const f of input.textFields ?? []) {
          handlers.onText?.(f, (parsed as Record<string, unknown>)[f] as string);
        }
        return { parsed, modelUsed: 'gpt-5.6-terra', promptTokens: 900, completionTokens: 1400 };
      }),
    } as unknown as LLMAdapter;

    const fields: string[] = [];
    await runPassageInsightStreaming(
      { llm: streamingLLM, ctx: baseCtx, door: FAKE_DOOR },
      {
        onStage: () => {},
        onText: (field) => { fields.push(field); },
        onPiece: () => {},
        onRefining: () => {},
      },
    );
    expect(fields).toEqual(['alpha', 'beta']);
  });

  it('Door 1’s spec still describes Door 1', () => {
    expect(PASSAGE_DOOR_SPEC.id).toBe('passage');
    expect(PASSAGE_DOOR_SPEC.sections).toBe(PASSAGE_INSIGHT_SECTIONS);
    expect(PASSAGE_DOOR_SPEC.prompt).toBe(PASSAGE_INSIGHT_PROMPT);
  });
});
