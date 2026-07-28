// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Folder } from '../types';
import { FolderItem } from './FolderItem';
import { TreeViewStateProvider } from './tree-view-state';

const STUDY: Folder = { id: 's1', name: 'Study', parentId: null, order: 0, icon: 'book', kind: 'study' };

function noop() {}

function renderFolder(isSystem: boolean) {
  return render(
    <TreeViewStateProvider>
      <FolderItem
        folder={STUDY}
        isSystem={isSystem}
        notes={[]}
        childFolders={[]}
        notesByFolder={new Map()}
        childFoldersByParent={new Map()}
        allFolders={[STUDY]}
        activeNoteId={null}
        onOpen={noop}
        onCreateNote={noop}
        onRenameNote={noop}
        onDuplicateNote={noop}
        onDeleteNote={noop}
        onMoveNote={noop}
        onRenameFolder={noop}
        onDeleteFolder={noop}
        onCreateSubfolder={noop}
      />
    </TreeViewStateProvider>,
  );
}

afterEach(() => cleanup());

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

describe('FolderItem isSystem', () => {
  it('hides Rename and Delete when isSystem — the app owns this folder', async () => {
    const user = userEvent.setup();
    renderFolder(true);
    await user.click(screen.getByLabelText(/folder options/i));
    expect(screen.queryByText('Rename')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
  });

  it('shows Rename, Delete, and New Note Inside for a normal folder', async () => {
    const user = userEvent.setup();
    renderFolder(false);
    await user.click(screen.getByLabelText(/folder options/i));
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('New Note Inside')).toBeInTheDocument();
  });

  // isSystem is about ownership (name + lifecycle), not about whether the
  // folder can hold new notes — the Study root takes a note like any other.
  it('keeps the row + button on a system folder', () => {
    renderFolder(true);
    expect(screen.getByLabelText('New note in Study')).toBeInTheDocument();
  });

  it('keeps New Note Inside on a system folder', async () => {
    const user = userEvent.setup();
    renderFolder(true);
    await user.click(screen.getByLabelText(/folder options/i));
    expect(screen.getByText('New Note Inside')).toBeInTheDocument();
  });

  it('creates into the system folder when its + is clicked', async () => {
    const user = userEvent.setup();
    const onCreateNote = vi.fn();
    render(
      <TreeViewStateProvider>
        <FolderItem
          folder={STUDY}
          isSystem
          notes={[]}
          childFolders={[]}
          notesByFolder={new Map()}
          childFoldersByParent={new Map()}
          allFolders={[STUDY]}
          activeNoteId={null}
          onOpen={noop}
          onCreateNote={onCreateNote}
          onRenameNote={noop}
          onDuplicateNote={noop}
          onDeleteNote={noop}
          onMoveNote={noop}
          onRenameFolder={noop}
          onDeleteFolder={noop}
          onCreateSubfolder={noop}
        />
      </TreeViewStateProvider>,
    );

    await user.click(screen.getByLabelText('New note in Study'));
    expect(onCreateNote).toHaveBeenCalledWith('s1', 'general');
  });
});
