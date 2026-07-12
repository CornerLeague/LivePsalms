// src/notepad/study/memorize/in-memory-memorize-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryMemorizeAdapter } from './in-memory-memorize-adapter';
import type { NewMemorizeCard } from './memorize-types';

const nc = (verse: number, over: Partial<NewMemorizeCard> = {}): NewMemorizeCard => ({
  book: 'jhn', chapter: 3, verse, translation: 'BSB', text: `verse ${verse}`, ...over,
});

describe('InMemoryMemorizeAdapter', () => {
  it('adds cards with 0 mastery, incrementing positions, and lists them sorted', async () => {
    const a = new InMemoryMemorizeAdapter();
    const created = await a.add([nc(16), nc(17)]);
    expect(created.map((c) => [c.verse, c.position, c.mastery, c.attempts])).toEqual([[16, 0, 0, 0], [17, 1, 0, 0]]);
    const listed = await a.list();
    expect(listed.map((c) => c.verse)).toEqual([16, 17]);
  });

  it('de-dupes on (book,chapter,verse,translation) — re-add is a no-op and never resets mastery', async () => {
    const a = new InMemoryMemorizeAdapter();
    const [card] = await a.add([nc(16)]);
    await a.updateAfterAttempt(card.id, { mastery: 90, attempts: 1, lastPracticedAt: '2026-07-12T00:00:00.000Z' });
    const again = await a.add([nc(16), nc(18)]); // 16 already present, 18 is new
    expect(again.map((c) => c.verse)).toEqual([18]);
    const listed = await a.list();
    expect(listed).toHaveLength(2);
    expect(listed.find((c) => c.verse === 16)?.mastery).toBe(90); // NOT reset
  });

  it('treats a different translation as a distinct card', async () => {
    const a = new InMemoryMemorizeAdapter();
    await a.add([nc(16, { translation: 'BSB' })]);
    const created = await a.add([nc(16, { translation: 'KJV' })]);
    expect(created).toHaveLength(1);
    expect(await a.list()).toHaveLength(2);
  });

  it('updateAfterAttempt writes mastery/attempts/lastPracticedAt', async () => {
    const a = new InMemoryMemorizeAdapter();
    const [card] = await a.add([nc(16)]);
    await a.updateAfterAttempt(card.id, { mastery: 40, attempts: 1, lastPracticedAt: '2026-07-12T00:00:00.000Z' });
    const [reloaded] = await a.list();
    expect([reloaded.mastery, reloaded.attempts, reloaded.lastPracticedAt]).toEqual([40, 1, '2026-07-12T00:00:00.000Z']);
  });

  it('removes a card', async () => {
    const a = new InMemoryMemorizeAdapter();
    const [c1, c2] = await a.add([nc(16), nc(17)]);
    await a.remove(c1.id);
    expect((await a.list()).map((c) => c.verse)).toEqual([17]);
    expect(c2.verse).toBe(17);
  });

  it('returns deep copies so callers cannot mutate internal state', async () => {
    const a = new InMemoryMemorizeAdapter();
    await a.add([nc(16)]);
    const first = await a.list();
    first[0].mastery = 999;
    expect((await a.list())[0].mastery).toBe(0);
  });
});
