import { Observable } from './observable';
import { emitOnboardingEvent } from '../onboarding/onboarding-events';
import type { StorageAdapter } from '../storage/adapter';
import type { Folder, FolderIcon } from '../types';

export interface FolderHierarchyState {
  folders: Folder[];
  studyFolderId: string | null;
}

const EMPTY_STATE: FolderHierarchyState = { folders: [], studyFolderId: null };

export class FolderHierarchy extends Observable<FolderHierarchyState> {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter) {
    super(EMPTY_STATE);
    this.adapter = adapter;
  }

  async init(): Promise<void> {
    const folders = await this.adapter.getFolders();
    this.setState((prev) => ({ ...prev, folders }));
  }

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
