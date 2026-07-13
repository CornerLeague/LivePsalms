// src/notepad/study/memorize/supabase-memorize-adapter.ts
// Production MemorizeAdapter over the 049 table (RLS-scoped to the signed-in user).
// Thin pass-through; throws on error. The CRUD contract is proven by
// InMemoryMemorizeAdapter's tests. snake_case<->camelCase mapping lives ONLY here.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BibleTranslation } from '@/notepad/bible/translations';
import { cardKey, type AttemptUpdate, type MemorizeAdapter, type MemorizeCard, type NewMemorizeCard } from './memorize-types';

interface CardRow {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  text: string;
  mastery: number;
  attempts: number;
  last_practiced_at: string | null;
  position: number;
}

const CARD_COLS = 'id, book, chapter, verse, translation, text, mastery, attempts, last_practiced_at, position';

function toCard(r: CardRow): MemorizeCard {
  return {
    id: r.id,
    book: r.book,
    chapter: r.chapter,
    verse: r.verse,
    translation: r.translation as BibleTranslation,
    text: r.text,
    mastery: r.mastery,
    attempts: r.attempts,
    lastPracticedAt: r.last_practiced_at,
    position: r.position,
  };
}

export class SupabaseMemorizeAdapter implements MemorizeAdapter {
  #client: SupabaseClient;
  #userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.#client = client;
    this.#userId = userId;
  }

  async list(): Promise<MemorizeCard[]> {
    const { data, error } = await this.#client
      .from('memorize_cards')
      .select(CARD_COLS)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as CardRow[]).map(toCard);
  }

  async add(cards: NewMemorizeCard[]): Promise<MemorizeCard[]> {
    if (cards.length === 0) return [];
    // De-dupe against existing keys (the unique constraint below is the ultimate
    // guard against a race with a second concurrent instance — see useMemorizeCards,
    // which can run two of these adapters at once for the same user).
    const { data: existing, error: selErr } = await this.#client
      .from('memorize_cards')
      .select('book, chapter, verse, translation, position')
      .eq('user_id', this.#userId);
    if (selErr) throw selErr;
    const existingRows = (existing ?? []) as Array<
      { book: string; chapter: number; verse: number; translation: string; position: number }
    >;
    const seen = new Set(existingRows.map(cardKey));
    // Start strictly above the current max so a new card never ties an existing
    // position. `remove()` never renumbers, so the DB can hold gappy positions
    // (e.g. 0, 2) even though there are only 2 rows — `seen.size` would collide.
    let position = existingRows.length ? Math.max(...existingRows.map((r) => r.position)) + 1 : 0;
    const rows: Array<Record<string, unknown>> = [];
    for (const c of cards) {
      const k = cardKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({
        user_id: this.#userId,
        book: c.book, chapter: c.chapter, verse: c.verse,
        translation: c.translation, text: c.text,
        position: position++,
      });
    }
    if (rows.length === 0) return [];
    // Upsert + ignoreDuplicates turns a same-verse race between two concurrent
    // instances into a silent no-op (INSERT ... ON CONFLICT DO NOTHING) instead of
    // a thrown unique-violation that rolls back the WHOLE batch, including any
    // genuinely-new cards in the same call.
    const { data, error } = await this.#client
      .from('memorize_cards')
      .upsert(rows, { onConflict: 'user_id, book, chapter, verse, translation', ignoreDuplicates: true })
      .select(CARD_COLS);
    if (error) throw error;
    return ((data ?? []) as CardRow[]).map(toCard).sort((a, b) => a.position - b.position);
  }

  async updateAfterAttempt(id: string, update: AttemptUpdate): Promise<void> {
    const { error } = await this.#client
      .from('memorize_cards')
      .update({ mastery: update.mastery, attempts: update.attempts, last_practiced_at: update.lastPracticedAt })
      .eq('id', id);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.#client.from('memorize_cards').delete().eq('id', id);
    if (error) throw error;
  }
}
