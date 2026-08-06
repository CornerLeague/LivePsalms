// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SourcesSection } from './SourcesSection';
import { FakeLamplightAdapter } from '@/notepad/storage/fake-lamplight-adapter';
import type { LibrarySource } from '@/notepad/storage/lamplight-adapter';

afterEach(cleanup);

function source(over: Partial<LibrarySource>): LibrarySource {
  return {
    id: 'x', title: 'T', author: 'A', era: 'E', tradition: 'Reformed',
    register: 'devotional', license: 'Public domain', attribution: 'credit line', ...over,
  };
}

const SOURCES: LibrarySource[] = [
  source({
    id: 'treasury-of-david', title: 'The Treasury of David', author: 'Charles H. Spurgeon',
    era: '1869–1885', license: 'Public domain',
    attribution: 'The Treasury of David by Charles H. Spurgeon. Public domain.',
  }),
  source({
    id: 'openbible-topics', title: 'OpenBible Topical Scores', author: 'OpenBible.info',
    era: '2023', license: 'CC BY 4.0',
    attribution: 'Topical data © OpenBible.info, licensed CC BY 4.0 — https://openbible.info',
  }),
];

function setup(sources: LibrarySource[]) {
  const adapter = new FakeLamplightAdapter();
  adapter.__seedLibrarySources(sources);
  return render(<SourcesSection adapter={adapter} />);
}

describe('SourcesSection', () => {
  it('renders each source with title, author and era', async () => {
    setup(SOURCES);
    // Exact: the title also appears inside the verbatim attribution line below.
    await waitFor(() =>
      expect(screen.getByText('The Treasury of David — Charles H. Spurgeon, 1869–1885'))
        .toBeInTheDocument());
    expect(screen.getByText('OpenBible Topical Scores — OpenBible.info, 2023')).toBeInTheDocument();
  });

  it('renders the attribution string VERBATIM — this is the licence obligation', async () => {
    setup(SOURCES);
    await waitFor(() =>
      expect(screen.getByText('Topical data © OpenBible.info, licensed CC BY 4.0 — https://openbible.info'))
        .toBeInTheDocument());
  });

  it('groups sources by licence', async () => {
    setup(SOURCES);
    await waitFor(() => expect(screen.getByText('Public domain')).toBeInTheDocument());
    expect(screen.getByText('CC BY 4.0')).toBeInTheDocument();
  });

  it('renders a short empty state rather than a broken heading when nothing is ingested', async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText(/No sources yet/i)).toBeInTheDocument());
    expect(screen.queryByText('Public domain')).not.toBeInTheDocument();
  });

  it('survives a failed read without breaking the settings page', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.getLibrarySources = () => Promise.reject(new Error('offline'));
    render(<SourcesSection adapter={adapter} />);
    await waitFor(() => expect(screen.getByText(/No sources yet/i)).toBeInTheDocument());
  });

  it('names the section so a reader can find the credits', async () => {
    setup(SOURCES);
    await waitFor(() => expect(screen.getByText(/^SOURCES$/)).toBeInTheDocument());
  });
});
