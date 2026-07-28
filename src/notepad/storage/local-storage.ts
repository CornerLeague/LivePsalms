import { v4 as uuidv4 } from 'uuid';
import type { Note, Folder } from '../types';
import type { StorageAdapter } from './adapter';
import { countWordsFromTipTapJSON } from '../utils/tiptap-text';

const NOTES_KEY = 'notepad_notes';
const FOLDERS_KEY = 'notepad_folders';

export class LocalStorageAdapter implements StorageAdapter {
  /** Signed-out notes are per-device by definition — one scope. */
  readonly scopeId = 'local';

  private readNotes(): Note[] {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  private writeNotes(notes: Note[]): void {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }

  private readFolders(): Folder[] {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  private writeFolders(folders: Folder[]): void {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  }

  async getNotes(): Promise<Note[]> {
    return this.readNotes();
  }

  async getNote(id: string): Promise<Note | null> {
    return this.readNotes().find((n) => n.id === id) ?? null;
  }

  async createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> {
    const now = new Date().toISOString();
    const newNote: Note = {
      ...note,
      id: uuidv4(),
      wordCount: countWordsFromTipTapJSON(note.content),
      createdAt: now,
      updatedAt: now,
    };
    const notes = this.readNotes();
    notes.push(newNote);
    this.writeNotes(notes);
    return newNote;
  }

  async importNote(note: Note): Promise<Note> {
    const notes = this.readNotes().filter((n) => n.id !== note.id);
    notes.push(note);
    this.writeNotes(notes);
    return note;
  }

  async updateNote(id: string, updates: Partial<Note>): Promise<Note> {
    const notes = this.readNotes();
    const index = notes.findIndex((n) => n.id === id);
    if (index === -1) throw new Error(`Note ${id} not found`);
    const wordCount = updates.content !== undefined
      ? countWordsFromTipTapJSON(updates.content)
      : notes[index].wordCount;
    notes[index] = {
      ...notes[index],
      ...updates,
      wordCount,
      updatedAt: new Date().toISOString(),
    };
    this.writeNotes(notes);
    return notes[index];
  }

  async deleteNote(id: string): Promise<void> {
    this.writeNotes(this.readNotes().filter((n) => n.id !== id));
  }

  async duplicateNote(id: string): Promise<Note> {
    const note = this.readNotes().find((n) => n.id === id);
    if (!note) throw new Error(`Note ${id} not found`);
    const now = new Date().toISOString();
    const dup: Note = { ...note, id: uuidv4(), title: `${note.title} (copy)`, createdAt: now, updatedAt: now };
    const notes = this.readNotes();
    notes.push(dup);
    this.writeNotes(notes);
    return dup;
  }

  async getFolders(): Promise<Folder[]> {
    return this.readFolders();
  }

  async createFolder(folder: Omit<Folder, 'id'>): Promise<Folder> {
    const newFolder: Folder = { ...folder, id: uuidv4() };
    const folders = this.readFolders();
    folders.push(newFolder);
    this.writeFolders(folders);
    return newFolder;
  }

  async importFolder(folder: Folder): Promise<Folder> {
    const folders = this.readFolders().filter((f) => f.id !== folder.id);
    folders.push(folder);
    this.writeFolders(folders);
    return folder;
  }

  async updateFolder(id: string, updates: Partial<Folder>): Promise<Folder> {
    const folders = this.readFolders();
    const index = folders.findIndex((f) => f.id === id);
    if (index === -1) throw new Error(`Folder ${id} not found`);
    folders[index] = { ...folders[index], ...updates };
    this.writeFolders(folders);
    return folders[index];
  }

  async deleteFolder(id: string): Promise<void> {
    this.writeFolders(this.readFolders().filter((f) => f.id !== id));
    const notes = this.readNotes().map((n) => (n.folderId === id ? { ...n, folderId: 'root' } : n));
    this.writeNotes(notes);
  }

  async ensureStudyFolder(): Promise<Folder> {
    const existing = this.readFolders().find((f) => f.kind === 'study');
    if (existing) return existing;
    return this.createFolder({
      name: 'Study',
      parentId: null,
      order: 0,
      icon: 'book',
      kind: 'study',
    });
  }

  /**
   * Removes every Note and Folder this adapter owns from `localStorage`.
   * Used by the migration flow to drop the local copy after a successful
   * push to a remote adapter. Encapsulates the storage keys so callers
   * don't have to know them.
   */
  clearAll(): void {
    localStorage.removeItem(NOTES_KEY);
    localStorage.removeItem(FOLDERS_KEY);
  }
}

// Process-wide singleton. Use this everywhere instead of `new LocalStorageAdapter()`
// so that "the local adapter" is one named thing rather than an instance summoned
// at multiple callsites.
export const localAdapter = new LocalStorageAdapter();
