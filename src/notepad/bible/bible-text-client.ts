// src/notepad/bible/bible-text-client.ts
//
// The browser side of the `bible-text` edge function: one chapter of an
// api-sourced translation (TranslationInfo.source === 'api'), as the same
// ReaderVerse[] shape the bible_passages query produces, plus a small
// session-memory cache.
//
// The cache is the ONLY place api-sourced text lives on the client — a Map
// that dies with the tab. It never touches localStorage, IndexedDB, or
// Postgres: the ESV free licence forbids storing more than 500 verses
// locally, and a handful of chapters in memory is how the reader stays under
// it while paging back and forth.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabase';
import type { InvokeFn } from './lamplight-chat-client';
import type { ReaderVerse } from './useBiblePassages';
import { type BibleTranslation, translationInfo } from './translations';

export interface BibleTextArgs {
  /** App OSIS book code, e.g. "psa". */
  book: string;
  chapter: number;
  translation: BibleTranslation;
}

export type BibleTextResult =
  | { ok: true; verses: ReaderVerse[] }
  | { ok: false; reason: string };

/** Chapters kept in session memory. Small on purpose (see header). */
export const BIBLE_TEXT_CACHE_MAX = 12;

const cache = new Map<string, ReaderVerse[]>();

export function clearBibleTextCache(): void {
  cache.clear();
}

/** Visible for tests: the number of chapters currently held. */
export function bibleTextCacheSize(): number {
  return cache.size;
}

function cacheKey(a: BibleTextArgs): string {
  return `${a.translation}.${a.book}.${a.chapter}`;
}

function remember(key: string, verses: ReaderVerse[]): void {
  // Map keeps insertion order, so the first key is the oldest.
  cache.delete(key);
  cache.set(key, verses);
  while (cache.size > BIBLE_TEXT_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function isReaderVerse(v: unknown): v is ReaderVerse {
  return typeof v === 'object' && v !== null
    && Number.isInteger((v as ReaderVerse).verse)
    && typeof (v as ReaderVerse).text === 'string';
}

/**
 * Fetch one chapter through `invoke` (the InvokeFn shape lamplight-chat-client
 * uses, so tests hand in a stub). A cache hit never calls `invoke`.
 */
export async function fetchBibleText(invoke: InvokeFn | null, args: BibleTextArgs): Promise<BibleTextResult> {
  const key = cacheKey(args);
  const hit = cache.get(key);
  if (hit) return { ok: true, verses: hit.map((v) => ({ ...v })) };
  if (!invoke) return { ok: false, reason: 'unavailable' };

  let data: unknown;
  let error: { message: string } | null;
  try {
    ({ data, error } = await invoke('bible-text', { body: { book: args.book, chapter: args.chapter, translation: args.translation } }));
  } catch (err) {
    return { ok: false, reason: `network: ${String(err)}` };
  }
  if (error) return { ok: false, reason: error.message };

  const d = data as { ok?: boolean; reason?: string; verses?: unknown } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  const verses = Array.isArray(d.verses) ? d.verses.filter(isReaderVerse).map((v) => ({ verse: v.verse, text: v.text })) : [];
  if (verses.length === 0) return { ok: false, reason: 'not_found' };
  remember(key, verses);
  return { ok: true, verses };
}

/**
 * An InvokeFn over supabase-js that turns the two HTTP statuses the reader
 * should name (401 sign-in, 429 quota) into reasons; everything else is
 * 'network'. Null when there is no Supabase client at all.
 */
export function makeBibleTextInvoke(client: SupabaseClient | null = defaultSupabase): InvokeFn | null {
  if (!client) return null;
  return async (name, options) => {
    const { data, error } = await client.functions.invoke(name, { body: options.body as Record<string, unknown> });
    if (!error) return { data, error: null };
    const status = (error as { context?: { status?: number } }).context?.status;
    const reason = status === 401 ? 'unauthorized' : status === 429 ? 'rate_limited' : 'network';
    return { data: null, error: { message: reason } };
  };
}

/** A sentence the reader can show next to a retry button. */
export function bibleTextErrorMessage(reason: string, translation: BibleTranslation): string {
  const { label, fullName } = translationInfo(translation);
  switch (reason) {
    case 'missing_key': return `The ${fullName} isn't connected on this server yet.`;
    case 'rate_limited': return `The ${label} service is busy right now. Try again in a minute.`;
    case 'unauthorized': return `Sign in to read the ${label}.`;
    case 'not_found': return `No ${label} text was found for this chapter.`;
    default: return `Couldn't reach the ${label} service. Check your connection and try again.`;
  }
}
