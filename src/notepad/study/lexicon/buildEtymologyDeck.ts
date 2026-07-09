import { normalizeStrongs } from './normalizeStrongs';
import type { InterlinearWord } from './useVerseLexicon';

export interface RelatedWord {
  strongs: string;
  word: string;
  gloss: string;
}

export interface EtymologyEntry {
  strongs: string;
  lemma: string;
  root: string;
  rootGloss: string;
  development: string;
  related: RelatedWord[];
  studyValue: number;
  source: string;
}

export type EtymologyDeckCard =
  | { kind: 'lexical'; position: number; strongs: string; entry: EtymologyEntry; word: InterlinearWord; starred: boolean }
  | { kind: 'function'; position: number; word: InterlinearWord };

// Parts of speech that earn a full etymology card. Everything else (conjunction,
// adverb, pronoun, preposition, particle, suffix, unknown) is a grammar-note-only
// function-word card, keeping reading order intact without inventing etymology.
const LEXICAL_POS = new Set(['N', 'V', 'A']);
const MAX_STARS = 4;

/**
 * A token is a function word unless the POS letter of its morphology's first
 * `/`-segment is Noun/Verb/Adjective. The POS letter sits right after the
 * H/A/G language prefix, so it is char index 1 of that segment.
 */
export function isFunctionWord(morph: string): boolean {
  const segment = (morph ?? '').split('/')[0] ?? '';
  if (segment.length < 2) return true;
  return !LEXICAL_POS.has(segment[1]);
}

export function buildEtymologyDeck(
  words: InterlinearWord[],
  entries: Map<string, EtymologyEntry>,
): { cards: EtymologyDeckCard[]; firstStarredIndex: number } {
  const ordered = [...words].sort((a, b) => a.position - b.position);

  const cards: EtymologyDeckCard[] = [];
  for (const word of ordered) {
    if (isFunctionWord(word.morph)) {
      cards.push({ kind: 'function', position: word.position, word });
      continue;
    }
    const strongs = word.strongs ? normalizeStrongs(word.strongs) || null : null;
    const entry = strongs ? entries.get(strongs) : undefined;
    if (strongs && entry) {
      cards.push({ kind: 'lexical', position: word.position, strongs, entry, word, starred: false });
    }
    // else: lexical token with no reviewed entry → omitted (spec §8)
  }

  const lexical = cards.filter(
    (c): c is Extract<EtymologyDeckCard, { kind: 'lexical' }> => c.kind === 'lexical',
  );
  const starredPositions = new Set(
    [...lexical]
      .sort((a, b) => b.entry.studyValue - a.entry.studyValue || a.position - b.position)
      .slice(0, Math.min(MAX_STARS, lexical.length))
      .map((c) => c.position),
  );
  for (const c of cards) {
    if (c.kind === 'lexical' && starredPositions.has(c.position)) c.starred = true;
  }

  const firstStarredIndex = cards.findIndex((c) => c.kind === 'lexical' && c.starred);
  return { cards, firstStarredIndex: firstStarredIndex >= 0 ? firstStarredIndex : 0 };
}
