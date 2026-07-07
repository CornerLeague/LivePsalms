import { describe, it, expect } from 'vitest';
import { buildReflectionCandidates, type EdgeSupabase } from './reflection-candidates';
import type { MonthNote } from './prompts/monthly-reflection';

const NOTES: MonthNote[] = [
  { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' },
  { id: 'n2', day: '2026-05-27', text: 'Early walk, the psalm open again.' },
];

// A thenable query stub whose eq/gte/lt all return itself and resolve to rows.
function query(rows: unknown[]) {
  const q = {
    eq: () => q, gte: () => q, lt: () => q,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return q;
}
function makeSupabase(opts: {
  transcriptions?: unknown[]; highlights?: unknown[]; threads?: unknown[];
  focusItems?: unknown[]; matches?: unknown[];
}): EdgeSupabase {
  const byTable: Record<string, unknown[]> = {
    note_transcriptions: opts.transcriptions ?? [],
    bible_highlights: opts.highlights ?? [],
    lamplight_chat_threads: opts.threads ?? [],
    scripture_focus_list_items: opts.focusItems ?? [],
  };
  return {
    from: (table: string) => ({ select: () => query(byTable[table] ?? []) }),
    rpc: () => Promise.resolve({ data: opts.matches ?? [], error: null }),
  } as unknown as EdgeSupabase;
}

const deps = (supabase: EdgeSupabase) => ({
  supabase, userId: 'u1', notes: NOTES,
  monthStartUtc: '2026-05-01T00:00:00Z', monthEndUtc: '2026-06-01T00:00:00Z',
  embed: async () => new Array(512).fill(0) as number[],
  toLocalDay: (ts: string) => ts.slice(0, 10),
});

describe('buildReflectionCandidates', () => {
  it('normalizes a flagged DISPLAY ref to the short form and tags its note day', async () => {
    const supabase = makeSupabase({
      transcriptions: [{ verse_flags: [{ ref: 'Psalm 23:1', status: 'found' }], created_at: '2026-05-12T09:00:00Z' }],
    });
    const { candidates, allowedVerseRefs, allowedNoteDays } = await buildReflectionCandidates(deps(supabase));
    expect(candidates).toContainEqual({ ref: 'Ps 23:1', provenance: 'flagged', note_day: '2026-05-12' });
    expect(allowedVerseRefs.has('Ps 23:1')).toBe(true);
    expect([...allowedNoteDays]).toEqual(['2026-05-12', '2026-05-27']); // from notes, not sources
  });

  it('drops a not_found flag and an unparseable ref', async () => {
    const supabase = makeSupabase({
      transcriptions: [{ verse_flags: [
        { ref: 'Psalm 23:1', status: 'not_found' },
        { ref: 'not a reference', status: 'found' },
      ], created_at: '2026-05-12T09:00:00Z' }],
    });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    expect(candidates).toHaveLength(0);
  });

  it('renders each source format (highlight/thread/focus range) to display refs', async () => {
    const supabase = makeSupabase({
      highlights: [{ verse_id: 'jhn.1.1', created_at: '2026-05-12T09:00:00Z' }],
      threads: [{ passage_ref: 'jhn.10', created_at: '2026-05-27T09:00:00Z' }],
      focusItems: [{ book: 'eph', chapter: 2, verse_start: 8, verse_end: 9, created_at: '2026-05-12T09:00:00Z' }],
    });
    const { allowedVerseRefs } = await buildReflectionCandidates(deps(supabase));
    expect(allowedVerseRefs.has('John 1:1')).toBe(true);
    expect(allowedVerseRefs.has('John 10')).toBe(true);
    expect(allowedVerseRefs.has('Eph 2:8-9')).toBe(true);
  });

  // ── Precedence deletion-test (Tier 1), BOTH directions ──
  it('keeps TRAIL provenance when a ref is also a semantic neighbour', async () => {
    const supabase = makeSupabase({
      highlights: [{ verse_id: 'psa.27.14', created_at: '2026-05-12T09:00:00Z' }],
      matches: [{ source_id: 'psa.27.14' }],
    });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    const hit = candidates.filter((c) => c.ref === 'Ps 27:14');
    expect(hit).toHaveLength(1);              // deduped
    expect(hit[0].provenance).toBe('highlighted'); // trail wins
  });
  it('falls back to semantic provenance once the trail source is removed', async () => {
    const supabase = makeSupabase({ matches: [{ source_id: 'psa.27.14' }] });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    expect(candidates.find((c) => c.ref === 'Ps 27:14')?.provenance).toBe('semantic');
  });

  it('caps the pool at CANDIDATE_POOL_MAX and never evicts trail for semantic', async () => {
    const highlights = Array.from({ length: 10 }, (_, i) => ({ verse_id: `psa.1.${i + 1}`, created_at: '2026-05-12T09:00:00Z' }));
    const matches = Array.from({ length: 20 }, (_, i) => ({ source_id: `psa.2.${i + 1}` }));
    const supabase = makeSupabase({ highlights, matches });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    expect(candidates).toHaveLength(12);
    expect(candidates.filter((c) => c.provenance === 'highlighted')).toHaveLength(10); // all trail kept
    expect(candidates.filter((c) => c.provenance === 'semantic')).toHaveLength(2);     // only the remainder
  });
});
