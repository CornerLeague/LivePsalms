// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LamplightProvenancePanel } from './LamplightProvenancePanel';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ArtifactProvenance, LibrarySource } from '../../storage/lamplight-adapter';

afterEach(cleanup);

const FULL: ArtifactProvenance = {
  noteIds: ['n1', 'n2'],
  verses: ['Psalm 23:4', 'Romans 8:28'],
  librarySources: [
    { chunkId: 'lc1', sourceId: 'treasury-of-david', heading: 'Psalm 23:4' },
    { chunkId: 'lc2', sourceId: 'matthew-henry-concise', heading: 'Psalm 23' },
  ],
  modelUsed: 'gpt-5.6-terra',
  promptVersion: 'daily-devotion-2026-08-06-v4',
};

function source(over: Partial<LibrarySource>): LibrarySource {
  return {
    id: 'x', title: 'T', author: 'A', era: 'E', tradition: 'Tr',
    register: 'devotional', license: 'Public domain', attribution: 'credit', ...over,
  };
}

const SOURCES: LibrarySource[] = [
  source({ id: 'treasury-of-david', title: 'The Treasury of David', author: 'Charles H. Spurgeon', era: '1869–1885' }),
  source({ id: 'matthew-henry-concise', title: "Matthew Henry's Concise Commentary", author: 'Matthew Henry', era: '1706' }),
];

function setup(prov: ArtifactProvenance | null, opts: { titles?: Record<string, string> } = {}) {
  const adapter = new FakeLamplightAdapter();
  if (prov) adapter.__seedProvenance('u1', 'daily_devotion', '2026-08-07', prov);
  adapter.__seedNoteTitles(opts.titles ?? { n1: 'On rest', n2: 'Weariness' });
  adapter.__seedLibrarySources(SOURCES);
  return adapter;
}

function renderPanel(adapter: FakeLamplightAdapter) {
  return render(
    <LamplightProvenancePanel
      adapter={adapter}
      userId="u1"
      artifactType="daily_devotion"
      periodKey="2026-08-07"
    />,
  );
}

describe('LamplightProvenancePanel', () => {
  it('is closed by default — reassurance on demand, not clutter', async () => {
    renderPanel(setup(FULL));
    await screen.findByRole('button', { name: /how this was written/i });
    expect(screen.queryByText(/Drawn from your notes/i)).not.toBeInTheDocument();
  });

  it('gives the trigger an accessible name', async () => {
    renderPanel(setup(FULL));
    expect(await screen.findByRole('button', { name: /how this was written/i })).toBeInTheDocument();
  });

  it('renders note TITLES, never uuids', async () => {
    renderPanel(setup(FULL));
    await userEvent.click(await screen.findByRole('button', { name: /how this was written/i }));
    await waitFor(() => expect(screen.getByText('On rest')).toBeInTheDocument());
    expect(screen.getByText('Weariness')).toBeInTheDocument();
    expect(screen.queryByText(/^n1$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^n2$/)).not.toBeInTheDocument();
  });

  it('renders the scripture refs', async () => {
    renderPanel(setup(FULL));
    await userEvent.click(await screen.findByRole('button', { name: /how this was written/i }));
    // Exact match: 'Psalm 23:4' also appears inside a library heading below.
    await waitFor(() => expect(screen.getByText('Psalm 23:4')).toBeInTheDocument());
    expect(screen.getByText('Romans 8:28')).toBeInTheDocument();
  });

  it('renders library sources as label — heading', async () => {
    renderPanel(setup(FULL));
    await userEvent.click(await screen.findByRole('button', { name: /how this was written/i }));
    await waitFor(() => expect(screen.getByText(/Voices from the church/i)).toBeInTheDocument());
    expect(screen.getByText(/The Treasury of David.*—.*Psalm 23:4/)).toBeInTheDocument();
  });

  it('omits the library section ENTIRELY when the library never ran', async () => {
    renderPanel(setup({ ...FULL, librarySources: null }));
    await userEvent.click(await screen.findByRole('button', { name: /how this was written/i }));
    await waitFor(() => expect(screen.getByText('On rest')).toBeInTheDocument());
    expect(screen.queryByText(/Voices from the church/i)).not.toBeInTheDocument();
  });

  it('renders model and prompt version in a de-emphasized footer', async () => {
    renderPanel(setup(FULL));
    await userEvent.click(await screen.findByRole('button', { name: /how this was written/i }));
    await waitFor(() => expect(screen.getByText(/gpt-5.6-terra/)).toBeInTheDocument());
    expect(screen.getByText(/daily-devotion-2026-08-06-v4/)).toBeInTheDocument();
  });

  it('omits the notes section when the artifact cited none', async () => {
    renderPanel(setup({ ...FULL, noteIds: [] }));
    await userEvent.click(await screen.findByRole('button', { name: /how this was written/i }));
    await waitFor(() => expect(screen.getByText('Psalm 23:4')).toBeInTheDocument());
    expect(screen.queryByText(/Drawn from your notes/i)).not.toBeInTheDocument();
  });

  it('renders nothing at all when there is no provenance row', async () => {
    const { container } = renderPanel(setup(null));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('closes again on a second click', async () => {
    renderPanel(setup(FULL));
    const trigger = await screen.findByRole('button', { name: /how this was written/i });
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByText('On rest')).toBeInTheDocument());
    await userEvent.click(trigger);
    expect(screen.queryByText('On rest')).not.toBeInTheDocument();
  });

  it('falls back to the raw source id if a label is unavailable, rather than rendering blank', async () => {
    const adapter = setup({
      ...FULL,
      librarySources: [{ chunkId: 'lc9', sourceId: 'unregistered-source', heading: 'Psalm 1' }],
    });
    renderPanel(adapter);
    await userEvent.click(await screen.findByRole('button', { name: /how this was written/i }));
    await waitFor(() => expect(screen.getByText(/unregistered-source.*—.*Psalm 1/)).toBeInTheDocument());
  });
});
