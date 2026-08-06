// @vitest-environment jsdom
// src/notepad/study/insights/ReferenceDoor.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { CrossRefView } from '../useApparatus';

const apparatus = vi.fn();
vi.mock('../useApparatus', () => ({ useApparatus: (b: string, c: number, t: string) => apparatus(b, c, t) }));

const libraryVoices = vi.fn();
vi.mock('./useLibraryVoices', () => ({ useLibraryVoices: (a: unknown) => libraryVoices(a) }));

const langProps = vi.fn();
vi.mock('../lexicon/OriginalLanguagePanel', () => ({
  OriginalLanguagePanel: (p: { verseId: string | null; reference: string | null }) => {
    langProps(p);
    return <div data-testid="original-language" />;
  },
}));
vi.mock('../lexicon/EtymologyPanel', () => ({
  EtymologyPanel: (p: { verseId: string | null }) => <div data-testid="etymology" data-verse={String(p.verseId)} />,
}));

import { ReferenceDoor } from './ReferenceDoor';

const BOOK = {
  book: 'psa', full_name: 'Psalm', author: 'David', author_note: 'ascribed to David',
  date_label: '~1000 BC', region: 'Israel', cultural_context: 'Temple worship',
  genre: 'Poetry', summary: 'A song of confidence.',
};
const XREF: CrossRefView = {
  to_book: 'heb', to_chapter: 11, to_verse_start: 6, to_verse_end: 6,
  votes: 42, crossesTestament: true, text: 'And without faith…',
};
const VOICE = {
  chunkId: 'c1', sourceId: 'treasury-of-david',
  sourceLabel: 'The Treasury of David · Charles H. Spurgeon, 1869–1885',
  tradition: 'Baptist (Reformed)', heading: 'Psalm 27:4', content: 'One thing have I desired.',
};

const props = { translation: 'BSB' as const, userId: 'u1', adapter: null };

beforeEach(() => {
  apparatus.mockReturnValue({ book: BOOK, crossRefs: [XREF], loading: false, error: null });
  libraryVoices.mockReturnValue({ voices: [VOICE], loading: false });
  langProps.mockClear();
});
afterEach(cleanup);

describe('ReferenceDoor', () => {
  it('renders book context, voices, original languages, and cross-references', () => {
    render(<ReferenceDoor scope={{ book: 'psa', chapter: 27, verse: 4 }} {...props} />);

    expect(screen.getByRole('heading', { name: 'Psalm' })).toBeTruthy();
    expect(screen.getByText(/VOICES FROM THE CHURCH/)).toBeTruthy();
    expect(screen.getByTestId('original-language')).toBeTruthy();
    expect(screen.getByText(/CROSS-REFERENCES/)).toBeTruthy();
  });

  it('scopes the language panels to the selected verse', () => {
    render(<ReferenceDoor scope={{ book: 'psa', chapter: 27, verse: 4 }} {...props} />);

    expect(langProps).toHaveBeenCalledWith({ verseId: 'psa.27.4', reference: 'Psalm 27:4' });
    expect(screen.getByTestId('etymology').getAttribute('data-verse')).toBe('psa.27.4');
  });

  it('clears the language panels at chapter scope — they are verse-level by nature', () => {
    render(<ReferenceDoor scope={{ book: 'psa', chapter: 27, verse: null }} {...props} />);

    expect(langProps).toHaveBeenCalledWith({ verseId: null, reference: null });
  });

  it('anchors the voices query on the selected verse', () => {
    render(<ReferenceDoor scope={{ book: 'psa', chapter: 27, verse: 4 }} {...props} />);

    expect(libraryVoices).toHaveBeenCalledWith({ book: 'psa', chapter: 27, verseStart: 4, verseEnd: 4 });
  });

  it('anchors the voices query on the whole chapter when no verse is chosen', () => {
    render(<ReferenceDoor scope={{ book: 'psa', chapter: 27, verse: null }} {...props} />);

    expect(libraryVoices).toHaveBeenCalledWith({ book: 'psa', chapter: 27 });
  });

  it('reads the apparatus in the active translation', () => {
    render(<ReferenceDoor scope={{ book: 'psa', chapter: 27, verse: 4 }} {...props} translation="KJV" />);

    expect(apparatus).toHaveBeenCalledWith('psa', 27, 'KJV');
  });

  it('omits the book card entirely when the apparatus has nothing', () => {
    apparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    const { container } = render(<ReferenceDoor scope={{ book: 'xyz', chapter: 1, verse: null }} {...props} />);

    expect(container.textContent).not.toContain('Author:');
    expect(container.textContent).not.toContain('undefined');
  });

  it('omits every optional section when nothing covers the passage — no placeholders', () => {
    apparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    libraryVoices.mockReturnValue({ voices: [], loading: false });
    const { container } = render(<ReferenceDoor scope={{ book: 'xyz', chapter: 1, verse: null }} {...props} />);

    expect(container.textContent).not.toContain('VOICES FROM THE CHURCH');
    expect(container.textContent).not.toContain('CROSS-REFERENCES');
    expect(container.textContent).not.toMatch(/no .* available/i);
  });

  it('names no tradition the corpus does not hold', () => {
    const { container } = render(<ReferenceDoor scope={{ book: 'psa', chapter: 27, verse: 4 }} {...props} />);

    expect(container.textContent).toContain('Baptist (Reformed)');
    expect(container.textContent).not.toMatch(/Orthodox|Catholic|Church Fathers|Jewish/);
  });
});
