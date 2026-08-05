// supabase/functions/etymology-insight/insight-body.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildEtymologyInsightOutcome, type EtymologyInsightBodyDeps } from './insight-body';

function makeDeps(over: Partial<EtymologyInsightBodyDeps> = {}): EtymologyInsightBodyDeps {
  return {
    loadExistingInsight: async () => null,
    loadEntry: async () => ({ lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend', development: 'grew from tending', related: [] }),
    loadVerseText: async () => ({ reference: 'Psalm 23:1', text: 'The LORD is my shepherd…' }),
    generate: async () => ({ body: 'Grounded insight.', modelUsed: 'gpt-5.6-sol', promptTokens: 100, completionTokens: 20 }),
    insertInsight: async () => {},
    reloadInsight: async () => 'Grounded insight.',
    ...over,
  };
}
const args = { strongs: 'H7462', verseId: 'psa.23.1', userId: 'u1' };

describe('buildEtymologyInsightOutcome', () => {
  it('returns a cache hit with NO usage when an insight already exists', async () => {
    const generate = vi.fn();
    const out = await buildEtymologyInsightOutcome(makeDeps({ loadExistingInsight: async () => 'Already here.', generate }), args);
    expect(out).toEqual({ response: { ok: true, body: 'Already here.', cached: true }, usage: null });
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns no_entry with NO usage when the word has no reviewed entry', async () => {
    const out = await buildEtymologyInsightOutcome(makeDeps({ loadEntry: async () => null }), args);
    expect(out).toEqual({ response: { ok: false, reason: 'no_entry' }, usage: null });
  });

  it('on model failure inserts NOTHING, spends NO quota (usage null), and logs the failure', async () => {
    const insertInsight = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await buildEtymologyInsightOutcome(
      makeDeps({ generate: async () => { throw new Error('model 500'); }, insertInsight }),
      args,
    );
    expect(out).toEqual({ response: { ok: false, reason: 'generation_failed' }, usage: null });
    expect(insertInsight).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a body violating content rules is NEVER inserted into the shared cache (validators_failed, usage null)', async () => {
    const insertInsight = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await buildEtymologyInsightOutcome(
      makeDeps({
        generate: async () => ({
          body: 'God is telling you to tend the flock this week.',
          modelUsed: 'gpt-5.6-sol', promptTokens: 100, completionTokens: 20,
        }),
        insertInsight,
      }),
      args,
    );
    expect(out).toEqual({ response: { ok: false, reason: 'validators_failed' }, usage: null });
    expect(insertInsight).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('on success inserts once and records ok usage (cached:false)', async () => {
    const insertInsight = vi.fn();
    const out = await buildEtymologyInsightOutcome(makeDeps({ insertInsight }), args);
    expect(insertInsight).toHaveBeenCalledTimes(1);
    expect(out.response).toEqual({ ok: true, body: 'Grounded insight.', cached: false });
    expect(out.usage).toEqual({ model: 'gpt-5.6-sol', tokens_in: 100, tokens_out: 20, status: 'ok' });
  });

  it('a concurrency loser reads the winner row and reports cached:true', async () => {
    const out = await buildEtymologyInsightOutcome(
      makeDeps({ reloadInsight: async () => 'Winner insight.' }), // != our generated body
      args,
    );
    expect(out.response).toEqual({ ok: true, body: 'Winner insight.', cached: true });
  });
});

// ── Slice 1d: Scripture verification before the shared-cache insert ──────────
// The insight cache is GLOBAL — one bad row is served to every user who opens
// that word. Verification extends the Phase-0 content-rules gate rather than
// adding a second one, and keeps the same contract: no row, no usage, no quota.

const PS27_4 = 'One thing I have asked of the LORD; this is what I desire.';

function etymScripture(opts: { throws?: boolean } = {}) {
  return {
    translation: 'BSB',
    verifyRefs: async (refs: string[]) => {
      if (opts.throws) throw new Error('lookup down');
      return refs.map((ref) => ref === 'Psalm 27:4'
        ? { ref, status: 'found' as const, canonicalText: PS27_4 }
        : { ref, status: 'not_found' as const });
    },
  };
}

describe('etymology insight — Scripture verification', () => {
  it('repairs a near-miss quotation before caching it globally', async () => {
    let cached = '';
    const out = await buildEtymologyInsightOutcome(
      makeDeps({
        generate: async () => ({
          body: `The verb sits under "One thing I have asked of the LORD; this is what I seek." (Psalm 27:4)`,
          modelUsed: 'm', promptTokens: 1, completionTokens: 2,
        }),
        insertInsight: async (row) => { cached = row.body; },
        reloadInsight: async () => cached,
        verifyScripture: etymScripture(),
      } as Partial<EtymologyInsightBodyDeps>),
      args,
    );
    expect(out.response).toMatchObject({ ok: true });
    expect(cached).toContain(PS27_4);
    expect(cached).not.toContain('this is what I seek');
  });

  it('never caches a body with a fabricated quotation', async () => {
    let inserted = false;
    const out = await buildEtymologyInsightOutcome(
      makeDeps({
        generate: async () => ({
          body: `The word appears in "in the beginning God created the heavens and earth" (Psalm 27:4)`,
          modelUsed: 'm', promptTokens: 1, completionTokens: 2,
        }),
        insertInsight: async () => { inserted = true; },
        verifyScripture: etymScripture(),
      } as Partial<EtymologyInsightBodyDeps>),
      args,
    );
    expect(out.response).toEqual({ ok: false, reason: 'validators_failed' });
    expect(out.usage).toBeNull();
    expect(inserted).toBe(false);
  });

  it('caches normally when no verification dep is injected', async () => {
    let inserted = false;
    const out = await buildEtymologyInsightOutcome(
      makeDeps({
        generate: async () => ({ body: 'A plain descriptive line.', modelUsed: 'm', promptTokens: 1, completionTokens: 2 }),
        insertInsight: async () => { inserted = true; },
        reloadInsight: async () => 'A plain descriptive line.',
      }),
      args,
    );
    expect(out.response).toMatchObject({ ok: true });
    expect(inserted).toBe(true);
  });

  it('caches normally when the verse lookup throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let inserted = false;
    const out = await buildEtymologyInsightOutcome(
      makeDeps({
        generate: async () => ({ body: 'A plain descriptive line.', modelUsed: 'm', promptTokens: 1, completionTokens: 2 }),
        insertInsight: async () => { inserted = true; },
        reloadInsight: async () => 'A plain descriptive line.',
        verifyScripture: etymScripture({ throws: true }),
      } as Partial<EtymologyInsightBodyDeps>),
      args,
    );
    expect(out.response).toMatchObject({ ok: true });
    expect(inserted).toBe(true);
    err.mockRestore();
  });
});
