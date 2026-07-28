import type { StorageAdapter } from '../storage/adapter';
import type { Note, Folder } from '../types';

let idCounter = 0;
const nextId = () => `id-${++idCounter}`;

export function resetFakeAdapterIds(): void {
  idCounter = 0;
}

export class FakeStorageAdapter implements StorageAdapter {
  notes: Note[] = [];
  folders: Folder[] = [];
  scopeId = 'fake';

  async getNotes(): Promise<Note[]> {
    return this.notes.slice();
  }

  async getNote(id: string): Promise<Note | null> {
    return this.notes.find((n) => n.id === id) ?? null;
  }

  async createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> {
    const now = new Date().toISOString();
    const created: Note = { ...note, id: nextId(), createdAt: now, updatedAt: now };
    this.notes.push(created);
    return { ...created };
  }

  async importNote(note: Note): Promise<Note> {
    this.notes = this.notes.filter((n) => n.id !== note.id);
    this.notes.push(note);
    return { ...note };
  }

  async updateNote(id: string, updates: Partial<Note>): Promise<Note> {
    const index = this.notes.findIndex((n) => n.id === id);
    if (index === -1) throw new Error(`Note ${id} not found`);
    const updated: Note = {
      ...this.notes[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.notes[index] = updated;
    return { ...updated };
  }

  async deleteNote(id: string): Promise<void> {
    this.notes = this.notes.filter((n) => n.id !== id);
  }

  async duplicateNote(id: string): Promise<Note> {
    const original = this.notes.find((n) => n.id === id);
    if (!original) throw new Error(`Note ${id} not found`);
    const now = new Date().toISOString();
    const dup: Note = { ...original, id: nextId(), title: `${original.title} (copy)`, createdAt: now, updatedAt: now };
    this.notes.push(dup);
    return { ...dup };
  }

  async getFolders(): Promise<Folder[]> {
    return this.folders.slice();
  }

  async createFolder(folder: Omit<Folder, 'id'>): Promise<Folder> {
    const created: Folder = { ...folder, id: nextId() };
    this.folders.push(created);
    return { ...created };
  }

  async importFolder(folder: Folder): Promise<Folder> {
    this.folders = this.folders.filter((f) => f.id !== folder.id);
    this.folders.push(folder);
    return { ...folder };
  }

  async updateFolder(id: string, updates: Partial<Folder>): Promise<Folder> {
    const index = this.folders.findIndex((f) => f.id === id);
    if (index === -1) throw new Error(`Folder ${id} not found`);
    const updated: Folder = { ...this.folders[index], ...updates };
    this.folders[index] = updated;
    return { ...updated };
  }

  async deleteFolder(id: string): Promise<void> {
    this.folders = this.folders.filter((f) => f.id !== id);
    this.notes = this.notes.map((n) => (n.folderId === id ? { ...n, folderId: 'root' } : n));
  }

  async ensureStudyFolder(): Promise<Folder> {
    const existing = this.folders.find((f) => f.kind === 'study');
    if (existing) return { ...existing };
    return this.createFolder({
      name: 'Study',
      parentId: null,
      order: 0,
      icon: 'book',
      kind: 'study',
    });
  }
}
