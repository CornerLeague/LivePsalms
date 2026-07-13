// @vitest-environment jsdom
// src/notepad/study/memorize/BlankPageQuiz.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BlankPageQuiz } from './BlankPageQuiz';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const card: MemorizeCard = {
  id: 'card-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('BlankPageQuiz', () => {
  it('scores 100% on a perfect recall and passes it on Continue', () => {
    const onGraded = vi.fn();
    render(<BlankPageQuiz card={card} onGraded={onGraded} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'for god so loved' } });
    fireEvent.click(screen.getByRole('button', { name: /reveal|compare/i }));
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onGraded).toHaveBeenCalledWith(100);
  });

  it('scores partially when a word is missed', () => {
    const onGraded = vi.fn();
    render(<BlankPageQuiz card={card} onGraded={onGraded} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'For God loved' } });
    fireEvent.click(screen.getByRole('button', { name: /reveal|compare/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onGraded).toHaveBeenCalledWith(75);
  });
});
