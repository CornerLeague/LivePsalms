// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteTitle } from './use-note-title';
import type { Note } from '../types';

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Alpha',
    content: '',
    folderId: 'root',
    type: 'general',
    tags: [],
    wordCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useNoteTitle', () => {
  it('exposes the active note title initially', () => {
    const { result } = renderHook(() =>
      useNoteTitle({ activeNote: note(), updateNote: vi.fn() }),
    );
    expect(result.current.title).toBe('Alpha');
  });

  it('updates the local title immediately on change, before (and independent of) persistence', () => {
    // A never-resolving save proves the displayed value is NOT gated behind the
    // async write — the root cause of the mobile typing lag.
    const updateNote = vi.fn(() => new Promise<Note>(() => {}));
    const { result } = renderHook(() =>
      useNoteTitle({ activeNote: note(), updateNote }),
    );

    act(() => result.current.onTitleChange('Alpha Beta'));

    expect(result.current.title).toBe('Alpha Beta');
    expect(updateNote).not.toHaveBeenCalled(); // debounced — not on this keystroke
  });

  it('debounces persistence: one updateNote call with the final value after the window', () => {
    const updateNote = vi.fn();
    const { result } = renderHook(() =>
      useNoteTitle({ activeNote: note(), updateNote, saveDebounceMs: 500 }),
    );

    act(() => {
      result.current.onTitleChange('A');
      result.current.onTitleChange('Ab');
      result.current.onTitleChange('Abc');
    });
    expect(updateNote).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith('n1', { title: 'Abc' });
  });

  it('flushTitle persists the pending value immediately (e.g. on blur) without double-saving', () => {
    const updateNote = vi.fn();
    const { result } = renderHook(() =>
      useNoteTitle({ activeNote: note(), updateNote }),
    );

    act(() => result.current.onTitleChange('Done'));
    act(() => result.current.flushTitle());

    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith('n1', { title: 'Done' });

    // The pending debounce timer must not fire a second, redundant save.
    act(() => vi.advanceTimersByTime(500));
    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it('flushTitle is a no-op when there is no pending edit', () => {
    const updateNote = vi.fn();
    const { result } = renderHook(() =>
      useNoteTitle({ activeNote: note(), updateNote }),
    );

    act(() => result.current.flushTitle());

    expect(updateNote).not.toHaveBeenCalled();
  });

  it('resets the field to the new note when the active note changes', () => {
    const { result, rerender } = renderHook(
      ({ n }) => useNoteTitle({ activeNote: n, updateNote: vi.fn() }),
      { initialProps: { n: note() } },
    );

    rerender({ n: note({ id: 'n2', title: 'Beta' }) });

    expect(result.current.title).toBe('Beta');
  });

  it('flushes the outgoing note pending save when switching notes (no lost edit, correct id)', () => {
    const updateNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ n }) => useNoteTitle({ activeNote: n, updateNote }),
      { initialProps: { n: note() } },
    );

    act(() => result.current.onTitleChange('Alpha edited'));
    rerender({ n: note({ id: 'n2', title: 'Beta' }) });

    // The half-typed title persists against the OLD note id, not the new one.
    expect(updateNote).toHaveBeenCalledWith('n1', { title: 'Alpha edited' });
    expect(result.current.title).toBe('Beta');
  });

  it('does not clobber in-flight typing when the active note title updates for the same id', () => {
    // Simulates our own debounced save resolving and feeding an updated note
    // object back in for the SAME id while the user keeps typing.
    const { result, rerender } = renderHook(
      ({ n }) => useNoteTitle({ activeNote: n, updateNote: vi.fn() }),
      { initialProps: { n: note() } },
    );

    act(() => result.current.onTitleChange('Alpha working'));
    rerender({ n: note({ title: 'Alpha' }) }); // same id 'n1', stale title echo

    expect(result.current.title).toBe('Alpha working');
  });
});
