// src/notepad/bible/text-size-types.ts
// The shared text-size preference for BOTH the Bible/Study reader and the
// Journal note editor. Mirrors the verse-layout preference shape (a small
// types module paired with a persistence hook) — see bible-layout-types.ts.
export type TextSize = 'base' | 'large' | 'xlarge';

export const TEXT_SIZES: readonly TextSize[] = ['base', 'large', 'xlarge'] as const;
export const DEFAULT_TEXT_SIZE: TextSize = 'base';

export function isTextSize(value: unknown): value is TextSize {
  return value === 'base' || value === 'large' || value === 'xlarge';
}

/** The next size in the cycle: base -> large -> xlarge -> base. */
export function nextTextSize(current: TextSize): TextSize {
  const i = TEXT_SIZES.indexOf(current);
  return TEXT_SIZES[(i + 1) % TEXT_SIZES.length];
}

/** Human label for each size (used in the control's title/aria-label and as its glyph). */
export const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  base: 'A',
  large: 'A+',
  xlarge: 'A++',
};

/** Shared scale factor applied to both the Bible/Study reader verse text and the
 *  Journal editor body text, so the two surfaces grow in lockstep. */
export const TEXT_SIZE_SCALE: Record<TextSize, number> = {
  base: 1,
  large: 1.15,
  xlarge: 1.3,
};
