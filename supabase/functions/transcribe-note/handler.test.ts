// supabase/functions/transcribe-note/handler.test.ts
import { describe, it, expect } from 'vitest';
import { handleTranscribe } from './handler.ts';

const goodLLM = {
  generate: async () => ({
    parsed: {
      transcription: 'Trusting in Psalm 23:1 today',
      confidence: 0.82,
      uncertainWords: [{ text: 'Trusting', context: 'Trusting in Psalm' }],
    },
    modelUsed: 'gpt-5.6-terra',
    promptTokens: 100,
    completionTokens: 20,
  }),
};

function deps(over: Partial<Parameters<typeof handleTranscribe>[0]> = {}) {
  const inserted: any[] = [];
  return {
    inserted,
    d: {
      llm: goodLLM,
      downloadImage: async () => ({ base64: 'AAAA', mimeType: 'image/jpeg' }),
      verifyVerseRefs: async (_sb: unknown, refs: string[]) =>
        refs.map((ref) => ({ ref, status: 'found' as const, canonicalText: 'The LORD is my shepherd' })),
      extractVerseRefs: (t: string) => (t.includes('Psalm 23:1') ? ['Psalm 23:1'] : []),
      insertRow: async (row: any) => { inserted.push(row); return 'tx-1'; },
      recordUsage: async () => {},
      supabase: {},
      ...over,
    },
  };
}

describe('handleTranscribe', () => {
  it('rejects an image_key not under the caller folder', async () => {
    const { d } = deps();
    const res = await handleTranscribe(d as never, { image_key: 'note-scans/u2/x.jpg' }, 'u1');
    expect(res.status).toBe(403);
  });

  it('rejects a bad payload (missing image_key)', async () => {
    const { d } = deps();
    const res = await handleTranscribe(d as never, {} as never, 'u1');
    expect(res.status).toBe(400);
  });

  it('returns 401 when userId is empty', async () => {
    const { d } = deps();
    const res = await handleTranscribe(d as never, { image_key: 'note-scans//x.jpg' }, '');
    expect(res.status).toBe(401);
  });

  it('returns transcription + verse flags and inserts a row scoped to the JWT user', async () => {
    const { d, inserted } = deps();
    const res = await handleTranscribe(d as never, { image_key: 'note-scans/u1/x.jpg' }, 'u1');
    expect(res.status).toBe(200);
    expect(res.body.transcription).toBe('Trusting in Psalm 23:1 today');
    expect(res.body.confidence).toBe(0.82);
    expect(res.body.verseFlags).toEqual([
      { ref: 'Psalm 23:1', status: 'found', canonicalText: 'The LORD is my shepherd' },
    ]);
    expect(res.body.transcription_id).toBe('tx-1');
    expect(inserted[0]).toMatchObject({ user_id: 'u1', image_key: 'note-scans/u1/x.jpg', status: 'transcribed' });
  });

  it('degrades to empty verseFlags when verification throws', async () => {
    const { d } = deps({ verifyVerseRefs: async () => { throw new Error('db down'); } });
    const res = await handleTranscribe(d as never, { image_key: 'note-scans/u1/x.jpg' }, 'u1');
    expect(res.status).toBe(200);
    expect(res.body.verseFlags).toEqual([]);
  });

  it('rejects a path-traversal image_key', async () => {
    const { d } = deps();
    const res = await handleTranscribe(d as never, { image_key: 'note-scans/u1/../u2/x.jpg' }, 'u1');
    expect(res.status).toBe(403);
  });

  it('attributes the usage row to the JWT userId', async () => {
    const calls: any[] = [];
    const { d } = deps({ recordUsage: async (row: any) => { calls.push(row); } });
    await handleTranscribe(d as never, { image_key: 'note-scans/u1/x.jpg' }, 'u1');
    expect(calls.some((c) => c.user_id === 'u1' && c.status === 'ok')).toBe(true);
  });

  it('returns 502 and logs an error when the LLM throws', async () => {
    const calls: any[] = [];
    const { d } = deps({
      llm: { generate: async () => { throw new Error('timeout'); } },
      recordUsage: async (row: any) => { calls.push(row); },
    });
    const res = await handleTranscribe(d as never, { image_key: 'note-scans/u1/x.jpg' }, 'u1');
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.status === 'error')).toBe(true);
  });
});
