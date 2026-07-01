// Map-backed FocusListAdapter: the tested reference implementation of the CRUD/
// ordering contract and the test double for useScriptureFocusLists. Returns deep
// copies so callers can mutate results without corrupting internal state.
import type { FocusList, FocusListAdapter, FocusListItem, ScriptureRef } from './focus-list-types';

function clone(list: FocusList): FocusList {
  return { ...list, items: list.items.map((i) => ({ ...i })) };
}

export class InMemoryFocusListAdapter implements FocusListAdapter {
  #lists = new Map<string, FocusList>();
  #seq = 0;

  constructor(seed: FocusList[] = []) {
    for (const l of seed) this.#lists.set(l.id, clone(l));
  }

  #id(prefix: string): string {
    this.#seq += 1;
    return `${prefix}-${this.#seq}`;
  }

  #toItems(refs: ScriptureRef[], startPosition: number): FocusListItem[] {
    return refs.map((r, idx) => ({ ...r, id: this.#id('item'), position: startPosition + idx }));
  }

  async listLists(): Promise<FocusList[]> {
    return [...this.#lists.values()]
      .sort((a, b) => a.position - b.position)
      .map(clone);
  }

  async createList(title: string, refs: ScriptureRef[]): Promise<FocusList> {
    const list: FocusList = {
      id: this.#id('list'),
      title,
      position: this.#lists.size,
      items: this.#toItems(refs, 0),
    };
    this.#lists.set(list.id, list);
    return clone(list);
  }

  async deleteList(id: string): Promise<void> {
    this.#lists.delete(id);
  }

  async renameList(id: string, title: string): Promise<void> {
    const list = this.#lists.get(id);
    if (!list) return;
    list.title = title;
  }

  async addItems(listId: string, refs: ScriptureRef[], startPosition: number): Promise<FocusListItem[]> {
    const list = this.#lists.get(listId);
    if (!list) throw new Error(`list ${listId} not found`);
    const items = this.#toItems(refs, startPosition);
    list.items.push(...items);
    return items.map((i) => ({ ...i }));
  }

  async removeItem(itemId: string): Promise<void> {
    for (const list of this.#lists.values()) {
      const idx = list.items.findIndex((i) => i.id === itemId);
      if (idx !== -1) { list.items.splice(idx, 1); return; }
    }
  }

  async reorderItems(listId: string, orderedItemIds: string[]): Promise<void> {
    const list = this.#lists.get(listId);
    if (!list) throw new Error(`list ${listId} not found`);
    const byId = new Map(list.items.map((i) => [i.id, i]));
    list.items = orderedItemIds
      .map((id, position) => {
        const item = byId.get(id);
        return item ? { ...item, position } : null;
      })
      .filter((i): i is FocusListItem => i !== null);
  }
}
