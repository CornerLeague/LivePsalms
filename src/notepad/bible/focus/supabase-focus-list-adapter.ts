// Production FocusListAdapter over the 042 tables (RLS-scoped to the signed-in
// user). Thin pass-through, mirroring supabase-bible-highlight-adapter.ts. The
// CRUD/ordering contract is proven by InMemoryFocusListAdapter's tests.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FocusList, FocusListAdapter, FocusListItem, ScriptureRef } from './focus-list-types';

interface ListRow { id: string; title: string; position: number; }
interface ItemRow {
  id: string; list_id: string; book: string; chapter: number;
  verse_start: number; verse_end: number; label: string; position: number;
}

function toItem(r: ItemRow): FocusListItem {
  return {
    id: r.id, book: r.book, chapter: r.chapter,
    verseStart: r.verse_start, verseEnd: r.verse_end, label: r.label, position: r.position,
  };
}

export class SupabaseFocusListAdapter implements FocusListAdapter {
  #client: SupabaseClient;
  #userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.#client = client;
    this.#userId = userId;
  }

  async listLists(): Promise<FocusList[]> {
    const { data: lists, error: lErr } = await this.#client
      .from('scripture_focus_lists')
      .select('id, title, position')
      .order('position', { ascending: true });
    if (lErr) throw lErr;
    const listRows = (lists ?? []) as ListRow[];
    if (listRows.length === 0) return [];

    const { data: items, error: iErr } = await this.#client
      .from('scripture_focus_list_items')
      .select('id, list_id, book, chapter, verse_start, verse_end, label, position')
      .in('list_id', listRows.map((l) => l.id))
      .order('position', { ascending: true });
    if (iErr) throw iErr;
    const itemRows = (items ?? []) as ItemRow[];

    return listRows.map((l) => ({
      id: l.id,
      title: l.title,
      position: l.position,
      items: itemRows.filter((i) => i.list_id === l.id).map(toItem),
    }));
  }

  async createList(title: string, refs: ScriptureRef[]): Promise<FocusList> {
    const { data: list, error: lErr } = await this.#client
      .from('scripture_focus_lists')
      .insert({ user_id: this.#userId, title })
      .select('id, title, position')
      .single();
    if (lErr) throw lErr;
    const row = list as ListRow;

    const created: FocusList = { id: row.id, title: row.title, position: row.position, items: [] };
    if (refs.length > 0) created.items = await this.addItems(row.id, refs, 0);
    return created;
  }

  async deleteList(id: string): Promise<void> {
    const { error } = await this.#client.from('scripture_focus_lists').delete().eq('id', id);
    if (error) throw error;
  }

  async addItems(listId: string, refs: ScriptureRef[], startPosition: number): Promise<FocusListItem[]> {
    if (refs.length === 0) return [];
    const rows = refs.map((r, idx) => ({
      list_id: listId, book: r.book, chapter: r.chapter,
      verse_start: r.verseStart, verse_end: r.verseEnd, label: r.label,
      position: startPosition + idx,
    }));
    const { data, error } = await this.#client
      .from('scripture_focus_list_items')
      .insert(rows)
      .select('id, list_id, book, chapter, verse_start, verse_end, label, position');
    if (error) throw error;
    return ((data ?? []) as ItemRow[]).map(toItem).sort((a, b) => a.position - b.position);
  }

  async removeItem(itemId: string): Promise<void> {
    const { error } = await this.#client.from('scripture_focus_list_items').delete().eq('id', itemId);
    if (error) throw error;
  }

  async reorderItems(_listId: string, orderedItemIds: string[]): Promise<void> {
    // Renumber positions densely. One update per item keeps it simple and RLS-safe;
    // lists are short (a service's worth of verses), so the round-trip count is fine.
    for (let position = 0; position < orderedItemIds.length; position += 1) {
      const { error } = await this.#client
        .from('scripture_focus_list_items')
        .update({ position })
        .eq('id', orderedItemIds[position]);
      if (error) throw error;
    }
  }
}
