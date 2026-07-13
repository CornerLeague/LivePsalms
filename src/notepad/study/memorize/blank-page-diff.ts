// src/notepad/study/memorize/blank-page-diff.ts
// Word-level LCS diff for the "blank page" full-recall method: compare the user's
// typed text against the frozen snapshot -> matched / missed / extra tokens for
// display. Comparison is normalized (case/punctuation-insensitive) but display
// preserves the EXPECTED spelling for matched/missed and the USER's for extra.
import { normalizeWord } from './cloze';

export type DiffStatus = 'matched' | 'missed' | 'extra';

export interface DiffToken {
  text: string;
  status: DiffStatus;
}

export interface BlankPageDiff {
  tokens: DiffToken[];
  matched: number;
  totalExpected: number;
  scorePercent: number;
}

interface Word {
  raw: string;
  norm: string;
}

function splitWords(s: string): Word[] {
  const trimmed = s.trim();
  if (trimmed.length === 0) return [];
  return trimmed
    .split(/\s+/)
    .map((raw) => ({ raw, norm: normalizeWord(raw) }))
    .filter((w) => w.norm.length > 0);
}

export function diffRecall(expected: string, actual: string): BlankPageDiff {
  const exp = splitWords(expected);
  const act = splitWords(actual);
  const n = exp.length;
  const m = act.length;

  // LCS DP table over normalized words.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = exp[i].norm === act[j].norm
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack into an aligned token stream.
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  let matched = 0;
  while (i < n && j < m) {
    if (exp[i].norm === act[j].norm) {
      tokens.push({ text: exp[i].raw, status: 'matched' });
      matched += 1;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ text: exp[i].raw, status: 'missed' });
      i += 1;
    } else {
      tokens.push({ text: act[j].raw, status: 'extra' });
      j += 1;
    }
  }
  while (i < n) { tokens.push({ text: exp[i].raw, status: 'missed' }); i += 1; }
  while (j < m) { tokens.push({ text: act[j].raw, status: 'extra' }); j += 1; }

  const totalExpected = n;
  const scorePercent = totalExpected === 0 ? 100 : Math.round((matched / totalExpected) * 100);
  return { tokens, matched, totalExpected, scorePercent };
}
