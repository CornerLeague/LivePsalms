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
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));

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
  it('renders the header + empty-state when no lexical card exists (out-of-scope verse)', () => {
    useVerseLexicon.mockReturnValue({ words: [words[1]], language: 'hebrew', loading: false, error: null });
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: false, error: null });
    render(<EtymologyPanel {...props} />);
    const header = screen.getByRole('button', { name: /etymology/i });
    expect(header).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('No etymology available for this verse.')).toBeInTheDocument();
    expect(screen.queryByText(/traditional, often speculative/i)).not.toBeInTheDocument();
  });

  it('renders the header + prompt when no verse is selected', () => {
    render(<EtymologyPanel {...props} verseId={null} />);
    const header = screen.getByRole('button', { name: /etymology/i });
    expect(header).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('Tap a verse in the reader to see its etymology.')).toBeInTheDocument();
    expect(screen.queryByText(/traditional, often speculative/i)).not.toBeInTheDocument();
  });

  it('is collapsed by default (spec §5)', () => {
    render(<EtymologyPanel {...props} />);
    expect(screen.getByRole('button', { name: /etymology/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/to tend, graze/)).not.toBeInTheDocument();
  });

  it('shows a skeleton while entries load', () => {
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: true, error: null });
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    expect(screen.getByTestId('etymology-skeleton')).toBeInTheDocument();
  });

  it('shows the disclaimer verbatim, above the first card, when etymology exists', () => {
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    const disclaimer = screen.getByText(
      'All etymological notes here reflect traditional, often speculative lexicon explanations and do not claim to represent settled historical-linguistic conclusions.',
    );
    expect(disclaimer).toBeInTheDocument();
    // DOM order: the card (its root gloss) must follow the disclaimer.
    const card = screen.getByText(/to tend, graze/);
    expect(disclaimer.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the lexical card: root, the narrated development, and an Ask button', () => {
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    expect(screen.getByText(/to tend, graze/)).toBeInTheDocument();
    expect(screen.getByText(/tending a flock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask lamplight about this verse/i })).toBeInTheDocument();
  });

  it('renders an existing insight inline instead of the Ask button', () => {
    useEtymologyVerseInsight.mockReturnValue({ insight: { body: 'A shared, pre-generated insight.' }, loading: false, error: null, generating: false, generate: vi.fn() });
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    expect(screen.getByText('A shared, pre-generated insight.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask lamplight/i })).not.toBeInTheDocument();
  });

  it('tapping Ask when entitled calls generate()', () => {
    const generate = vi.fn();
    useEtymologyVerseInsight.mockReturnValue({ insight: null, loading: false, error: null, generating: false, generate });
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    fireEvent.click(screen.getByRole('button', { name: /ask lamplight about this verse/i }));
    expect(generate).toHaveBeenCalled();
  });

  it('RTL nav: left chevron advances to the next (leftward) card', async () => {
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    expect(screen.getByText(/word 1 of 2/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next word/i }));
    await waitFor(() => expect(screen.getByText(/word 2 of 2/i)).toBeInTheDocument());
    expect(screen.getByText(/grammar/i)).toBeInTheDocument(); // the particle card, no Ask
    expect(screen.queryByRole('button', { name: /ask lamplight/i })).not.toBeInTheDocument();
  });

  it('shows a swipe hint on mobile', () => {
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    expect(screen.getByText(/swipe/i)).toBeInTheDocument();
  });

  // Regression: arrow-keying while the deck is momentarily empty (verse selected, words/entries
  // still loading in) must not drive currentIndex negative and crash the card render once entries
  // arrive. The section's onKeyDown is reachable in every state now that the panel always renders.
  it('survives ArrowLeft on an empty deck, then renders the card when entries load', () => {
    // Phase 1: verse selected but deck empty → "No etymology available" state.
    useVerseLexicon.mockReturnValue({ words: [], language: 'hebrew', loading: false, error: null });
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: false, error: null });
    const { rerender } = render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    expect(screen.getByText('No etymology available for this verse.')).toBeInTheDocument();

    // ArrowLeft (→ goNext) on the section while cards is empty — the pre-fix crash driver.
    const section = screen.getByRole('button', { name: /etymology/i }).closest('section') as HTMLElement;
    fireEvent.keyDown(section, { key: 'ArrowLeft' });

    // Phase 2: this verse's word + entry arrive; first card is a starred lexical, so firstStarredIndex
    // stays 0 and resetKey is unchanged (the reset never fires). Must render the card, not read cards[-1].
    useVerseLexicon.mockReturnValue({ words: [words[0]], language: 'hebrew', loading: false, error: null });
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map([['H7462', shepherdEntry]]), loading: false, error: null });
    rerender(<EtymologyPanel {...props} />);

    expect(screen.getByText(/to tend, graze/)).toBeInTheDocument();
    expect(screen.getByText(/word 1 of 1/i)).toBeInTheDocument();
  });
});
