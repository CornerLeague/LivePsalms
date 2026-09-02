// The translation ids the edge functions accept from a request body.
//
// One list, imported by lamplight-chat, lamplight-generate and lamplight-study.
// It used to be three byte-identical local copies, which is how a widening can
// reach one door and miss another. Keep it equal to the TRANSLATIONS registry
// in src/notepad/bible/translations.ts (parity-tested there).
//
// NLT and ESV are accepted here even though bible_passages holds no rows for
// them: retrieval and verification fall back to BSB per id (bible-passage.ts,
// verse-verify.ts) and say so in what they return, and the client labels the
// fallback visibly. Rejecting them would silently downgrade the reader's
// chosen translation to BSB with no label at all.
export const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB', 'NLT', 'ESV'] as const;
export type Translation = (typeof VALID_TRANSLATIONS)[number];

export function isValidTranslation(v: unknown): v is Translation {
  return typeof v === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(v);
}
