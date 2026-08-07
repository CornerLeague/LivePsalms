import { describe, it, expect } from 'vitest';
import {
  readPassageDoor,
  writePassageDoor,
  sourcesFromExcerpts,
} from './passage-insight-cache.ts';
import { PASSAGE_DOOR_SPEC, PASSAGE_INSIGHT_SECTIONS } from './prompts/passage-insight.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

interface Op { method: string; args: unknown[] }

// A chainable Supabase fake. Records every filter so "reads a whole door in one
// query" and "never filters on prompt_version" are real assertions rather than
// claims about code nobody exercised.
function makeSupabase(opts: {
  rows?: unknown[];
  selectError?: { message: string } | null;
  upsertError?: { message: string } | null;
} = {}) {
  const ops: Op[] = [];
  const upserts: Array<{ rows: Array<Record<string, unknown>>; opts: unknown }> = [];

  const from = (table: string) => {
    ops.push({ method: 'from', args: [table] });
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: opts.rows ?? [], error: opts.selectError ?? null }).then(res, rej),
      upsert: (rows: Array<Record<string, unknown>>, o: unknown) => {
        upserts.push({ rows, opts: o });
        return {
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve({ error: opts.upsertError ?? null }).then(res, rej),
        };
      },
    };
    for (const m of ['select', 'eq', 'order']) {
      chain[m] = (...args: unknown[]) => { ops.push({ method: m, args }); return chain; };
    }
    return chain;
  };

  return { client: { from } as unknown as SupabaseClient, ops, upserts };
}

const KEYS = PASSAGE_INSIGHT_SECTIONS.map((s) => s.key);

function row(section: string, body: string, over: Record<string, unknown> = {}) {
  return {
    section, body,
    sources: [],
    model_used: 'gpt-5.6-terra',
    prompt_version: 'passage-insight-2026-08-06-v1',
    created_at: '2026-08-06T10:00:00Z',
    ...over,
  };
}

const FULL_DOOR = KEYS.map((k) => row(k, `body of ${k}`));

describe('readPassageDoor', () => {
  it('returns every section of the door, keyed by section name', async () => {
    const { client } = makeSupabase({ rows: FULL_DOOR });
    const door = await readPassageDoor(client, { scope: 'chapter', refId: 'psa.27', door: PASSAGE_DOOR_SPEC });

    expect(door).not.toBeNull();
    expect(Object.keys(door!.sections)).toEqual(KEYS);
    expect(door!.sections.overview).toBe('body of overview');
    expect(door!.modelUsed).toBe('gpt-5.6-terra');
    expect(door!.promptVersion).toBe('passage-insight-2026-08-06-v1');
  });

  it('D2: serves rows whose prompt_version is behind current, and never filters on it', async () => {
    const stale = KEYS.map((k) => row(k, `stale ${k}`, { prompt_version: 'passage-insight-2020-01-01-v0' }));
    const { client, ops } = makeSupabase({ rows: stale });
    const door = await readPassageDoor(client, { scope: 'chapter', refId: 'psa.27', door: PASSAGE_DOOR_SPEC });

    // A reader is never blocked by a prompt bump; refreshing is deliberate.
    expect(door!.sections.overview).toBe('stale overview');
    expect(door!.promptVersion).toBe('passage-insight-2020-01-01-v0');
    expect(ops.some((o) => o.method === 'eq' && o.args[0] === 'prompt_version')).toBe(false);
  });

  it('returns null when the door has no rows', async () => {
    const { client } = makeSupabase({ rows: [] });
    expect(await readPassageDoor(client, { scope: 'chapter', refId: 'psa.27', door: PASSAGE_DOOR_SPEC })).toBeNull();
  });

  it('distinguishes an uncached door from one whose sections are all legitimately empty', async () => {
    // The whole point of the null: "never generated" and "generated, and had
    // nothing warranted to say" must not look the same to the caller.
    const { client } = makeSupabase({ rows: KEYS.map((k) => row(k, '')) });
    const door = await readPassageDoor(client, { scope: 'chapter', refId: 'psa.27', door: PASSAGE_DOOR_SPEC });

    expect(door).not.toBeNull();
    expect(KEYS.every((k) => door!.sections[k] === '')).toBe(true);
  });

  it('normalises a section the cache is missing to empty rather than undefined', async () => {
    const { client } = makeSupabase({ rows: [row('overview', 'only this one')] });
    const door = await readPassageDoor(client, { scope: 'chapter', refId: 'psa.27', door: PASSAGE_DOOR_SPEC });

    expect(Object.keys(door!.sections)).toEqual(KEYS);
    expect(door!.sections.reflection).toBe('');
  });

  it('loads a whole door in ONE query, scoped by scope + ref_id + door', async () => {
    // The (scope, ref_id, door) index exists for exactly this; four queries
    // would make it pointless.
    const { client, ops } = makeSupabase({ rows: FULL_DOOR });
    await readPassageDoor(client, { scope: 'verse', refId: 'psa.27.4', door: PASSAGE_DOOR_SPEC });

    expect(ops.filter((o) => o.method === 'from')).toEqual([
      { method: 'from', args: ['bible_passage_insight'] },
    ]);
    const filters = ops.filter((o) => o.method === 'eq').map((o) => o.args);
    expect(filters).toEqual([['scope', 'verse'], ['ref_id', 'psa.27.4'], ['door', PASSAGE_DOOR_SPEC.id]]);
  });

  it('carries the library provenance stored with the door', async () => {
    const sources = [{ chunk_id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 27:4 [2]' }];
    const { client } = makeSupabase({ rows: KEYS.map((k) => row(k, `b ${k}`, { sources })) });
    const door = await readPassageDoor(client, { scope: 'chapter', refId: 'psa.27', door: PASSAGE_DOOR_SPEC });

    expect(door!.sources).toEqual(sources);
  });

  it('throws on a read error rather than reporting an uncached door', async () => {
    // Returning null here would send the reader to the generate path and
    // re-bill a door that is already warm.
    const { client } = makeSupabase({ rows: [], selectError: { message: 'connection reset' } });
    await expect(readPassageDoor(client, { scope: 'chapter', refId: 'psa.27', door: PASSAGE_DOOR_SPEC }))
      .rejects.toThrow(/connection reset/);
  });
});

describe('writePassageDoor', () => {
  const sections = Object.fromEntries(KEYS.map((k) => [k, `body of ${k}`]));
  const args = {
    scope: 'chapter' as const,
    refId: 'psa.27',
    door: PASSAGE_DOOR_SPEC,
    sections,
    sources: [{ chunk_id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 27:4 [2]' }],
    modelUsed: 'gpt-5.6-terra',
    promptVersion: 'passage-insight-2026-08-06-v1',
    createdBy: 'user-1',
  };

  it('upserts all four sections in ONE statement — the whole door or nothing', async () => {
    // Four separate upserts could leave two sections of a door in the cache
    // forever. A single multi-row statement cannot half-land.
    const { client, upserts } = makeSupabase();
    const out = await writePassageDoor(client, args);

    expect(out).toEqual({ written: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows.map((r) => r.section)).toEqual(KEYS);
  });

  it('stamps every row with its scope, ref, door, model, prompt version and author', async () => {
    const { client, upserts } = makeSupabase();
    await writePassageDoor(client, args);

    for (const r of upserts[0].rows) {
      expect(r.scope).toBe('chapter');
      expect(r.ref_id).toBe('psa.27');
      expect(r.door).toBe(PASSAGE_DOOR_SPEC.id);
      expect(r.model_used).toBe('gpt-5.6-terra');
      expect(r.prompt_version).toBe('passage-insight-2026-08-06-v1');
      expect(r.created_by).toBe('user-1');
      expect(r.sources).toEqual(args.sources);
    }
  });

  // Migration 061 widened the primary key to include `door`. The conflict target
  // must move with it: Postgres requires it to match a real unique constraint,
  // so a stale target does not silently mis-upsert — it fails the whole write.
  it('conflicts on the primary key, so a re-warm replaces rather than duplicates', async () => {
    const { client, upserts } = makeSupabase();
    await writePassageDoor(client, args);
    expect(upserts[0].opts).toMatchObject({ onConflict: 'scope,ref_id,door,section' });
  });

  it('writes a door with SOME empty sections — omission is first-class', async () => {
    const { client, upserts } = makeSupabase();
    const out = await writePassageDoor(client, {
      ...args,
      sections: { ...sections, chapter_shape: '' },
    });

    expect(out).toEqual({ written: true });
    expect(upserts[0].rows).toHaveLength(KEYS.length);
    expect(upserts[0].rows.find((r) => r.section === 'chapter_shape')!.body).toBe('');
  });

  it('REFUSES a door whose every section is empty, and writes nothing', async () => {
    // Otherwise the first reader to press "Study this passage" caches nothing,
    // permanently, for everyone after them.
    const { client, upserts } = makeSupabase();
    const out = await writePassageDoor(client, {
      ...args,
      sections: Object.fromEntries(KEYS.map((k) => [k, ''])),
    });

    expect(out).toEqual({ written: false, reason: 'empty_door' });
    expect(upserts).toHaveLength(0);
  });

  it('treats whitespace-only sections as empty', async () => {
    const { client, upserts } = makeSupabase();
    const out = await writePassageDoor(client, {
      ...args,
      sections: Object.fromEntries(KEYS.map((k) => [k, '   \n  '])),
    });

    expect(out).toEqual({ written: false, reason: 'empty_door' });
    expect(upserts).toHaveLength(0);
  });

  it('throws when the upsert fails, so a caller never reports a door it did not write', async () => {
    const { client } = makeSupabase({ upsertError: { message: 'permission denied' } });
    await expect(writePassageDoor(client, args)).rejects.toThrow(/permission denied/);
  });

  it('writes a verse-scope door under its verse ref', async () => {
    const { client, upserts } = makeSupabase();
    await writePassageDoor(client, { ...args, scope: 'verse', refId: 'psa.27.4' });

    expect(upserts[0].rows.every((r) => r.scope === 'verse' && r.ref_id === 'psa.27.4')).toBe(true);
  });
});

describe('sourcesFromExcerpts', () => {
  it('snapshots the heading rather than referencing the chunk', async () => {
    // A re-ingest rotates chunk ids; the door must still be able to say which
    // excerpt informed it. Same treatment as lamplight_artifacts.
    const out = sourcesFromExcerpts([
      { chunkId: 'lc1', sourceId: 'treasury-of-david', sourceLabel: 'The Treasury of David', heading: 'Psalm 27:4 [2]', content: 'One thing…', score: 0.9 },
    ]);
    expect(out).toEqual([{ chunk_id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 27:4 [2]' }]);
  });

  it('is an empty list when nothing from the library reached the prompt', () => {
    expect(sourcesFromExcerpts([])).toEqual([]);
    expect(sourcesFromExcerpts(undefined)).toEqual([]);
  });
});
