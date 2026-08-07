// Parent design §9, as a rule rather than a request.
//
// "Read With Care" may name an interpretive MOVE — context-stripping,
// etymology-as-meaning, genre errors, anachronism — and may never aim a caution
// at a tradition, a denomination, or a group. B3 makes that mechanical, because
// a prompt sentence is a request that usually works and §9 is a hard rule.
//
// The tests that matter most here are the NEGATIVE ones. A check that fires on
// everything is not a check, and the two ways this could go wrong in production
// are (a) it forbids in Theological Significance exactly what that section is
// required to do, and (b) it fires on the passage's own cast.
import { describe, it, expect, vi } from 'vitest';
import { runPassageInsightPipeline } from './passage-insight-pipeline.ts';
import { DEEPER_DOOR_SPEC, READ_WITH_CARE_KEY } from './prompts/deeper-insight.ts';
import { applySectionRules } from '../_shared/validators.ts';
import { TRADITION_TERMS } from '../_shared/voice.ts';
import type { BibleChatContext } from '../lamplight-chat/bible-chat-pipeline.ts';
import type { LLMAdapter } from '../_shared/openai.ts';

const ctx = {
  passageRef: 'Romans 9',
  passageText: '1 I speak the truth in Christ. 16 It does not depend on human desire or effort.',
  crossRefs: [],
  notes: [],
  history: [],
  userMessage: '',
  allowedNoteIds: new Set<string>(),
  allowedVerseRefs: new Set(['Romans 9:1']),
} as unknown as BibleChatContext;

function emit(over: Record<string, string> = {}) {
  return {
    hermeneutics: 'Paul is arguing, not narrating; the chapter is a sustained case rather than a series of maxims.',
    historical_setting: 'Written to a mixed congregation in Rome where Jewish and Gentile believers worshipped together.',
    theology: 'The passage bears on divine election and mercy.',
    read_with_care: 'The chapter is often quoted a verse at a time, apart from the argument that governs it.',
    citations: [],
    ...over,
  };
}

function fakeLLM(...replies: unknown[]): LLMAdapter {
  const generate = vi.fn();
  for (const r of replies) {
    generate.mockResolvedValueOnce({ parsed: r, modelUsed: 'gpt-5.6-terra', promptTokens: 900, completionTokens: 1400 });
  }
  generate.mockResolvedValue({ parsed: replies.at(-1), modelUsed: 'gpt-5.6-terra', promptTokens: 900, completionTokens: 1400 });
  return { generate } as unknown as LLMAdapter;
}

const traditionViolations = (out: Awaited<ReturnType<typeof runPassageInsightPipeline>>) =>
  out.ok ? [] : out.violations.content.filter((v) => v.rule === 'tradition_caution');

describe('§9 — Read With Care may not aim a caution at a group', () => {
  it('fails the door when the section names a denomination', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({
        read_with_care: 'Reformed readers press this chapter further than the argument allows.',
      })),
      ctx,
      door: DEEPER_DOOR_SPEC,
    });

    expect(out.ok).toBe(false);
    expect(traditionViolations(out)).toHaveLength(1);
  });

  it('accepts the same caution written about the MOVE instead of the people', async () => {
    // The rule is not "say less" — it is "say it about the text". This is the
    // sentence §9 wants, and it must pass.
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({
        read_with_care: 'The chapter is often pressed further than its argument allows, as though Paul were settling a question he raises only to answer with mercy.',
      })),
      ctx,
      door: DEEPER_DOOR_SPEC,
    });

    expect(out.ok).toBe(true);
  });

  it('does NOT fire on the same word in Theological Significance', async () => {
    // The load-bearing negative. That section is REQUIRED to name whose reading
    // it is giving; a door-wide check would forbid what the door demands.
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({
        theology: 'The Reformed tradition reads this as unconditional election, and Calvin presses the potter image hard.',
      })),
      ctx,
      door: DEEPER_DOOR_SPEC,
    });

    expect(out.ok).toBe(true);
  });

  it('does NOT fire on the passage’s own cast', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({
        read_with_care: 'The Pharisees and the circumcision party appear here as the letter’s own foils, not as a template for modern opponents.',
      })),
      ctx,
      door: DEEPER_DOOR_SPEC,
    });

    expect(out.ok).toBe(true);
  });

  it('does NOT fire on Door 1, which declares no section rules', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM({
        overview: 'Reformed and Wesleyan readers alike have prized this psalm.',
        in_chapter: 'a', chapter_shape: 'b', reflection: 'c', citations: [],
      }),
      ctx,
    });

    expect(out.ok).toBe(true);
  });

  it('an empty Read With Care is fine — omission beats a caution it cannot ground', async () => {
    const out = await runPassageInsightPipeline({
      llm: fakeLLM(emit({ [READ_WITH_CARE_KEY]: '' })),
      ctx,
      door: DEEPER_DOOR_SPEC,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sections[READ_WITH_CARE_KEY]).toBe('');
  });

  it('tells the model what it actually did wrong on retry', async () => {
    // A generic "do not use prophetic language" on a tradition violation asks
    // the model to fix something it never did, and wastes the one retry.
    const llm = fakeLLM(
      emit({ read_with_care: 'Baptist readings of this chapter overreach.' }),
      emit(),
    );
    await runPassageInsightPipeline({ llm, ctx, door: DEEPER_DOOR_SPEC });

    const retry = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(retry.system).toContain('must not name a tradition');
    expect(retry.system).toContain('leave the section empty');
  });
});

describe('TRADITION_TERMS — case sensitivity is doing real work', () => {
  const hits = (text: string) => applySectionRules(text, 'tradition_caution', TRADITION_TERMS);

  it('catches the capitalised movement names', () => {
    for (const name of ['Reformed', 'Catholic', 'Orthodox', 'Puritan', 'Evangelical']) {
      expect(hits(`This is a ${name} reading.`).length).toBeGreaterThan(0);
    }
  });

  it('leaves the ordinary lowercase English alone', () => {
    // Each of these is a real sentence someone might write about a passage, and
    // none of them aims a caution at anybody.
    expect(hits('The church reformed its practice over the following century.')).toHaveLength(0);
    expect(hits('The creed confesses one holy catholic and apostolic church.')).toHaveLength(0);
    expect(hits('The question is disputed among orthodox Christians.')).toHaveLength(0);
  });

  it('does not fire on a named voice the door is supposed to cite', () => {
    // `Calvin` and `Wesley` are voices in the corpus; `Calvinist` and `Wesleyan`
    // are traditions. The list must tell them apart or the attribution rule and
    // §9 would be in direct conflict.
    expect(hits('Calvin reads the potter image as a limit on the question itself.')).toHaveLength(0);
    expect(hits('Wesley notes the plain sense first.')).toHaveLength(0);
    expect(hits('Calvinist readers press it further.').length).toBeGreaterThan(0);
    expect(hits('Wesleyan readers press it further.').length).toBeGreaterThan(0);
  });

  it('tells John the Baptist apart from the denomination', () => {
    // Caught while writing this suite: a blanket /\bBaptist\b/ rejects a valid
    // Read With Care section on any Gospel passage that mentions him — which is
    // most of them. A rule that fails across four books is not a rule.
    expect(hits('John the Baptist preached repentance in the wilderness.')).toHaveLength(0);
    expect(hits('The disciples of John the Baptist asked about fasting.')).toHaveLength(0);
    expect(hits('The passage assumes the reader knows who the Baptist was.')).toHaveLength(0);

    // ...without letting the denomination through on the same word.
    expect(hits('Baptist readings of this chapter overreach.').length).toBeGreaterThan(0);
    expect(hits('Baptists have long read it this way.').length).toBeGreaterThan(0);
    expect(hits('The Baptist tradition presses this further than the text allows.').length).toBeGreaterThan(0);
  });

  it('catches group constructions that name no denomination', () => {
    expect(hits('Liberal scholars dismiss the passage.').length).toBeGreaterThan(0);
    expect(hits('Progressive Christians read it as metaphor.').length).toBeGreaterThan(0);
    expect(hits('Prosperity gospel preachers lean on this verse.').length).toBeGreaterThan(0);
  });

  it('reports the offending phrase, not just that something matched', () => {
    const [v] = hits('Pentecostal readings overreach here.');
    expect(v.family).toBe('banned');
    expect(v.rule).toBe('tradition_caution');
    expect(v.snippet).toContain('Pentecostal');
  });
});
