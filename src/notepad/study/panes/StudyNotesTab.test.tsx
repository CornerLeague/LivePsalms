// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Note } from '../../types';
import type { ReactNode } from 'react';
import { NoteCollection } from '../../collection/note-collection';
import { FolderHierarchy } from '../../collection/folder-hierarchy';
import { FakeStorageAdapter } from '../../collection/fake-storage-adapter';
import { NoteCollectionContext } from '../../context/useNoteCollection';
import { FolderHierarchyContext } from '../../context/useFolderHierarchy';
import { StudyNotesTab } from './StudySidePanel';

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

afterEach(() => cleanup());

describe('StudyNotesTab', () => {
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

  it('shows a setup state before the Study folder exists', () => {
    render(<StudyNotesTab />, { wrapper });
    expect(screen.getByText(/setting up your study folder/i)).toBeInTheDocument();
  });

  it('renders the Study root and a note inside it', async () => {
    await hierarchy.ensureStudyFolder();
    const studyId = hierarchy.getSnapshot().studyFolderId!;
    await collection.createNote(studyId, 'general');
    // createNote auto-opens the note; close it so we render the tree branch (not the editor)
    collection.openNote(null);
    await collection.refetchAll();
    await collection.updateNote(collection.getSnapshot().notes[0].id, { title: 'My study note' });

    render(<StudyNotesTab />, { wrapper });
    await waitFor(() => expect(screen.getByText('Study')).toBeInTheDocument());
    expect(screen.getByText('My study note')).toBeInTheDocument();
  });

  it('docks a New note button that creates a general note in the Study root', async () => {
    await hierarchy.ensureStudyFolder();
    const studyId = hierarchy.getSnapshot().studyFolderId!;
    // Stub createNote so the click doesn't auto-open a note (which would render TipTap).
    const create = vi.spyOn(collection, 'createNote').mockResolvedValue({} as Note);

    render(<StudyNotesTab />, { wrapper });
    await waitFor(() => expect(screen.getByText('Study')).toBeInTheDocument());

    // Exact name — the Study root row now carries its own "New note in Study"
    // + button, so a loose /new note/i would match both.
    await userEvent.click(screen.getByRole('button', { name: 'New note' }));
    expect(create).toHaveBeenCalledWith(studyId, 'general');
  });

  it('also offers a + on the Study root row that creates into it', async () => {
    await hierarchy.ensureStudyFolder();
    const studyId = hierarchy.getSnapshot().studyFolderId!;
    const create = vi.spyOn(collection, 'createNote').mockResolvedValue({} as Note);

    render(<StudyNotesTab />, { wrapper });
    await waitFor(() => expect(screen.getByText('Study')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New note in Study' }));
    expect(create).toHaveBeenCalledWith(studyId, 'general');
  });

  it('offers a + on folders created inside Study', async () => {
    await hierarchy.ensureStudyFolder();
    const studyId = hierarchy.getSnapshot().studyFolderId!;
    const sub = await hierarchy.createFolder('Romans deep dive', studyId);
    const create = vi.spyOn(collection, 'createNote').mockResolvedValue({} as Note);

    render(<StudyNotesTab />, { wrapper });
    await waitFor(() => expect(screen.getByText('Romans deep dive')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New note in Romans deep dive' }));
    expect(create).toHaveBeenCalledWith(sub.id, 'general');
  });
});
