// @vitest-environment jsdom
// src/notepad/study/memorize/MemorizePanel.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// Mock the data hooks so the panel is testable without supabase/providers.
const addCards = vi.fn().mockResolvedValue([]);
const refetch = vi.fn();
const oneCard = { id: 'a', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB', text: 'For God so loved the world', mastery: 40, attempts: 1, lastPracticedAt: null, position: 0 };
// Mutable (reassigned, not mutated in place) so a test can simulate the active
// group's cards dropping to zero out from under an open session -- e.g. a
// sibling `useMemorizeCards` instance removing the last card mid-session --
// without reaching into MemorizePanel's React state directly.
let mockCards: (typeof oneCard)[] = [oneCard];
vi.mock('./useMemorizeCards', () => ({
  useMemorizeCards: () => ({
    cards: mockCards,
    canSave: true, loading: false, addCards, updateAfterAttempt: vi.fn(), removeCard: vi.fn(), refetch,
  }),
}));
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('@/notepad/bible/useBiblePassages', () => ({
  useBiblePassages: () => ({ verses: [{ verse: 16, text: 'For God so loved the world' }], loading: false, error: null }),
}));

import { MemorizePanel } from './MemorizePanel';

afterEach(() => { cleanup(); addCards.mockClear(); refetch.mockClear(); mockCards = [oneCard]; });

describe('MemorizePanel', () => {
  it('lists a saved card with its reference', () => {
    render(<MemorizePanel book="jhn" chapter={3} active />);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
  });

  it('adds the current passage', async () => {
    render(<MemorizePanel book="jhn" chapter={3} active />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add current passage/i })); });
    expect(addCards).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verse: 16, translation: 'BSB', text: 'For God so loved the world' },
    ]);
  });

  it('refetches when it becomes active (false -> true)', () => {
    const { rerender } = render(<MemorizePanel book="jhn" chapter={3} active={false} />);
    refetch.mockClear();
    rerender(<MemorizePanel book="jhn" chapter={3} active />);
    expect(refetch).toHaveBeenCalled();
  });

  // Regression anchor (finding s), half 1 of 2: anchors the `sessionKey != null`
  // half of the `inSession` guard by proving the Practice -> QuizSession mount
  // path works at all. This test alone does NOT anchor the
  // `sessionCards.length > 0` half -- see the next test for that.
  it('clicking a group\'s Practice control mounts QuizSession for that group', () => {
    render(<MemorizePanel book="jhn" chapter={3} active />);
    fireEvent.click(screen.getByRole('button', { name: /practice/i }));
    // The real QuizSession renders its "current / total" progress for the group's
    // single card once mounted.
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  // Regression anchor (finding s), half 2 of 2: anchors the
  // `sessionCards.length > 0` half of the `inSession` guard. If a session is
  // open (`sessionKey != null`) and the active group's cards drop to zero --
  // e.g. every card in that group is removed mid-session by a sibling
  // `useMemorizeCards` instance -- the guard must unmount QuizSession rather
  // than re-render it with an empty `cards` array. QuizSession indexes into
  // `cards[index]` unconditionally (`formatCardRef(current)` with
  // `current === undefined`), so rendering it with 0 cards throws. Weakening
  // the guard to `sessionKey != null` alone reproduces that crash here.
  it('unmounts QuizSession without throwing when the active group\'s cards drop to zero mid-session', () => {
    const { rerender } = render(<MemorizePanel book="jhn" chapter={3} active />);
    fireEvent.click(screen.getByRole('button', { name: /practice/i }));
    expect(screen.getByText('1 / 1')).toBeInTheDocument();

    // Simulate the last card in the open group disappearing while the session
    // stays open: sessionKey is untouched, but sessionCards recomputes to [].
    mockCards = [];
    expect(() => rerender(<MemorizePanel book="jhn" chapter={3} active />)).not.toThrow();

    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });
});
