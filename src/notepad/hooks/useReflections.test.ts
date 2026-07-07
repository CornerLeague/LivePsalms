// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useReflections } from './useReflections';
import { FakeLamplightAdapter } from '../storage/fake-lamplight-adapter';
import { ReflectionsController } from '../lamplight/reflections-controller';
import type { ReflectionArtifact } from '../storage/lamplight-artifacts';

const artifact: ReflectionArtifact = {
  title: 'The month you kept showing up',
  letter: 'You came back to the same handful of verses more than once.',
  markers: [{ date: '2026-05-04', verse: 'Psalm 42:5', phrase: 'you asked why you were downcast' }],
};

describe('useReflections', () => {
  it('detail mode: retrieves an existing reflection into ready', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedReflection('u', {
      periodKey: '2026-05', title: artifact.title, artifact,
      createdAt: '2026-05-01T12:00:00.000Z', savedToNotes: false,
    });
    const { result } = renderHook(() => useReflections({ adapter, userId: 'u', periodKey: '2026-05' }));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    expect(result.current.state).toMatchObject({ phase: 'ready', record: { periodKey: '2026-05' } });
  });

  it('detail mode: generates when none exists and autoGenerate is on (default)', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    const { result } = renderHook(() => useReflections({ adapter, userId: 'u', periodKey: '2026-06' }));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  });

  it('detail mode: autoGenerate=false stays idle until start()', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    const { result } = renderHook(() =>
      useReflections({ adapter, userId: 'u', periodKey: '2026-06', autoGenerate: false }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  });

  it('path mode: no periodKey stays idle; backfill() walks the seeded targets and paints stones', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__setBackfillTargets('u', ['2026-04', '2026-03']);
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    const { result } = renderHook(() => useReflections({ adapter, userId: 'u' }));
    expect(result.current.state.phase).toBe('idle');
    await act(async () => { await result.current.backfill(); });
    expect(await adapter.listReflections('u')).toHaveLength(2); // both months now have artifact rows
  });

  it('unmount calls dispose on the controller', () => {
    const disposeSpy = vi.spyOn(ReflectionsController.prototype, 'dispose');
    try {
      const adapter = new FakeLamplightAdapter();
      const { unmount } = renderHook(() =>
        useReflections({ adapter, userId: 'u1', periodKey: null, autoGenerate: false }),
      );
      expect(disposeSpy).not.toHaveBeenCalled();
      unmount();
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });
});
