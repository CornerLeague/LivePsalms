// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NoteCollection } from '../../collection/note-collection';
import { FolderHierarchy } from '../../collection/folder-hierarchy';
import { FakeStorageAdapter } from '../../collection/fake-storage-adapter';
import { NoteCollectionContext } from '../../context/useNoteCollection';
import { FolderHierarchyContext } from '../../context/useFolderHierarchy';

vi.mock('@/notepad/components/Editor', () => ({ NotepadEditor: () => <div>editor</div> }));
vi.mock('./LamplightStudyPanel', () => ({ LamplightStudyPanel: () => <div>chat-panel</div> }));
vi.mock('../memorize/MemorizePanel', () => ({ MemorizePanel: () => <div>memorize-panel</div> }));

import { StudySidePanel } from './StudySidePanel';

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(cleanup);

describe('StudySidePanel', () => {
  let adapter: FakeStorageAdapter;
  let collection: NoteCollection;
  let hierarchy: FolderHierarchy;

  beforeEach(() => {
    adapter = new FakeStorageAdapter();
    collection = new NoteCollection(adapter);
    hierarchy = new FolderHierarchy(adapter);
  });

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <NoteCollectionContext.Provider value={collection}>
        <FolderHierarchyContext.Provider value={hierarchy}>
          {children}
        </FolderHierarchyContext.Provider>
      </NoteCollectionContext.Provider>
    );
  }

  it('offers the Insights door and opens it on click', () => {
    const onOpenInsights = vi.fn();
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" onOpenInsights={onOpenInsights} />, { wrapper });

    const door = screen.getByRole('button', { name: /open insights/i });
    fireEvent.click(door);
    expect(onOpenInsights).toHaveBeenCalledOnce();
  });

  it('reads as a door rather than a fourth tab', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" onOpenInsights={vi.fn()} />, { wrapper });

    expect(screen.getByRole('button', { name: /open insights/i }).getAttribute('role')).not.toBe('tab');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('hides the Insights door when the host offers no handler', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    expect(screen.queryByRole('button', { name: /open insights/i })).toBeNull();
  });

  it('defaults to the Notes tab (aria-selected true) and Chat tab false', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    expect(screen.getByRole('tab', { name: /notes/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /chat/i }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking the Chat tab switches selection', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    expect(screen.getByRole('tab', { name: /chat/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /notes/i }).getAttribute('aria-selected')).toBe('false');
  });

  it('Notes pane shows setup state before the Study folder exists', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    expect(screen.getByText(/setting up your study folder/i)).toBeInTheDocument();
  });

  it('Notes pane shows the Study tree after ensureStudyFolder', async () => {
    await hierarchy.ensureStudyFolder();
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('Study')).toBeInTheDocument());
  });

  it('renders expand + collapse controls and fires their callbacks', () => {
    const onToggleExpand = vi.fn();
    const onCollapse = vi.fn();
    render(
      <StudySidePanel
        book="jhn"
        chapter={10}
        userId="u1"
        expanded={false}
        onToggleExpand={onToggleExpand}
        onCollapse={onCollapse}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /expand panel/i }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /collapse panel/i }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('shows a shrink control when expanded', () => {
    render(
      <StudySidePanel book="jhn" chapter={10} userId="u1" expanded onToggleExpand={vi.fn()} onCollapse={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /shrink panel/i })).toBeInTheDocument();
  });

  it('omits the controls when no layout callbacks are provided', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    expect(screen.queryByRole('button', { name: /expand panel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /collapse panel/i })).toBeNull();
  });

  it('renders a Memorize tab, unselected by default', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    expect(screen.getByRole('tab', { name: /memorize/i }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking the Memorize tab switches selection and shows the panel', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />, { wrapper });
    fireEvent.click(screen.getByRole('tab', { name: /memorize/i }));
    expect(screen.getByRole('tab', { name: /memorize/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /notes/i }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('memorize-panel')).toBeInTheDocument();
  });
});
