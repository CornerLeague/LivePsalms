// @vitest-environment jsdom
// src/notepad/study/memorize/FlashcardQuiz.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FlashcardQuiz } from './FlashcardQuiz';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const card: MemorizeCard = {
  id: 'card-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved the world', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('FlashcardQuiz', () => {
  it('shows the reference, reveals the text, and grades Got it as 100', () => {
    const onGraded = vi.fn();
    render(<FlashcardQuiz card={card} onGraded={onGraded} />);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.queryByText(/for god so loved/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    expect(screen.getByText(/for god so loved the world/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onGraded).toHaveBeenCalledWith(100);
  });

  it('grades Again as 0', () => {
    const onGraded = vi.fn();
    render(<FlashcardQuiz card={card} onGraded={onGraded} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    fireEvent.click(screen.getByRole('button', { name: /again/i }));
    expect(onGraded).toHaveBeenCalledWith(0);
  });
});
