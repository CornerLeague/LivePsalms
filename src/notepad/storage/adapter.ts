import type { Note, Folder } from '../types';

export interface StorageAdapter {
  getNotes(): Promise<Note[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note>;
  // Preserves the note's id, createdAt, and updatedAt — used by migration so
  // that `noteLink` marks embedded in content (which reference other notes by
  // their local id) keep resolving after the move to Supabase.
  importNote(note: Note): Promise<Note>;
  updateNote(id: string, updates: Partial<Note>): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  duplicateNote(id: string): Promise<Note>;

  getFolders(): Promise<Folder[]>;
  createFolder(folder: Omit<Folder, 'id'>): Promise<Folder>;
  importFolder(folder: Folder): Promise<Folder>;
  updateFolder(id: string, updates: Partial<Folder>): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  /** Find-or-create the per-user system Study folder. Idempotent. */
  ensureStudyFolder(): Promise<Folder>;
}
