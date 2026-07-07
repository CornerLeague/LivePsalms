import { describe, it, expect } from 'vitest';
import { FakeLamplightAdapter } from './fake-lamplight-adapter';
import type { ReflectionArtifact } from './lamplight-artifacts';

const U = 'user-1';
const artifact: ReflectionArtifact = { title: 'The month you kept showing up', letter: 'You came back.', markers: [] };

describe('FakeLamplightAdapter — reflections', () => {
  it('generate consumes the queue and, on ok, becomes readable via getReflection', async () => {
    const a = new FakeLamplightAdapter();
    a.__queueReflectionResult({ ok: true, artifact, cached: false });
    const res = await a.generateMonthlyReflection(U, '2026-05');
    expect(res).toEqual({ ok: true, artifact, cached: false });
    const rec = await a.getReflection(U, '2026-05');
    expect(rec?.title).toBe(artifact.title);
    expect(rec?.savedToNotes).toBe(false);
  });

  it('generate defaults to a network error when the queue is empty', async () => {
    const a = new FakeLamplightAdapter();
    expect(await a.generateMonthlyReflection(U, '2026-05')).toEqual({ ok: false, reason: 'network' });
  });

  it('listReflections is newest-first and joins hide/annotate state; hidden rows still list', async () => {
    const a = new FakeLamplightAdapter();
    a.__seedReflection(U, { periodKey: '2026-03', title: 'March', artifact, createdAt: '2026-03-01T12:00:00.000Z', savedToNotes: false });
    a.__seedReflection(U, { periodKey: '2026-05', title: 'May', artifact, createdAt: '2026-05-01T12:00:00.000Z', savedToNotes: false });
    await a.setReflectionHidden(U, 'reflection_recap', '2026-03', true);
    await a.setReflectionAnnotation(U, 'reflection_recap', '2026-05', 'my words');
    const list = await a.listReflections(U);
    expect(list.map((r) => r.periodKey)).toEqual(['2026-05', '2026-03']); // newest-first
    expect(list.find((r) => r.periodKey === '2026-03')?.hiddenAt).not.toBeNull();
    expect(list.find((r) => r.periodKey === '2026-05')?.annotation).toBe('my words');
  });

  it('listBackfillTargets returns exactly what was seeded', async () => {
    const a = new FakeLamplightAdapter();
    a.__setBackfillTargets(U, ['2026-04', '2026-02']);
    expect(await a.listBackfillTargets(U)).toEqual(['2026-04', '2026-02']);
  });
});
