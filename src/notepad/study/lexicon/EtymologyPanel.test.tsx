// @vitest-environment jsdom
// src/notepad/study/lexicon/EtymologyPanel.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

// Deck data comes from the two hooks; mock them so the test targets panel behavior.
const useVerseLexicon = vi.fn();
const useReviewedEtymologyEntries = vi.fn();
const useEtymologyVerseInsight = vi.fn();
const hasAccess = vi.fn();
vi.mock('./useVerseLexicon', () => ({ useVerseLexicon: (...a: unknown[]) => useVerseLexicon(...a) }));
vi.mock('./useReviewedEtymologyEntries', () => ({ useReviewedEtymologyEntries: (...a: unknown[]) => useReviewedEtymologyEntries(...a) }));
vi.mock('./useEtymologyVerseInsight', () => ({ useEtymologyVerseInsight: (...a: unknown[]) => useEtymologyVerseInsight(...a) }));
vi.mock('@/notepad/hooks/useLamplightEntitlement', () => ({ useLamplightEntitlement: () => ({ isLoading: false, tier: 'plus', promoActive: false, hasAccess }) }));

import { EtymologyPanel } from './EtymologyPanel';
import type { EtymologyEntry } from './buildEtymologyDeck';

const shepherdEntry: EtymologyEntry = { strongs: 'H7462', lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend, graze', development: 'From tending a flock, the shepherd-king image grew.', related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }], studyValue: 9, source: "Strong's + BDB" };
const words = [
  { position: 4, original: 'רֹעִי', transliteration: 'roi', strongs: 'H7462', morph: 'HVqrmsc/Sp1bs', gloss: 'my shepherd' },
  { position: 5, original: 'לֹא', transliteration: 'lo', strongs: 'H3808', morph: 'HTn', gloss: 'not' },
];

beforeEach(() => {
  hasAccess.mockReturnValue(true);
  useVerseLexicon.mockReturnValue({ words, language: 'hebrew', loading: false, error: null });
  useReviewedEtymologyEntries.mockReturnValue({ entries: new Map([['H7462', shepherdEntry]]), loading: false, error: null });
  useEtymologyVerseInsight.mockReturnValue({ insight: null, loading: false, error: null, generating: false, generate: vi.fn() });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const props = { verseId: 'psa.23.1', reference: 'Psalm 23:1', userId: 'u1', adapter: null };

describe('EtymologyPanel', () => {
  it('renders null when no lexical card exists (out-of-scope verse)', () => {
    useVerseLexicon.mockReturnValue({ words: [words[1]], language: 'hebrew', loading: false, error: null });
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: false, error: null });
    const { container } = render(<EtymologyPanel {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a skeleton while entries load', () => {
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: true, error: null });
    render(<EtymologyPanel {...props} />);
    expect(screen.getByTestId('etymology-skeleton')).toBeInTheDocument();
  });

  it('renders the lexical card: root, the narrated development, and an Ask button', () => {
    render(<EtymologyPanel {...props} />);
    expect(screen.getByText(/to tend, graze/)).toBeInTheDocument();
    expect(screen.getByText(/tending a flock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask lamplight about this verse/i })).toBeInTheDocument();
  });

  it('renders an existing insight inline instead of the Ask button', () => {
    useEtymologyVerseInsight.mockReturnValue({ insight: { body: 'A shared, pre-generated insight.' }, loading: false, error: null, generating: false, generate: vi.fn() });
    render(<EtymologyPanel {...props} />);
    expect(screen.getByText('A shared, pre-generated insight.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask lamplight/i })).not.toBeInTheDocument();
  });

  it('tapping Ask when entitled calls generate()', () => {
    const generate = vi.fn();
    useEtymologyVerseInsight.mockReturnValue({ insight: null, loading: false, error: null, generating: false, generate });
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /ask lamplight about this verse/i }));
    expect(generate).toHaveBeenCalled();
  });

  it('RTL nav: left chevron advances to the next (leftward) card', async () => {
    render(<EtymologyPanel {...props} />);
    expect(screen.getByText(/word 1 of 2/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next word/i }));
    await waitFor(() => expect(screen.getByText(/word 2 of 2/i)).toBeInTheDocument());
    expect(screen.getByText(/grammar/i)).toBeInTheDocument(); // the particle card, no Ask
    expect(screen.queryByRole('button', { name: /ask lamplight/i })).not.toBeInTheDocument();
  });
});
