export type BibleTranslation = 'BSB' | 'KJV' | 'WEB' | 'NLT' | 'ESV';

/**
 * Where a translation's text comes from.
 *
 *   'local' — rows in bible_passages (BSB, KJV, WEB — public domain, ingested
 *             once, searchable, embedded).
 *   'api'   — fetched on demand from the publisher's API through the
 *             `bible-text` edge function and cached only in browser session
 *             memory (NLT, ESV). NEVER written to bible_passages: the ESV free
 *             licence forbids storing more than 500 verses locally, and Psalm
 *             119 alone is 176. Consumers branch on this field, never on the
 *             translation id, so a future api-sourced translation is one
 *             registry entry, not a sweep of the codebase.
 */
export type TranslationSource = 'local' | 'api';

export interface TranslationInfo {
  id: BibleTranslation;
  label: string;     // compact UI label, e.g. "BSB"
  fullName: string;  // e.g. "Berean Standard Bible"
  attribution: string;
  source: TranslationSource;
}

export const TRANSLATIONS: readonly TranslationInfo[] = [
  { id: 'BSB', label: 'BSB', fullName: 'Berean Standard Bible', source: 'local',
    attribution: 'Berean Standard Bible — public domain.' },
  { id: 'KJV', label: 'KJV', fullName: 'King James Version', source: 'local',
    attribution: 'King James Version (1769) — public domain in the United States. In the United Kingdom the Crown holds perpetual letters patent.' },
  { id: 'WEB', label: 'WEB', fullName: 'World English Bible', source: 'local',
    attribution: 'World English Bible — public domain.' },
  { id: 'NLT', label: 'NLT', fullName: 'New Living Translation', source: 'api',
    attribution: 'Scripture quotations marked NLT are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.' },
  { id: 'ESV', label: 'ESV', fullName: 'English Standard Version', source: 'api',
    attribution: 'Scripture quotations marked ESV are from the ESV® Bible (The Holy Bible, English Standard Version®), copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.' },
];

export const DEFAULT_TRANSLATION: BibleTranslation = 'BSB';

const BY_ID = new Map(TRANSLATIONS.map((t) => [t.id, t]));

export function isBibleTranslation(v: unknown): v is BibleTranslation {
  return typeof v === 'string' && BY_ID.has(v as BibleTranslation);
}

export function translationInfo(id: BibleTranslation): TranslationInfo {
  const info = BY_ID.get(id);
  if (!info) throw new Error(`unknown translation: ${id}`);
  return info;
}

/**
 * The translation whose bible_passages rows stand in for `id` wherever the app
 * needs ROWS rather than display text: verse search (FTS + pericope
 * resolution), verse tooltips, and the Lamplight retrieval that already falls
 * back to BSB server-side. A 'local' translation stands in for itself; an
 * 'api' translation has no rows, so BSB does — and every surface that uses
 * this must say so visibly (owner rulings 2 and 4 in the NLT/ESV spec).
 */
export function passageRowsTranslation(id: BibleTranslation): BibleTranslation {
  return translationInfo(id).source === 'local' ? id : DEFAULT_TRANSLATION;
}
