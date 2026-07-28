import { Observable } from './observable';
import { emitOnboardingEvent } from '../onboarding/onboarding-events';
import type { StorageAdapter } from '../storage/adapter';
import type { Folder, FolderIcon } from '../types';

export interface FolderHierarchyState {
  folders: Folder[];
  studyFolderId: string | null;
  /**
   * False until the initial `getFolders()` load resolves (and again while a
   * `rebindAdapter` reload is in flight). Lets consumers tell an empty folder
   * list apart from "folders haven't loaded yet" — e.g. so New Note doesn't file
   * a note at root just because it fired mid-load. See `resolveNewNoteFolderId`.
   */
  loaded: boolean;
}

const EMPTY_STATE: FolderHierarchyState = { folders: [], studyFolderId: null, loaded: false };

export class FolderHierarchy extends Observable<FolderHierarchyState> {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter) {
    super(EMPTY_STATE);
    this.adapter = adapter;
  }

  async init(): Promise<void> {
    try {
      const folders = await this.adapter.getFolders();
      this.setState((prev) => ({ ...prev, folders, loaded: true }));
    } catch (err) {
      // Mark the load settled even when it failed, then rethrow. `loaded` means
      // "the fetch finished", not "it succeeded" — without this a failed load
      // would leave `whenLoaded()` waiters hanging forever and New Note would
      // silently do nothing instead of falling back to root.
      this.setState((prev) => ({ ...prev, loaded: true }));
      throw err;
    }
  }

  /**
   * Resolves once the folder list has settled — immediately when it already
   * has, otherwise on the first state change that flips `loaded` to true.
   *
   * Lets callers that must not act on a mid-load snapshot wait it out: an empty
   * `folders` array before the load finishes is indistinguishable from an
   * account with no folders, so New Note awaits this rather than guessing and
   * permanently filing the note at root. See `resolveNewNoteFolderId`.
   */
  whenLoaded = (): Promise<FolderHierarchyState> => {
    const current = this.getSnapshot();
    if (current.loaded) return Promise.resolve(current);

    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(() => {
        const next = this.getSnapshot();
        if (!next.loaded) return;
        unsubscribe();
        resolve(next);
      });
    });
  };

  createFolder = async (
    name: string,
    parentId: string | null,
    icon?: FolderIcon,
    color?: string,
  ): Promise<Folder> => {
    const { folders } = this.getSnapshot();
    const order = folders.filter((f) => f.parentId === parentId).length;
    const created = await this.adapter.createFolder({ name, parentId, order, icon, color });
    this.setState((prev) => ({ ...prev, folders: [...prev.folders, created] }));
    emitOnboardingEvent('folder-created');
    return created;
  };

  ensureStudyFolder = async (): Promise<Folder> => {
    const folder = await this.adapter.ensureStudyFolder();
    this.setState((prev) => ({
      ...prev,
      folders: prev.folders.some((f) => f.id === folder.id)
        ? prev.folders.map((f) => (f.id === folder.id ? folder : f))
        : [...prev.folders, folder],
      studyFolderId: folder.id,
    }));
    return folder;
  };

  renameFolder = async (id: string, name: string): Promise<Folder> => {
    const updated = await this.adapter.updateFolder(id, { name });
    this.setState((prev) => ({
      ...prev,
      folders: prev.folders.map((f) => (f.id === id ? updated : f)),
    }));
    return updated;
  };

  deleteFolder = async (id: string): Promise<void> => {
    await this.adapter.deleteFolder(id);
    this.setState((prev) => ({
      ...prev,
      folders: prev.folders.filter((f) => f.id !== id),
    }));
  };

  rebindAdapter(next: StorageAdapter): void {
    this.adapter = next;
    this.setState(() => EMPTY_STATE);
  }
}
