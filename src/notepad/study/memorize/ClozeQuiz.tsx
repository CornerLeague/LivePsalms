// src/notepad/study/memorize/ClozeQuiz.tsx
// Fill-in-the-blank mode. Blanks are chosen deterministically (seeded) so they
// don't reshuffle mid-attempt. Grading normalizes case/punctuation.
import { useMemo, useState } from 'react';
import { tokenize, selectBlankIndices, gradeCloze, seedFromString, type Token } from './cloze';
import type { MemorizeCard } from './memorize-types';

const DIFFICULTY = 0.35;

export interface ClozeQuizProps {
  card: MemorizeCard;
  /** Varies the blank selection between sessions while staying stable within one. */
  seedSalt: number;
  onGraded: (scorePercent: number) => void;
}

export function ClozeQuiz({ card, seedSalt, onGraded }: ClozeQuizProps) {
  const tokens = useMemo<Token[]>(() => tokenize(card.text), [card.text]);
  const blankIndices = useMemo(
    () => selectBlankIndices(tokens, DIFFICULTY, seedFromString(card.id) + seedSalt),
    [tokens, card.id, seedSalt],
  );
  const blankSlot = useMemo(() => {
    const map = new Map<number, number>(); // token index -> blank ordinal
    blankIndices.forEach((tokenIndex, ordinal) => map.set(tokenIndex, ordinal));
    return map;
  }, [blankIndices]);

  const [answers, setAnswers] = useState<string[]>(() => blankIndices.map(() => ''));
  const [graded, setGraded] = useState<ReturnType<typeof gradeCloze> | null>(null);

  const setAnswer = (ordinal: number, value: string) => {
    setAnswers((cur) => { const next = [...cur]; next[ordinal] = value; return next; });
  };

  const check = () => setGraded(gradeCloze(tokens, blankIndices, answers));

  return (
    <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 2, color: 'var(--deep-umber)' }}>
      <p>
        {tokens.map((t) => {
          const ordinal = blankSlot.get(t.index);
          if (ordinal === undefined) return <span key={t.index}>{t.text}</span>;
          const ok = graded?.perBlank[ordinal];
          return (
            <input
              key={t.index}
              aria-label={`Blank ${ordinal + 1}`}
              data-answer={t.text}
              value={answers[ordinal]}
              disabled={graded != null}
              onChange={(e) => setAnswer(ordinal, e.target.value)}
              style={{
                width: `${Math.max(3, t.text.length)}ch`,
                margin: '0 2px',
                borderRadius: 4,
                border: `1px solid ${graded == null ? 'var(--pale-stone)' : ok ? '#3f9d5a' : '#b45454'}`,
                background: 'transparent',
                color: graded == null ? 'var(--deep-umber)' : ok ? '#3f9d5a' : '#b45454',
                fontFamily: 'Georgia, serif',
                padding: '2px 4px',
              }}
            />
          );
        })}
      </p>
      {graded == null ? (
        <button type="button" onClick={check} style={primaryBtn}>Check</button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13, marginBottom: 8 }}>
            You got {graded.correct}/{graded.total} — {graded.scorePercent}%
          </p>
          <button type="button" onClick={() => onGraded(graded.scorePercent)} style={primaryBtn}>Continue</button>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--lamplight-accent)',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'Outfit, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  minHeight: 40,
};
