// Pure cloze (fill-in-the-blank) engine. Blank selection is DETERMINISTIC within a
// session (seeded RNG) so a card doesn't reshuffle mid-attempt. Only word tokens
// are ever blanked; punctuation/whitespace never are.

export interface Token {
  text: string;
  isWord: boolean;
  index: number;
}

const WORD_OR_GAP = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[^A-Za-z0-9]+/g;

/** Split text into ordered word + non-word tokens. join(tokens.text) === text. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  WORD_OR_GAP.lastIndex = 0;
  let index = 0;
  while ((m = WORD_OR_GAP.exec(text)) !== null) {
    const t = m[0];
    tokens.push({ text: t, isWord: /[A-Za-z0-9]/.test(t[0]), index });
    index += 1;
  }
  return tokens;
}

/** Deterministic 32-bit PRNG. Same seed -> same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap deterministic 32-bit hash of a string (for seeding from a card id). */
export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** lowercase + strip everything but [a-z0-9]. */
export function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Pick round(difficulty * wordCount) word-token indices, deterministically by
 * seed, returned sorted ascending. difficulty is clamped to [0,1]. Punctuation is
 * never selected.
 */
export function selectBlankIndices(tokens: Token[], difficulty: number, seed: number): number[] {
  const wordIndices = tokens.filter((t) => t.isWord).map((t) => t.index);
  const d = Math.max(0, Math.min(1, difficulty));
  const n = Math.round(d * wordIndices.length);
  if (n <= 0) return [];
  if (n >= wordIndices.length) return [...wordIndices];
  const rng = mulberry32(seed);
  const pool = [...wordIndices];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).sort((a, b) => a - b);
}

export interface ClozeGrade {
  perBlank: boolean[];
  correct: number;
  total: number;
  scorePercent: number;
}

/**
 * Grade a cloze attempt. `answers` is aligned to `blankIndices` order. An
 * `overrides[i] === true` forces blank i correct (the "close enough?" manual mark).
 */
export function gradeCloze(
  tokens: Token[],
  blankIndices: number[],
  answers: string[],
  overrides: boolean[] = [],
): ClozeGrade {
  const perBlank = blankIndices.map((tokenIndex, i) => {
    if (overrides[i]) return true;
    const expected = normalizeWord(tokens[tokenIndex]?.text ?? '');
    const got = normalizeWord(answers[i] ?? '');
    return expected.length > 0 && expected === got;
  });
  const correct = perBlank.filter(Boolean).length;
  const total = blankIndices.length;
  const scorePercent = total === 0 ? 100 : Math.round((correct / total) * 100);
  return { perBlank, correct, total, scorePercent };
}
