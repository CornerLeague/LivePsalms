import { describe, it, expect, vi } from 'vitest';
import { parseArgs, resolveAdapter, runIngest, ADAPTERS, type IngestDeps } from './ingest-library';

function makeDeps(over: Partial<IngestDeps> = {}): IngestDeps & {
  upsertedChunks: unknown[][]; upsertedSources: unknown[];
} {
  const upsertedChunks: unknown[][] = [];
  const upsertedSources: unknown[] = [];
  return {
    readFile: () => '{"ref":"Psalm 27:4","body":"One thing have I desired of the LORD."}',
    upsertSource: async (row) => { upsertedSources.push(row); },
    upsertChunks: async (rows) => { upsertedChunks.push(rows); },
    fetchUnembedded: async () => [],
    writeEmbeddings: async () => {},
    embed: async (texts) => texts.map(() => [0.1, 0.2]),
    log: () => {},
    upsertedChunks,
    upsertedSources,
    ...over,
  } as IngestDeps & { upsertedChunks: unknown[][]; upsertedSources: unknown[] };
}

const base = { dryRun: false, embedOnly: false };

describe('parseArgs', () => {
  it('reads source, file, and flags', () => {
    expect(parseArgs(['--source=jfb', '--file=a.jsonl', '--dry-run'])).toEqual({
      sourceId: 'jfb', file: 'a.jsonl', dryRun: true, embedOnly: false,
    });
  });

  it('defaults the flags off', () => {
    expect(parseArgs([])).toEqual({ sourceId: undefined, file: undefined, dryRun: false, embedOnly: false });
  });
});

describe('resolveAdapter', () => {
  it('resolves each registered source', () => {
    for (const id of Object.keys(ADAPTERS)) expect(resolveAdapter(id).sourceId).toBe(id);
  });

  it('throws listing the known sources on an unknown id', () => {
    expect(() => resolveAdapter('nope')).toThrow(/unknown source "nope"/);
    expect(() => resolveAdapter('nope')).toThrow(/treasury-of-david/);
  });
});

describe('runIngest', () => {
  it('parses, upserts the source BEFORE its chunks, and reports counts', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      upsertSource: async () => { order.push('source'); },
      upsertChunks: async () => { order.push('chunks'); },
    });
    const report = await runIngest(deps, { ...base, sourceId: 'treasury-of-david', file: 'x.jsonl' });

    expect(report.parsed).toBe(1);
    expect(report.upserted).toBe(1);
    // FK ordering: the source row must exist before chunks reference it.
    expect(order).toEqual(['source', 'chunks']);
  });

  it('dry-run touches NOTHING — no source, no chunks, no embedding', async () => {
    const upsertSource = vi.fn();
    const upsertChunks = vi.fn();
    const fetchUnembedded = vi.fn(async () => []);
    const deps = makeDeps({ upsertSource, upsertChunks, fetchUnembedded });

    const report = await runIngest(deps, {
      ...base, dryRun: true, sourceId: 'treasury-of-david', file: 'x.jsonl',
    });

    expect(report.parsed).toBe(1);
    expect(report.upserted).toBe(0);
    expect(upsertSource).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
    expect(fetchUnembedded).not.toHaveBeenCalled();
  });

  it('embed-only skips parsing entirely (never reads the file)', async () => {
    const readFile = vi.fn(() => '');
    const deps = makeDeps({ readFile, fetchUnembedded: async () => [] });
    const report = await runIngest(deps, { ...base, embedOnly: true, sourceId: 'jfb' });

    expect(readFile).not.toHaveBeenCalled();
    expect(report.parsed).toBe(0);
  });

  it('requires --source and --file unless embed-only', async () => {
    await expect(runIngest(makeDeps(), { ...base, file: 'x.jsonl' }))
      .rejects.toThrow(/--source is required/);
    await expect(runIngest(makeDeps(), { ...base, sourceId: 'jfb' }))
      .rejects.toThrow(/--file is required/);
  });

  it('slices chunk upserts rather than sending one huge batch', async () => {
    // 450 entries → 3 slices at 200
    const lines = Array.from({ length: 450 }, (_, i) =>
      `{"ref":"Psalm 27:${(i % 14) + 1}","body":"Comment number ${i} on the verse."}`).join('\n');
    const deps = makeDeps({ readFile: () => lines });
    const report = await runIngest(deps, { ...base, sourceId: 'treasury-of-david', file: 'x.jsonl' });

    expect(report.parsed).toBe(450);
    expect(report.upserted).toBe(450);
    expect(deps.upsertedChunks).toHaveLength(3);
    expect(deps.upsertedChunks[0]).toHaveLength(200);
    expect(deps.upsertedChunks[2]).toHaveLength(50);
  });

  it('REGRESSION: pages the embedding backlog instead of stopping at one response', async () => {
    // PostgREST caps a response at ~1000 rows. An unlimited select silently
    // returned only the first page, so a 12,745-chunk source reported
    // "embedded: 1000" and looked done while 11,745 rows had no vector.
    let remaining = 1200;
    const requestedLimits: number[] = [];
    const deps = makeDeps({
      fetchUnembedded: async (_src, limit) => {
        requestedLimits.push(limit);
        const n = Math.min(limit, remaining);
        remaining -= n;                       // writing embeddings shrinks the set
        return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, content: 'text' }));
      },
    });

    const report = await runIngest(deps, { ...base, embedOnly: true, sourceId: 'jfb' });

    expect(report.embedded).toBe(1200);       // not 500, not 1000
    expect(requestedLimits.every((l) => l <= 500)).toBe(true);
    expect(requestedLimits.length).toBeGreaterThan(1);
  });

  it('writes one vector per chunk, batching the embed calls', async () => {
    const batchSizes: number[] = [];
    const written: string[] = [];
    let remaining = 100;
    const deps = makeDeps({
      fetchUnembedded: async (_s, limit) => {
        const n = Math.min(limit, remaining);
        remaining -= n;
        return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, content: `text ${i}` }));
      },
      embed: async (texts) => { batchSizes.push(texts.length); return texts.map(() => [0.5]); },
      writeEmbeddings: async (rows) => { written.push(...rows.map((r) => r.id)); },
    });

    const report = await runIngest(deps, { ...base, embedOnly: true, sourceId: 'jfb' });
    expect(report.embedded).toBe(100);
    expect(written).toHaveLength(100);
    expect(batchSizes.every((n) => n <= 64)).toBe(true);   // Voyage batch ceiling
  });

  it('propagates an adapter parse failure instead of writing partial data', async () => {
    const upsertChunks = vi.fn();
    const deps = makeDeps({ readFile: () => '{"ref":"Psalm 27:4"}', upsertChunks });
    await expect(runIngest(deps, { ...base, sourceId: 'treasury-of-david', file: 'x.jsonl' }))
      .rejects.toThrow(/missing ref\/body/);
    expect(upsertChunks).not.toHaveBeenCalled();
  });
});
