// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(cleanup);

const useApparatus = vi.fn();
vi.mock('../useApparatus', () => ({ useApparatus: (b: string, c: number, t: string) => useApparatus(b, c, t) }));

const panelProps = vi.fn();
vi.mock('../lexicon/OriginalLanguagePanel', () => ({
  OriginalLanguagePanel: (props: { verseId: string | null; reference: string | null }) => { panelProps(props); return null; },
}));

const regionMapBlock = vi.fn();
vi.mock('../regionmap/RegionMapBlock', () => ({
  RegionMapBlock: (props: { book: string }) => { regionMapBlock(props); return <div data-testid="region-map-block" />; },
}));

vi.mock('../lexicon/EtymologyPanel', () => ({
  EtymologyPanel: (props: Record<string, unknown>) => <div data-testid="etymology" data-verse={String(props.verseId)} data-user={String(props.userId)} />,
}));

import { ApparatusRail } from './ApparatusRail';

describe('ApparatusRail', () => {
  it('renders the book card and flags OT<->NT cross refs', () => {
    useApparatus.mockReturnValue({
      book: { full_name: 'Isaiah', author: 'Isaiah', author_note: 'authorship debated', date_label: '~700 BC', region: 'Judah', cultural_context: 'Assyrian crisis', genre: 'Prophecy', summary: 'Judgment and comfort.' },
      crossRefs: [{ to_book: 'mat', to_chapter: 1, to_verse_start: 23, to_verse_end: 23, votes: 50, crossesTestament: true, text: 'the virgin will conceive' }],
      loading: false, error: null,
    });
    render(<ApparatusRail translation="BSB" book="isa" chapter={7} />);
    expect(screen.getByText('Isaiah')).toBeTruthy();
    expect(screen.getByText(/authorship debated/)).toBeTruthy();
    expect(screen.getByText(/OT ↔ NT/)).toBeTruthy();
  });
  it('hides the book card when metadata is absent (degrades quietly)', () => {
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    const { container } = render(<ApparatusRail translation="BSB" book="xyz" chapter={1} />);
    expect(container.textContent).not.toContain('undefined');
  });
  it('renders the region map block between book context and cross-references', () => {
    regionMapBlock.mockClear();
    useApparatus.mockReturnValue({
      book: { full_name: 'Lamentations', author: 'Jeremiah', author_note: '', date_label: '~586 BC', region: 'Judah', cultural_context: '', genre: 'Lament', summary: 'Grief over fallen Jerusalem.' },
      crossRefs: [{ to_book: 'mat', to_chapter: 1, to_verse_start: 1, to_verse_end: 1, votes: 1, crossesTestament: true, text: 't' }],
      loading: false, error: null,
    });
    render(<ApparatusRail translation="BSB" book="lam" chapter={1} />);
    expect(regionMapBlock).toHaveBeenCalledWith({ book: 'lam' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Lamentations' });
    const block = screen.getByTestId('region-map-block');
    const xrefs = screen.getByRole('heading', { level: 3, name: 'CROSS-REFERENCES' });
    // DOM order: context heading → region map block → cross-references heading
    expect(heading.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(xrefs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ApparatusRail original-language panel', () => {
  it('passes the selected verse to OriginalLanguagePanel as an OSIS verseId + reference', () => {
    panelProps.mockReset();
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    render(<ApparatusRail translation="BSB" book="jhn" chapter={3} selectedVerse={16} />);
    expect(panelProps).toHaveBeenCalledWith({ verseId: 'jhn.3.16', reference: 'John 3:16' });
  });

  it('passes null verseId when no verse is selected', () => {
    panelProps.mockReset();
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    render(<ApparatusRail translation="BSB" book="jhn" chapter={3} selectedVerse={null} />);
    expect(panelProps).toHaveBeenCalledWith({ verseId: null, reference: null });
  });

  it('still renders the book apparatus alongside the panel', () => {
    panelProps.mockReset();
    useApparatus.mockReturnValue({
      book: { full_name: 'John', author: 'John', author_note: '', date_label: '', region: '', cultural_context: '', genre: '', summary: 'The Word.' },
      crossRefs: [], loading: false, error: null,
    });
    render(<ApparatusRail translation="BSB" book="jhn" chapter={3} selectedVerse={null} />);
    expect(screen.getByRole('heading', { level: 2, name: 'John' })).toBeTruthy();
  });
});

describe('ApparatusRail etymology panel', () => {
  it('mounts EtymologyPanel with the OSIS verseId and threaded userId', () => {
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    render(<ApparatusRail translation="BSB" book="psa" chapter={23} selectedVerse={1} userId="u1" adapter={null} />);
    const panel = screen.getByTestId('etymology');
    expect(panel).toHaveAttribute('data-verse', 'psa.23.1');
    expect(panel).toHaveAttribute('data-user', 'u1');
  });
});
