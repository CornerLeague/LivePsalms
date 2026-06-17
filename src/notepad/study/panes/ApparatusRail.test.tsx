// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const useApparatus = vi.fn();
vi.mock('../useApparatus', () => ({ useApparatus: (b: string, c: number) => useApparatus(b, c) }));
import { ApparatusRail } from './ApparatusRail';

describe('ApparatusRail', () => {
  it('renders the book card and flags OT<->NT cross refs', () => {
    useApparatus.mockReturnValue({
      book: { full_name: 'Isaiah', author: 'Isaiah', author_note: 'authorship debated', date_label: '~700 BC', region: 'Judah', cultural_context: 'Assyrian crisis', genre: 'Prophecy', summary: 'Judgment and comfort.' },
      crossRefs: [{ to_book: 'mat', to_chapter: 1, to_verse_start: 23, to_verse_end: 23, votes: 50, crossesTestament: true, text: 'the virgin will conceive' }],
      loading: false, error: null,
    });
    render(<ApparatusRail book="isa" chapter={7} />);
    expect(screen.getByText('Isaiah')).toBeTruthy();
    expect(screen.getByText(/authorship debated/)).toBeTruthy();
    expect(screen.getByText(/OT ↔ NT/)).toBeTruthy();
  });
  it('hides the book card when metadata is absent (degrades quietly)', () => {
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    const { container } = render(<ApparatusRail book="xyz" chapter={1} />);
    expect(container.textContent).not.toContain('undefined');
  });
});
