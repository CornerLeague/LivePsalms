// src/notepad/study/memorize/in-memory-memorize-adapter.ts
// Map-backed MemorizeAdapter: the tested reference implementation of the CRUD
// contract and the test double for useMemorizeCards. Returns deep copies so
// callers can mutate results without corrupting internal state.
import { cardKey, type AttemptUpdate, type MemorizeAdapter, type MemorizeCard, type NewMemorizeCard } from './memorize-types';

function clone(c: MemorizeCard): MemorizeCard {
  return { ...c };
}

export class InMemoryMemorizeAdapter implements MemorizeAdapter {
  #cards = new Map<string, MemorizeCard>();
  #seq = 0;

  constructor(seed: MemorizeCard[] = []) {
    for (const c of seed) this.#cards.set(c.id, clone(c));
  }

  #id(): string {
    this.#seq += 1;
    return `card-${this.#seq}`;
  }

  async list(): Promise<MemorizeCard[]> {
    return [...this.#cards.values()].sort((a, b) => a.position - b.position).map(clone);
  }

  async add(cards: NewMemorizeCard[]): Promise<MemorizeCard[]> {
    const seen = new Set([...this.#cards.values()].map(cardKey));
    let position = this.#cards.size;
    const created: MemorizeCard[] = [];
    for (const nc of cards) {
      const k = cardKey(nc);
      if (seen.has(k)) continue; // no-op upsert: never touches the existing card
      seen.add(k);
      const card: MemorizeCard = {
        id: this.#id(),
        book: nc.book, chapter: nc.chapter, verse: nc.verse,
        translation: nc.translation, text: nc.text,
        mastery: 0, attempts: 0, lastPracticedAt: null, position,
      };
      position += 1;
      this.#cards.set(card.id, card);
      created.push(clone(card));
    }
    return created;
  }

  async updateAfterAttempt(id: string, update: AttemptUpdate): Promise<void> {
    const c = this.#cards.get(id);
    if (!c) return;
    c.mastery = update.mastery;
    c.attempts = update.attempts;
    c.lastPracticedAt = update.lastPracticedAt;
  }

  async remove(id: string): Promise<void> {
    this.#cards.delete(id);
  }
}
