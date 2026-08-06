// @vitest-environment jsdom
// src/notepad/study/insights/CrossReferenceList.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { CrossRefView } from '../useApparatus';
import type { CrossRefDetail } from './useCrossRefDetail';

const detailFor = vi.fn();
vi.mock('./useCrossRefDetail', () => ({
  useCrossRefDetail: (t: unknown) => detailFor(t),
}));

import { CrossReferenceList } from './CrossReferenceList';

const HEB: CrossRefView = {
  to_book: 'heb', to_chapter: 11, to_verse_start: 6, to_verse_end: 6,
  votes: 42, crossesTestament: true, text: 'And without faith it is impossible to please God.',
};
const PSA: CrossRefView = {
  to_book: 'psa', to_chapter: 34, to_verse_start: 8, to_verse_end: 8,
  votes: 30, crossesTestament: false, text: 'Taste and see that the LORD is good.',
};

const DETAIL: CrossRefDetail = {
  verses: [
    { verse: 5, text: 'By faith Enoch was taken up.', isTarget: false },
    { verse: 6, text: 'And without faith it is impossible to please God.', isTarget: true },
    { verse: 7, text: 'By faith Noah built an ark.', isTarget: false },
  ],
  book: {
    full_name: 'Hebrews', author: 'Unknown', author_note: 'authorship disputed since antiquity',
    date_label: '~65 AD', genre: 'Epistle',
  },
  voices: [],
};

beforeEach(() => {
  detailFor.mockReset();
  detailFor.mockReturnValue({ detail: DETAIL, loading: false });
});
afterEach(cleanup);

describe('CrossReferenceList', () => {
  it('renders nothing when there are no cross-references', () => {
    const { container } = render(<CrossReferenceList crossRefs={[]} translation="BSB" passageKey="psa.27" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row per reference with its label, text, and testament badge', () => {
    render(<CrossReferenceList crossRefs={[HEB, PSA]} translation="BSB" passageKey="psa.27" />);

    expect(screen.getByText('Hebrews 11:6')).toBeTruthy();
    expect(screen.getByText('Psalm 34:8')).toBeTruthy();
    expect(screen.getByText(/impossible to please God/)).toBeTruthy();
    expect(screen.getAllByText(/OT ↔ NT/)).toHaveLength(1);
  });

  it('does not load a reference until the reader opens it', () => {
    render(<CrossReferenceList crossRefs={[HEB, PSA]} translation="BSB" passageKey="psa.27" />);
    expect(detailFor).not.toHaveBeenCalled();
  });

  it('expands in place, showing the passage in its own context', () => {
    render(<CrossReferenceList crossRefs={[HEB]} translation="BSB" passageKey="psa.27" />);
    fireEvent.click(screen.getByRole('button', { name: /Hebrews 11:6/ }));

    const panel = screen.getByTestId('crossref-expansion');
    expect(panel.textContent).toContain('By faith Enoch was taken up.');
    expect(panel.textContent).toContain('By faith Noah built an ark.');
  });

  it('gives the target book its footing, hedge included', () => {
    render(<CrossReferenceList crossRefs={[HEB]} translation="BSB" passageKey="psa.27" />);
    fireEvent.click(screen.getByRole('button', { name: /Hebrews 11:6/ }));

    const panel = screen.getByTestId('crossref-expansion');
    expect(panel.textContent).toContain('Hebrews');
    expect(panel.textContent).toContain('~65 AD');
    expect(panel.textContent).toContain('authorship disputed since antiquity');
  });

  it('opens several references at once and closes them individually', () => {
    render(<CrossReferenceList crossRefs={[HEB, PSA]} translation="BSB" passageKey="psa.27" />);
    const hebToggle = screen.getByRole('button', { name: /Hebrews 11:6/ });
    const psaToggle = screen.getByRole('button', { name: /Psalm 34:8/ });

    fireEvent.click(hebToggle);
    fireEvent.click(psaToggle);
    expect(screen.getAllByTestId('crossref-expansion')).toHaveLength(2);

    fireEvent.click(hebToggle);
    expect(screen.getAllByTestId('crossref-expansion')).toHaveLength(1);
    expect(psaToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses everything when the reader moves to another passage', () => {
    const { rerender } = render(<CrossReferenceList crossRefs={[HEB]} translation="BSB" passageKey="psa.27" />);
    fireEvent.click(screen.getByRole('button', { name: /Hebrews 11:6/ }));
    expect(screen.queryByTestId('crossref-expansion')).toBeTruthy();

    rerender(<CrossReferenceList crossRefs={[HEB]} translation="BSB" passageKey="psa.28" />);
    expect(screen.queryByTestId('crossref-expansion')).toBeNull();
  });

  it('asks for the opened reference’s own target', () => {
    render(<CrossReferenceList crossRefs={[HEB]} translation="BSB" passageKey="psa.27" />);
    fireEvent.click(screen.getByRole('button', { name: /Hebrews 11:6/ }));

    expect(detailFor).toHaveBeenCalledWith({ book: 'heb', chapter: 11, verseStart: 6, verseEnd: 6 });
  });

  // ── The Pillar D tripwire ────────────────────────────────────────────────
  // B1 ships the connection SHOWN, never explained: the reader sees both
  // passages and draws the line. A generated "why these belong together" needs
  // the Connections Engine's contract (typed roads, confidence tiers, the
  // typology gate) — without it, enthusiastic connection-making drifts into
  // allegory. If someone adds explanatory prose here instead of in that slot,
  // this test fails loudly.
  it('renders no explanation of why the passages connect', () => {
    render(<CrossReferenceList crossRefs={[HEB]} translation="BSB" passageKey="psa.27" />);
    fireEvent.click(screen.getByRole('button', { name: /Hebrews 11:6/ }));

    const panel = screen.getByTestId('crossref-expansion');
    const accountedFor = [
      ...DETAIL.verses.map((v) => `${v.verse}${v.text}`),
      'Hebrews', 'Unknown', 'authorship disputed since antiquity', '~65 AD', 'Epistle',
      '·', '—', ' ', ',',
    ];
    let remaining = panel.textContent ?? '';
    for (const part of accountedFor) remaining = remaining.split(part).join('');
    expect(remaining.trim()).toBe('');
  });
});
