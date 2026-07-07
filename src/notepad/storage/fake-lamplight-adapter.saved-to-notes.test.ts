import { describe, it, expect } from 'vitest';
import { FakeLamplightAdapter } from './fake-lamplight-adapter';
import type { ReflectionArtifact } from './lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, savedToNotes: boolean) {
  a.__seedReflection('u', {
    periodKey: '2026-05', title: 'T', artifact: art,
    createdAt: '2026-05-31T09:00:00.000Z', savedToNotes,
  });
}

describe('FakeLamplightAdapter.setReflectionSavedToNotes', () => {
  it('flips saved_to_notes on the artifact record', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, false);
    await a.setReflectionSavedToNotes('u', '2026-05', true);
    expect((await a.getReflection('u', '2026-05'))?.savedToNotes).toBe(true);
  });

  it('is a no-op when the reflection does not exist', async () => {
    const a = new FakeLamplightAdapter();
    await a.setReflectionSavedToNotes('u', '2026-05', true); // no throw
    expect(await a.getReflection('u', '2026-05')).toBeNull();
  });

  // Deletion test: annotating must NOT clobber saved_to_notes (separate tables).
  it('leaves saved_to_notes intact when the annotation state is updated', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, true);
    await a.setReflectionAnnotation('u', 'reflection_recap', '2026-05', 'a later thought');
    expect((await a.getReflection('u', '2026-05'))?.savedToNotes).toBe(true);
  });
});
