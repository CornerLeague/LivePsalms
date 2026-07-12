// @vitest-environment jsdom
// src/notepad/study/memorize/ClozeQuiz.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClozeQuiz } from './ClozeQuiz';
import type { MemorizeCard } from './memorize-types';

afterEach(cleanup);

const card: MemorizeCard = {
  id: 'card-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved the world', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('ClozeQuiz', () => {
  it('renders an input per blank and reports 100% when all correct', () => {
    const onGraded = vi.fn();
    render(<ClozeQuiz card={card} seedSalt={0} onGraded={onGraded} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
    // Fill each blank with its expected word (exposed via data-answer for the test).
    inputs.forEach((el) => {
      const expected = (el as HTMLInputElement).getAttribute('data-answer') ?? '';
      fireEvent.change(el, { target: { value: expected } });
    });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onGraded).toHaveBeenCalledWith(100);
  });

  it('reports a partial score when a blank is wrong', () => {
    const onGraded = vi.fn();
    render(<ClozeQuiz card={card} seedSalt={0} onGraded={onGraded} />);
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((el, i) => {
      const expected = (el as HTMLInputElement).getAttribute('data-answer') ?? '';
      fireEvent.change(el, { target: { value: i === 0 ? 'WRONG' : expected } });
    });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const score = onGraded.mock.calls[0][0];
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(100);
  });
});
