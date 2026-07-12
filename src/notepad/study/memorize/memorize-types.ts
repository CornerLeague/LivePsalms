// src/notepad/study/memorize/memorize-types.ts
// Domain types + the persistence contract for Memorize cards. Unlike Focus Lists
// (which store ref-only), a card SNAPSHOTS the verse text + translation so a quiz
// stays stable even if the Reader's translation later changes. card = one verse.
import type { BibleTranslation } from '@/notepad/bible/translations';
import { bookByAbbrev } from '@/notepad/bible/bible-books';

export interface MemorizeCard {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  translation: BibleTranslation;
  /** Frozen snapshot of the verse text at add-time. */
  text: string;
  /** 0–100. */
  mastery: number;
  attempts: number;
  /** ISO timestamp; null until first practice. */
  lastPracticedAt: string | null;
  position: number;
}

export interface NewMemorizeCard {
  book: string;
  chapter: number;
  verse: number;
  translation: BibleTranslation;
  text: string;
}

/** The fields an attempt writes back to a card. */
export interface AttemptUpdate {
  mastery: number;
  attempts: number;
  lastPracticedAt: string;
}

/** CRUD contract. Two implementations: in-memory (tested) + Supabase. */
export interface MemorizeAdapter {
  list(): Promise<MemorizeCard[]>;
  /** No-op upsert: de-dupe on (book,chapter,verse,translation); NEVER resets an
      existing card's mastery. Returns only the newly-inserted cards. */
  add(cards: NewMemorizeCard[]): Promise<MemorizeCard[]>;
  updateAfterAttempt(id: string, update: AttemptUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Composite uniqueness key shared by every adapter + the guest path. */
export function cardKey(c: { book: string; chapter: number; verse: number; translation: string }): string {
  return `${c.book}|${c.chapter}|${c.verse}|${c.translation}`;
}

/** Display reference, e.g. 'John 3:16'. Falls back to the raw abbrev. */
export function formatCardRef(card: { book: string; chapter: number; verse: number }): string {
  const name = bookByAbbrev(card.book)?.name ?? card.book;
  return `${name} ${card.chapter}:${card.verse}`;
}
