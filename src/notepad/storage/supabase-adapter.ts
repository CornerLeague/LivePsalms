import type { SupabaseClient } from '@supabase/supabase-js';
import type { Note, Folder } from '../types';
import type { StorageAdapter } from './adapter';
import { countWordsFromTipTapJSON } from '../utils/tiptap-text';
import { removeRecordingsForNote } from '../recordings/recordings-client';

/**
 * StorageAdapter backed by Supabase PostgreSQL.
 * All queries are automatically scoped to the authenticated user via RLS.
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  #client: SupabaseClient;
  #userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.#client = client;
    this.#userId = userId;
  }

  get scopeId(): string {
    return `user:${this.#userId}`;
  }

  // ── Notes ──────────────────────────────────────────────────────────

  async getNotes(): Promise<Note[]> {
    const { data, error } = await this.#client
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map(this.mapNote);
  }

  async getNote(id: string): Promise<Note | null> {
    const { data, error } = await this.#client
      .from('notes')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data ? this.mapNote(data) : null;
  }

  async createNote(
    note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Note> {
    const { data, error } = await this.#client
      .from('notes')
      .insert({
        user_id: this.#userId,
        title: note.title,
        content: note.content,
        folder_id: note.folderId === 'root' ? null : note.folderId,
        type: note.type,
        tags: note.tags,
        decorations: note.decorations ?? [],
        word_count: countWordsFromTipTapJSON(note.content),
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapNote(data);
  }

  async importNote(note: Note): Promise<Note> {
    // Preserve id, created_at, and updated_at so cross-note links embedded in
    // content (which reference notes by their original id) stay valid.
    const { data, error } = await this.#client
      .from('notes')
      .insert({
        id: note.id,
        user_id: this.#userId,
        title: note.title,
        content: note.content,
        folder_id: note.folderId === 'root' ? null : note.folderId,
        type: note.type,
        tags: note.tags,
        decorations: note.decorations ?? [],
        word_count: note.wordCount ?? countWordsFromTipTapJSON(note.content),
        created_at: note.createdAt,
        updated_at: note.updatedAt,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapNote(data);
  }

  async updateNote(id: string, updates: Partial<Note>): Promise<Note> {
    const mapped: Record<string, unknown> = {};
    if (updates.title !== undefined) mapped.title = updates.title;
    if (updates.content !== undefined) {
      mapped.content = updates.content;
      mapped.word_count = countWordsFromTipTapJSON(updates.content);
    }
    if (updates.folderId !== undefined) {
      mapped.folder_id = updates.folderId === 'root' ? null : updates.folderId;
    }
    if (updates.type !== undefined) mapped.type = updates.type;
    if (updates.tags !== undefined) mapped.tags = updates.tags;
    if (updates.decorations !== undefined) mapped.decorations = updates.decorations;

    const { data, error } = await this.#client
      .from('notes')
      .update(mapped)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapNote(data);
  }

  async deleteNote(id: string): Promise<void> {
    const { error } = await this.#client.from('notes').delete().eq('id', id);
    if (error) throw error;
    // DB rows cascade; storage objects don't. Best-effort — never blocks
    // deletion (removeRecordingsForNote never throws). Spec §1.
    await removeRecordingsForNote(this.#userId, id);
  }

  async duplicateNote(id: string): Promise<Note> {
    const original = await this.getNote(id);
    if (!original) throw new Error(`Note ${id} not found`);
    return this.createNote({
      title: `${original.title} (copy)`,
      content: original.content,
      folderId: original.folderId,
      type: original.type,
      tags: original.tags,
      decorations: original.decorations ?? [],
      wordCount: original.wordCount,
    });
  }

  // ── Folders ────────────────────────────────────────────────────────

  async getFolders(): Promise<Folder[]> {
    const { data, error } = await this.#client
      .from('folders')
      .select('*')
      .order('order', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(this.mapFolder);
  }

  async createFolder(folder: Omit<Folder, 'id'>): Promise<Folder> {
    const { data, error } = await this.#client
      .from('folders')
      .insert({
        user_id: this.#userId,
        name: folder.name,
        parent_id: folder.parentId,
        order: folder.order,
        icon: folder.icon ?? null,
        color: folder.color ?? null,
        kind: folder.kind ?? null,
        seeded_type: folder.seededType ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapFolder(data);
  }

  async importFolder(folder: Folder): Promise<Folder> {
    // Preserve id so notes that reference this folder via folderId stay linked.
    const { data, error } = await this.#client
      .from('folders')
      .insert({
        id: folder.id,
        user_id: this.#userId,
        name: folder.name,
        parent_id: folder.parentId,
        order: folder.order,
        icon: folder.icon ?? null,
        color: folder.color ?? null,
        kind: folder.kind ?? null,
        seeded_type: folder.seededType ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapFolder(data);
  }

  async updateFolder(id: string, updates: Partial<Folder>): Promise<Folder> {
    const mapped: Record<string, unknown> = {};
    if (updates.name !== undefined) mapped.name = updates.name;
    if (updates.parentId !== undefined) mapped.parent_id = updates.parentId;
    if (updates.order !== undefined) mapped.order = updates.order;
    if (updates.icon !== undefined) mapped.icon = updates.icon;
    if (updates.color !== undefined) mapped.color = updates.color;

    const { data, error } = await this.#client
      .from('folders')
      .update(mapped)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapFolder(data);
  }

  async deleteFolder(id: string): Promise<void> {
    // Move notes in this folder to root (null folder_id)
    await this.#client
      .from('notes')
      .update({ folder_id: null })
      .eq('folder_id', id);

    const { error } = await this.#client.from('folders').delete().eq('id', id);
    if (error) throw error;
  }

  async ensureStudyFolder(): Promise<Folder> {
    const existing = await this.#getStudyFolder();
    if (existing) return existing;

    const { data, error } = await this.#client
      .from('folders')
      .insert({
        user_id: this.#userId,
        name: 'Study',
        parent_id: null,
        order: 0,
        icon: 'book',
        color: null,
        kind: 'study',
      })
      .select()
      .single();

    // 23505 = unique_violation: another tab created it first. Re-fetch and use it.
    if (error?.code === '23505') {
      const raced = await this.#getStudyFolder();
      if (raced) return raced;
    }
    if (error) throw error;
    return this.mapFolder(data);
  }

  async #getStudyFolder(): Promise<Folder | null> {
    const { data, error } = await this.#client
      .from('folders')
      .select('*')
      .eq('kind', 'study')
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapFolder(data) : null;
  }

  // ── Mappers (snake_case DB → camelCase app) ────────────────────────

  mapNote = (row: Record<string, unknown>): Note => ({
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    folderId: (row.folder_id as string) ?? 'root',
    type: row.type as Note['type'],
    tags: (row.tags as string[]) ?? [],
    decorations: (row.decorations as Note['decorations']) ?? [],
    wordCount: (row.word_count as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  });

  mapFolder = (row: Record<string, unknown>): Folder => ({
    id: row.id as string,
    name: row.name as string,
    parentId: (row.parent_id as string) ?? null,
    order: row.order as number,
    icon: row.icon as Folder['icon'],
    color: row.color as string | undefined,
    kind: (row.kind as Folder['kind']) ?? undefined,
    seededType: (row.seeded_type as Folder['seededType']) ?? undefined,
  });
}
