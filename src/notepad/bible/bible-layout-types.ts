// src/notepad/bible/bible-layout-types.ts
// The verse layout for the Bible reader. Mirrors the theme/translation
// preference shape (a small types module paired with a persistence hook).
export type VerseLayout = 'inline' | 'lines' | 'spaced';

export const VERSE_LAYOUTS: readonly VerseLayout[] = ['inline', 'lines', 'spaced'] as const;
export const DEFAULT_VERSE_LAYOUT: VerseLayout = 'inline';

export function isVerseLayout(value: unknown): value is VerseLayout {
  return value === 'inline' || value === 'lines' || value === 'spaced';
}

/** The next mode in the cycle: inline -> lines -> spaced -> inline. */
export function nextVerseLayout(current: VerseLayout): VerseLayout {
  const i = VERSE_LAYOUTS.indexOf(current);
  return VERSE_LAYOUTS[(i + 1) % VERSE_LAYOUTS.length];
}

/** Human label for each mode (used in the control's title/aria-label). */
export const VERSE_LAYOUT_LABEL: Record<VerseLayout, string> = {
  inline: 'Inline',
  lines: 'Lines',
  spaced: 'Spaced',
};
