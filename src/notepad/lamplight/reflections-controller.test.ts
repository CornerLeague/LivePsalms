import { describe, it, expect, vi } from 'vitest';
import { ReflectionsController, type ReflectionsDeps, type ReflectionsState } from './reflections-controller';
import type { ReflectionRecord } from '../storage/lamplight-adapter';
import type { ReflectionArtifact } from '../storage/lamplight-artifacts';

const rec = (periodKey: string): ReflectionRecord => ({
  periodKey, title: 'T', artifact: { title: 'T', letter: 'L', markers: [] },
  createdAt: `${periodKey}-01T00:00:00.000Z`, savedToNotes: false,
});
const track = (c: ReflectionsController): ReflectionsState[] => {
  const seen: ReflectionsState[] = [];
  c.subscribe(() => seen.push(c.getSnapshot()));
  return seen;
};

describe('ReflectionsController', () => {
  it('retrieving → ready when the artifact already exists (no generate)', async () => {
    const deps: ReflectionsDeps = { getExisting: vi.fn().mockResolvedValue(rec('2026-05')), generate: vi.fn(), listBackfillTargets: vi.fn() };
    const c = new ReflectionsController(deps);
    const seen = track(c);
    c.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(c.getSnapshot().phase).toBe('ready'));
    expect(seen.map((s) => s.phase)).toContain('retrieving');
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('treats a content-less existing artifact (empty body) as empty, not ready', async () => {
    // Production's adapter casts data.body → ReflectionArtifact, so an empty {} row
    // hydrates to an artifact whose `letter` is undefined. Emitting 'ready' for it
    // hands the detail view an artifact with no letter → artifact.letter.split()
    // TypeError → blank route. It must degrade to 'empty' ("Nothing was written here.").
    const emptyRow: ReflectionRecord = {
      periodKey: '2026-03', title: '', artifact: {} as ReflectionArtifact,
      createdAt: '2026-03-01T00:00:00.000Z', savedToNotes: false,
    };
    const deps: ReflectionsDeps = { getExisting: vi.fn().mockResolvedValue(emptyRow), generate: vi.fn(), listBackfillTargets: vi.fn() };
    const c = new ReflectionsController(deps);
    c.setInputs({ userId: 'u', periodKey: '2026-03', autoGenerate: true });
    await vi.waitFor(() => expect(c.getSnapshot().phase).toBe('empty'));
    expect(deps.generate).not.toHaveBeenCalled(); // an existing (if empty) row is not regenerated
  });

  it('generates then re-reads to ready when none exists and autoGenerate is on', async () => {
    const deps: ReflectionsDeps = {
      getExisting: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(rec('2026-05')),
      generate: vi.fn().mockResolvedValue({ ok: true, artifact: rec('2026-05').artifact, cached: false }),
      listBackfillTargets: vi.fn(),
    };
    const c = new ReflectionsController(deps);
    c.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(c.getSnapshot().phase).toBe('ready'));
    expect(deps.generate).toHaveBeenCalledOnce();
  });

  it('maps validators_failed → unavailable and no_notes → empty', async () => {
    const mk = (reason: 'validators_failed' | 'no_notes') => new ReflectionsController({
      getExisting: vi.fn().mockResolvedValue(null),
      generate: vi.fn().mockResolvedValue({ ok: false, reason }),
      listBackfillTargets: vi.fn(),
    });
    const a = mk('validators_failed'); a.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(a.getSnapshot().phase).toBe('unavailable'));
    const b = mk('no_notes'); b.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(b.getSnapshot().phase).toBe('empty'));
  });

  it('a superseded run never overwrites a newer one (generation guard)', async () => {
    let resolveA!: () => void;
    const aHangs = new Promise<null>((r) => { resolveA = () => r(null); });
    const deps: ReflectionsDeps = {
      getExisting: vi.fn().mockReturnValueOnce(aHangs).mockResolvedValue(rec('2026-06')),
      generate: vi.fn(), listBackfillTargets: vi.fn(),
    };
    const c = new ReflectionsController(deps);
    c.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: false });
    c.setInputs({ userId: 'u', periodKey: '2026-06', autoGenerate: false });
    await vi.waitFor(() => expect(c.getSnapshot()).toEqual({ phase: 'ready', record: rec('2026-06') }));
    resolveA(); // the stale run resolves late…
    await new Promise((r) => setTimeout(r, 0));
    expect(c.getSnapshot()).toEqual({ phase: 'ready', record: rec('2026-06') }); // …and must not clobber
  });

  it('backfill generates every target sequentially, emits the status line, then idles', async () => {
    const order: string[] = [];
    const deps: ReflectionsDeps = {
      getExisting: vi.fn(),
      generate: vi.fn().mockImplementation(async (_u: string, pk: string) => { order.push(pk); return { ok: true, artifact: rec(pk).artifact, cached: false }; }),
      listBackfillTargets: vi.fn().mockResolvedValue(['2026-04', '2026-03', '2026-02']),
    };
    const c = new ReflectionsController(deps);
    const seen = track(c);
    await c.startBackfill('u');
    expect(order).toEqual(['2026-04', '2026-03', '2026-02']); // strict order = sequential
    expect(seen.some((s) => s.phase === 'backfilling' && s.message === 'Gathering the months behind you…')).toBe(true);
    expect(c.getSnapshot().phase).toBe('idle');
  });
});
