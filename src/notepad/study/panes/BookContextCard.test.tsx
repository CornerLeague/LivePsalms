// @vitest-environment jsdom
// src/notepad/study/panes/BookContextCard.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BookContextCard } from './BookContextCard';
import type { BookApparatus } from '../useApparatus';

afterEach(cleanup);

const ISAIAH: BookApparatus = {
  book: 'isa', full_name: 'Isaiah', author: 'Isaiah',
  author_note: 'chapters 40-66 are widely assigned to a later hand',
  date_label: '~700 BC', region: 'Judah', cultural_context: 'The Assyrian crisis',
  genre: 'Prophecy', summary: 'Judgment and comfort.',
};

describe('BookContextCard', () => {
  it('renders the book name and every apparatus field', () => {
    render(<BookContextCard ctx={ISAIAH} />);
    expect(screen.getByText('Isaiah')).toBeTruthy();
    expect(screen.getByText(/~700 BC/)).toBeTruthy();
    expect(screen.getByText(/Judah/)).toBeTruthy();
    expect(screen.getByText(/Prophecy/)).toBeTruthy();
    expect(screen.getByText(/The Assyrian crisis/)).toBeTruthy();
    expect(screen.getByText(/Judgment and comfort/)).toBeTruthy();
  });

  it('carries the authorship hedge verbatim — a disputed attribution must stay disputed', () => {
    render(<BookContextCard ctx={ISAIAH} />);
    expect(screen.getByText(/chapters 40-66 are widely assigned to a later hand/)).toBeTruthy();
  });

  it('omits optional fields that are blank rather than rendering empty labels', () => {
    const sparse: BookApparatus = {
      ...ISAIAH, author_note: '', date_label: '', region: '', genre: '',
      cultural_context: '', summary: '',
    };
    const { container } = render(<BookContextCard ctx={sparse} />);

    expect(screen.getByRole('heading', { name: 'Isaiah' })).toBeTruthy();
    expect(container.textContent).not.toContain('Date:');
    expect(container.textContent).not.toContain('Region:');
    expect(container.textContent).not.toContain('Genre:');
    expect(container.textContent).not.toContain('undefined');
  });

  it('renders the author without a trailing dash when there is no note', () => {
    render(<BookContextCard ctx={{ ...ISAIAH, author: 'Isaiah son of Amoz', author_note: '' }} />);
    // getByText resolves to the <strong> label; the line itself is its parent.
    expect(screen.getByText(/Author:/).parentElement!.textContent).toBe('Author: Isaiah son of Amoz');
  });
});
