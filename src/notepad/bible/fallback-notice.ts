// src/notepad/bible/fallback-notice.ts
//
// The sentences that make the BSB stand-in VISIBLE for an api-sourced
// translation. bible_passages has no NLT/ESV rows, so verse search, verse
// tooltips and Lamplight's retrieval all read BSB text while the reader shows
// NLT or ESV. That is deliberate (owner rulings 2 and 4 in the NLT/ESV spec);
// doing it silently was the bug. Each surface calls its own helper and shows
// the string when it is non-null — for a local translation every helper
// returns null, so those surfaces render exactly as before.

import { type BibleTranslation, passageRowsTranslation, translationInfo } from './translations';

function pair(id: BibleTranslation): { shown: string; rows: string } | null {
  const rows = passageRowsTranslation(id);
  if (rows === id) return null;
  return { shown: translationInfo(id).label, rows: translationInfo(rows).label };
}

/** Under the verse-search box and in the picker dropdown. */
export function searchFallbackNotice(id: BibleTranslation): string | null {
  const p = pair(id);
  return p && `Results are ${p.rows} text — ${p.shown} can't be searched.`;
}

/** In the reader's translation-info tooltip and the settings picker. */
export function readerFallbackNotice(id: BibleTranslation): string | null {
  const p = pair(id);
  return p && `Verse search, verse previews and Lamplight use the ${p.rows} for this version.`;
}

/** Under the Lamplight chat. */
export function lamplightFallbackNotice(id: BibleTranslation): string | null {
  const p = pair(id);
  return p && `Lamplight quotes Scripture from the ${p.rows}, not the ${p.shown}.`;
}
