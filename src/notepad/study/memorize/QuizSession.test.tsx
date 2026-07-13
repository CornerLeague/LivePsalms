// @vitest-environment jsdom
// src/notepad/study/memorize/QuizSession.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QuizSession } from './QuizSession';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const mk = (id: string, verse: number): MemorizeCard => ({
  id, book: 'jhn', chapter: 3, verse, translation: 'BSB',
  text: 'For God so loved the world', mastery: 0, attempts: 0, lastPracticedAt: null, position: verse,
});

describe('QuizSession', () => {
  it('runs flashcard mode across two cards and commits per-card scores', () => {
    const onCommit = vi.fn();
    const onExit = vi.fn();
    render(<QuizSession cards={[mk('a', 16), mk('b', 17)]} onCommit={onCommit} onExit={onExit} />);

    // Switch to Flashcard (deterministic, no typing needed).
    fireEvent.click(screen.getByRole('tab', { name: /flashcard/i }));

    // Card 1
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    // Card 2
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    fireEvent.click(screen.getByRole('button', { name: /again/i }));

    // Summary -> Done
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onCommit).toHaveBeenCalledWith([
      { id: 'a', attemptScore: 100 },
      { id: 'b', attemptScore: 0 },
    ]);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('exits when the close control is used', () => {
    const onExit = vi.fn();
    render(<QuizSession cards={[mk('a', 16)]} onCommit={vi.fn()} onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: /close quiz|exit/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
