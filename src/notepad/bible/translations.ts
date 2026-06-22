export type BibleTranslation = 'BSB' | 'KJV' | 'WEB';

export interface TranslationInfo {
  id: BibleTranslation;
  label: string;     // compact UI label, e.g. "BSB"
  fullName: string;  // e.g. "Berean Standard Bible"
  attribution: string;
}

export const TRANSLATIONS: readonly TranslationInfo[] = [
  { id: 'BSB', label: 'BSB', fullName: 'Berean Standard Bible',
    attribution: 'Berean Standard Bible — public domain.' },
  { id: 'KJV', label: 'KJV', fullName: 'King James Version',
    attribution: 'King James Version (1769) — public domain in the United States. In the United Kingdom the Crown holds perpetual letters patent.' },
  { id: 'WEB', label: 'WEB', fullName: 'World English Bible',
    attribution: 'World English Bible — public domain.' },
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
