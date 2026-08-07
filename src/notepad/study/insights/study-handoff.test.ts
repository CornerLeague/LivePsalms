// @vitest-environment jsdom
// src/notepad/study/insights/study-handoff.test.ts
//
// The handoff is an EVENT delivered through state, and that is the whole
// hazard: state is re-read on every render and re-read again on a remount,
// while an event must fire exactly once. Every test here is one way that goes
// wrong.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStudyHandoff, useApplyHandoff, type StudyHandoff } from './study-handoff';

describe('useStudyHandoff', () => {
  it('starts with nothing pending', () => {
    const { result } = renderHook(() => useStudyHandoff());
    expect(result.current.handoff).toBeNull();
  });

  it('mints a fresh id per press, so the same prompt twice is two handoffs', () => {
    const { result } = renderHook(() => useStudyHandoff());

    act(() => result.current.sendToChat('What is Psalm 27 not saying?'));
    const first = result.current.handoff;
    act(() => result.current.sendToChat('What is Psalm 27 not saying?'));
    const second = result.current.handoff;

    expect(first?.text).toBe('What is Psalm 27 not saying?');
    expect(second?.text).toBe(first?.text);
    expect(second!.id).toBeGreaterThan(first!.id);
  });

  it('keeps a stable sendToChat identity, so the door array does not rebuild per render', () => {
    const { result, rerender } = renderHook(() => useStudyHandoff());
    const first = result.current.sendToChat;
    rerender();
    expect(result.current.sendToChat).toBe(first);
  });
});

describe('useApplyHandoff', () => {
  function setup(initial: StudyHandoff | null) {
    const apply = vi.fn();
    const view = renderHook(({ h }: { h: StudyHandoff | null }) => useApplyHandoff(h, apply), {
      initialProps: { h: initial },
    });
    return { apply, ...view };
  }

  it('applies a handoff that arrives', () => {
    const { apply, rerender } = setup(null);
    rerender({ h: { id: 1, text: 'Why does Psalm 27:4 come where it does?' } });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ id: 1, text: 'Why does Psalm 27:4 come where it does?' });
  });

  it('applies it once, not again on every re-render', () => {
    const { apply, rerender } = setup(null);
    const h = { id: 1, text: 'x' };
    rerender({ h });
    rerender({ h });
    rerender({ h });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('applies a SECOND handoff carrying identical text', () => {
    // The id is the identity, not the text — pressing the same seeded prompt
    // twice must refill a draft the reader has since cleared.
    const { apply, rerender } = setup(null);
    rerender({ h: { id: 1, text: 'same' } });
    rerender({ h: { id: 2, text: 'same' } });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('applies NOTHING when it mounts with a handoff already present', () => {
    // The desktop collapse/re-expand case. StudySidePanel unmounts when the
    // reader collapses the pane, so LamplightStudyPanel remounts on re-expand
    // with the last handoff still sitting in the workspace's state. Seeded with
    // 0 this would resurrect a draft the reader had deliberately cleared.
    const { apply } = setup({ id: 7, text: 'stale' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('still applies the NEXT handoff after such a mount', () => {
    const { apply, rerender } = setup({ id: 7, text: 'stale' });
    rerender({ h: { id: 8, text: 'fresh' } });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ id: 8, text: 'fresh' });
  });

  it('reads the latest apply callback, so an inline arrow does not re-fire it', () => {
    // The same shape of bug InsightsOverlay's onCloseRef exists for: an inline
    // callback is a fresh identity every render, and a naive dependency on it
    // would re-run the effect and re-apply.
    let calls = 0;
    const { rerender } = renderHook(
      ({ h }: { h: StudyHandoff | null }) => useApplyHandoff(h, () => { calls += 1; }),
      { initialProps: { h: null as StudyHandoff | null } },
    );
    rerender({ h: { id: 1, text: 'a' } });
    rerender({ h: { id: 1, text: 'a' } });
    rerender({ h: { id: 1, text: 'a' } });
    expect(calls).toBe(1);
  });
});
