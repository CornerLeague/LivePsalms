// @vitest-environment jsdom
// src/notepad/study/lexicon/OriginalLanguagePanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useVerseLexicon = vi.fn();
const useStrongsEntry = vi.fn();
vi.mock('./useVerseLexicon', () => ({ useVerseLexicon: (id: string | null) => useVerseLexicon(id) }));
vi.mock('./useStrongsEntry', () => ({ useStrongsEntry: (s: string | null) => useStrongsEntry(s) }));
import { OriginalLanguagePanel } from './OriginalLanguagePanel';

beforeEach(() => {
  useVerseLexicon.mockReset();
  useStrongsEntry.mockReset();
  useStrongsEntry.mockReturnValue({ entry: null, loading: false, error: null });
});

describe('OriginalLanguagePanel', () => {
  it('prompts the user to select a verse when verseId is null', () => {
    useVerseLexicon.mockReturnValue({ words: [], language: null, loading: false, error: null });
    render(<OriginalLanguagePanel verseId={null} reference={null} />);
    expect(screen.getByText(/Tap a verse in the reader/i)).toBeTruthy();
  });

  it('renders the reference, language badge, and word rows (RTL for Hebrew)', () => {
    useVerseLexicon.mockReturnValue({
      words: [{ position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning' }],
      language: 'hebrew', loading: false, error: null,
    });
    render(<OriginalLanguagePanel verseId="gen.1.1" reference="Genesis 1:1" />);
    expect(screen.getByText('Genesis 1:1')).toBeTruthy();
    expect(screen.getByText('Hebrew')).toBeTruthy();
    const word = screen.getByText('בְּרֵאשִׁית');
    expect(word.getAttribute('dir')).toBe('rtl');
    expect(screen.getByText('H7225')).toBeTruthy();
  });

  it('expands a word to show its morphology and Strong\'s definition', () => {
    useVerseLexicon.mockReturnValue({
      words: [{ position: 1, original: 'θεός', transliteration: 'theos', strongs: 'G2316', morph: 'N-NSM', gloss: 'God' }],
      language: 'greek', loading: false, error: null,
    });
    useStrongsEntry.mockReturnValue({ entry: { strongs: 'G2316', lemma: 'θεός', transliteration: 'theos', pronunciation: 'theh-os', shortDef: 'God', fullDef: 'a deity; God', language: 'greek' }, loading: false, error: null });
    render(<OriginalLanguagePanel verseId="jhn.1.1" reference="John 1:1" />);
    fireEvent.click(screen.getByText('θεός'));
    expect(screen.getByText('N-NSM')).toBeTruthy();
    expect(screen.getByText(/a deity; God/)).toBeTruthy();
  });

  it('shows a graceful message when the verse has no lexicon data', () => {
    useVerseLexicon.mockReturnValue({ words: [], language: null, loading: false, error: null });
    render(<OriginalLanguagePanel verseId="gen.1.1" reference="Genesis 1:1" />);
    expect(screen.getByText(/isn.t available for this verse/i)).toBeTruthy();
  });
});
