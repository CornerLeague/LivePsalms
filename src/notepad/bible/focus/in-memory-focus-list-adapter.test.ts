import { describe, it, expect } from 'vitest';
import { InMemoryFocusListAdapter } from './in-memory-focus-list-adapter';
import type { ScriptureRef } from './focus-list-types';

const ref = (label: string): ScriptureRef => ({
  book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label,
});

describe('InMemoryFocusListAdapter', () => {
  it('creates a list with items in order and lists it back', async () => {
    const a = new InMemoryFocusListAdapter();
    const created = await a.createList('Sunday AM', [ref('a'), ref('b')]);
    expect(created.title).toBe('Sunday AM');
    expect(created.items.map((i) => [i.label, i.position])).toEqual([['a', 0], ['b', 1]]);

    const lists = await a.listLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].id).toBe(created.id);
  });

  it('appends items after the existing ones using startPosition', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a')]);
    const added = await a.addItems(list.id, [ref('b'), ref('c')], 1);
    expect(added.map((i) => i.position)).toEqual([1, 2]);
    const [reloaded] = await a.listLists();
    expect(reloaded.items.map((i) => i.label)).toEqual(['a', 'b', 'c']);
  });

  it('removes an item', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a'), ref('b')]);
    await a.removeItem(list.items[0].id);
    const [reloaded] = await a.listLists();
    expect(reloaded.items.map((i) => i.label)).toEqual(['b']);
  });

  it('reorders items to match the given id order and renumbers positions', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a'), ref('b'), ref('c')]);
    const [ia, ib, ic] = list.items;
    await a.reorderItems(list.id, [ic.id, ia.id, ib.id]);
    const [reloaded] = await a.listLists();
    expect(reloaded.items.map((i) => [i.label, i.position])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
  });

  it('deletes a list', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', []);
    await a.deleteList(list.id);
    expect(await a.listLists()).toEqual([]);
  });

  it('returns deep copies so callers cannot mutate internal state', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a')]);
    list.items[0].label = 'MUTATED';
    const [reloaded] = await a.listLists();
    expect(reloaded.items[0].label).toBe('a');
  });
});
