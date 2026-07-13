// @vitest-environment jsdom
// src/notepad/study/memorize/MemorizePanel.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// Mock the data hooks so the panel is testable without supabase/providers.
const addCards = vi.fn().mockResolvedValue([]);
const refetch = vi.fn();
vi.mock('./useMemorizeCards', () => ({
  useMemorizeCards: () => ({
    cards: [
      { id: 'a', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB', text: 'For God so loved the world', mastery: 40, attempts: 1, lastPracticedAt: null, position: 0 },
    ],
    canSave: true, loading: false, addCards, updateAfterAttempt: vi.fn(), removeCard: vi.fn(), refetch,
  }),
}));
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('@/notepad/bible/useBiblePassages', () => ({
  useBiblePassages: () => ({ verses: [{ verse: 16, text: 'For God so loved the world' }], loading: false, error: null }),
}));

import { MemorizePanel } from './MemorizePanel';

afterEach(() => { cleanup(); addCards.mockClear(); refetch.mockClear(); });

describe('MemorizePanel', () => {
  it('lists a saved card with its reference', () => {
    render(<MemorizePanel book="jhn" chapter={3} userId="u1" active />);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
  });

  it('adds the current passage', async () => {
    render(<MemorizePanel book="jhn" chapter={3} userId="u1" active />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add current passage/i })); });
    expect(addCards).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verse: 16, translation: 'BSB', text: 'For God so loved the world' },
    ]);
  });

  it('refetches when it becomes active (false -> true)', () => {
    const { rerender } = render(<MemorizePanel book="jhn" chapter={3} userId="u1" active={false} />);
    refetch.mockClear();
    rerender(<MemorizePanel book="jhn" chapter={3} userId="u1" active />);
    expect(refetch).toHaveBeenCalled();
  });
});
