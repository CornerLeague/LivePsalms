import { describe, it, expect } from 'vitest';
import { buildChatContext } from './chat-context.ts';
import type { VoyageDeps } from '../_shared/voyage.ts';

interface QueryOp { method: string; args: unknown[] }

// Chainable Supabase fake, same shape as study-context.test.ts's.
function makeSupabase(handlers: {
  table: (name: string, ops: QueryOp[]) => unknown;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
}) {
  const from = (name: string) => {
    const ops: QueryOp[] = [];
    const settle = () => ({ data: handlers.table(name, ops) ?? null, error: null });
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(settle()).then(res, rej),
      maybeSingle: () => Promise.resolve(settle()),
    };
    for (const m of ['select', 'eq', 'like', 'in', 'order', 'limit']) {
      chain[m] = (...args: unknown[]) => { ops.push({ method: m, args }); return chain; };
    }
    return chain;
  };
  return {
    from,
    rpc: (name: string, args: Record<string, unknown>) =>
      Promise.resolve({ data: handlers.rpc?.(name, args) ?? [], error: null }),
  } as never;
}

function makeVoyage(): VoyageDeps {
  const fetchImpl = (async (url: string) => {
    if (String(url).includes('rerank')) return { ok: true, json: async () => ({ data: [] }) };
    return {
      ok: true,
      json: async () => ({ data: [{ data: [{ embedding: [0.5, 0.5], index: 0 }], index: 0 }], usage: {} }),
    };
  }) as unknown as typeof fetch;
  return { apiKey: 'k', fetch: fetchImpl };
}

const CHAPTER_ROWS = [
  { id: 'psa.27.1', book: 'psa', chapter: 27, verse_start: 1, verse_end: 1, text: 'The LORD is my light and my salvation.' },
  { id: 'psa.27.4', book: 'psa', chapter: 27, verse_start: 4, verse_end: 4, text: 'One thing I have asked of the LORD.' },
];

const XREF_ROW = { id: 'isa.40.31', book: 'isa', chapter: 40, verse_start: 31, verse_end: 31, text: 'They will renew their strength.' };

function tables(over: Record<string, unknown> = {}) {
  return (name: string, ops: QueryOp[]) => {
    if (name in over) return over[name];
    switch (name) {
      case 'bible_passages':
        // The chapter browse uses .like; fetchPassageText uses .in on ids.
        return ops.some((o) => o.method === 'like') ? CHAPTER_ROWS : [XREF_ROW];
      case 'notes':
        return [{ id: 'n1', title: 'On waiting', content: 'I have been weary lately.' }];
      default:
        return [];
    }
  };
}

function args(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1', book: 'psa', chapter: 27, passageRef: 'psa.27',
    message: 'What does it mean to wait on the LORD?',
    retrievalQuery: 'waiting on the LORD',
    history: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
    voyageDeps: makeVoyage(), rerankEnabled: false,
    ...over,
  };
}

const rpc = (name: string) =>
  name === 'match_user_note_embeddings' ? [{ source_id: 'n1', similarity: 0.9 }]
    : name === 'match_bible_embeddings' ? [{ source_id: 'isa.40.31', similarity: 0.8 }]
      : [];

describe('buildChatContext', () => {
  it('assembles the chapter, the reader’s notes, and the retrieved cross-references', async () => {
    const { passageText, notes, crossRefs } = await buildChatContext(
      makeSupabase({ table: tables(), rpc }), args(),
    );
    expect(passageText).toContain('The LORD is my light');
    expect(notes.map((n) => n.id)).toEqual(['n1']);
    expect(crossRefs).toHaveLength(1);
  });

  it('drops a note whose body is empty rather than sending a blank one', async () => {
    const { notes } = await buildChatContext(
      makeSupabase({ table: tables({ notes: [{ id: 'n1', title: 'Blank', content: '' }] }), rpc }),
      args(),
    );
    expect(notes).toEqual([]);
  });

  it('allows exactly the verses it supplied, and nothing else', async () => {
    const { allowedVerseRefs } = await buildChatContext(
      makeSupabase({ table: tables(), rpc }), args(),
    );
    expect(allowedVerseRefs.has('psa 27:1')).toBe(true);
    expect(allowedVerseRefs.has('isa 40:31')).toBe(true);
    expect(allowedVerseRefs.has('rom 8:28')).toBe(false);
  });
});

describe('buildChatContext — displayRefs', () => {
  // The third surface caught doing this. bible_passages.book holds the OSIS
  // CODE, so the un-flagged builder hands the model "psa 27:4" and the model
  // prints it straight back at the reader.
  it('renders reader-facing book names in the cross-references', async () => {
    const { crossRefs } = await buildChatContext(
      makeSupabase({ table: tables(), rpc }), args({ displayRefs: true }),
    );
    expect(crossRefs.map((c) => c.ref)).toEqual(['Isaiah 40:31']);
  });

  it('LOAD-BEARING: moves the passage HEADER too — the model generalises from it', async () => {
    const { passageRef } = await buildChatContext(
      makeSupabase({ table: tables(), rpc }), args({ displayRefs: true }),
    );
    expect(passageRef).toBe('Psalms 27');
  });

  it('LOAD-BEARING: moves the ALLOWLIST to the same form, or every citation fails', async () => {
    const { allowedVerseRefs } = await buildChatContext(
      makeSupabase({ table: tables(), rpc }), args({ displayRefs: true }),
    );
    expect(allowedVerseRefs.has('Psalms 27:1')).toBe(true);
    expect(allowedVerseRefs.has('Isaiah 40:31')).toBe(true);
    expect(allowedVerseRefs.has('psa 27:1')).toBe(false);
  });

  it('LOAD-BEARING: keeps the allowlist in DISPLAY CASE, because the prompt shows it to the model', async () => {
    // BIBLE_CHAT_PROMPT renders this set verbatim ("verses MUST be one of: …"),
    // so the model cites back exactly the casing it is shown — and the client's
    // humanizeRef only expands the 3-letter OSIS form, passing anything else
    // through. A lowercased allowlist put "psalms 13:1" on a citation chip,
    // which is worse than the "psa 13:1" it replaced. Caught by the first
    // journaling-chat eval sweep.
    const { allowedVerseRefs } = await buildChatContext(
      makeSupabase({ table: tables(), rpc }), args({ displayRefs: true }),
    );
    expect([...allowedVerseRefs].every((r) => r === r.toLowerCase())).toBe(false);
  });

  it('keeps the allowlist and the rendered grounding BYTE-identical, either way', async () => {
    // Stronger than "same form": a ref shown in the grounding must be in the
    // allowlist exactly as written, because this prompt renders the allowlist
    // to the model and the model copies what it sees.
    for (const displayRefs of [true, false]) {
      const ctx = await buildChatContext(
        makeSupabase({ table: tables(), rpc }), args({ displayRefs }),
      );
      for (const c of ctx.crossRefs) {
        expect(ctx.allowedVerseRefs.has(c.ref)).toBe(true);
      }
    }
  });

  it('is OFF by default, so a caller that does not ask is unchanged', async () => {
    const ctx = await buildChatContext(makeSupabase({ table: tables(), rpc }), args());
    expect(ctx.passageRef).toBe('psa 27');
    expect(ctx.crossRefs.map((c) => c.ref)).toEqual(['isa 40:31']);
  });
});
