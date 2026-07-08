// supabase/functions/etymology-insight/insight-body.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildEtymologyInsightOutcome, type EtymologyInsightBodyDeps } from './insight-body';

function makeDeps(over: Partial<EtymologyInsightBodyDeps> = {}): EtymologyInsightBodyDeps {
  return {
    loadExistingInsight: async () => null,
    loadEntry: async () => ({ lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend', development: 'grew from tending', related: [] }),
    loadVerseText: async () => ({ reference: 'Psalm 23:1', text: 'The LORD is my shepherd…' }),
    generate: async () => ({ body: 'Grounded insight.', modelUsed: 'claude-opus-4-8', promptTokens: 100, completionTokens: 20 }),
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

  it('on model failure inserts NOTHING and spends NO quota (usage null)', async () => {
    const insertInsight = vi.fn();
    const out = await buildEtymologyInsightOutcome(
      makeDeps({ generate: async () => { throw new Error('model 500'); }, insertInsight }),
      args,
    );
    expect(out).toEqual({ response: { ok: false, reason: 'generation_failed' }, usage: null });
    expect(insertInsight).not.toHaveBeenCalled();
  });

  it('on success inserts once and records ok usage (cached:false)', async () => {
    const insertInsight = vi.fn();
    const out = await buildEtymologyInsightOutcome(makeDeps({ insertInsight }), args);
    expect(insertInsight).toHaveBeenCalledTimes(1);
    expect(out.response).toEqual({ ok: true, body: 'Grounded insight.', cached: false });
    expect(out.usage).toEqual({ model: 'claude-opus-4-8', tokens_in: 100, tokens_out: 20, status: 'ok' });
  });

  it('a concurrency loser reads the winner row and reports cached:true', async () => {
    const out = await buildEtymologyInsightOutcome(
      makeDeps({ reloadInsight: async () => 'Winner insight.' }), // != our generated body
      args,
    );
    expect(out.response).toEqual({ ok: true, body: 'Winner insight.', cached: true });
  });
});
