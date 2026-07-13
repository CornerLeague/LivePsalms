// src/notepad/study/memorize/QuizSession.tsx
// Runs a passage's cards one at a time in a chosen mode, then hands the per-card
// attempt scores back for mastery write-back.
import { useState } from 'react';
import { X } from 'lucide-react';
import { ClozeQuiz } from './ClozeQuiz';
import { BlankPageQuiz } from './BlankPageQuiz';
import { FlashcardQuiz } from './FlashcardQuiz';
import { formatCardRef, type MemorizeCard } from './memorize-types';

export type QuizMode = 'cloze' | 'blank-page' | 'flashcard';

const MODES: Array<{ id: QuizMode; label: string }> = [
  { id: 'cloze', label: 'Cloze' },
  { id: 'blank-page', label: 'Blank-page' },
  { id: 'flashcard', label: 'Flashcard' },
];

export interface QuizSessionProps {
  cards: MemorizeCard[];
  onCommit: (results: Array<{ id: string; attemptScore: number }>) => void;
  onExit: () => void;
}

export function QuizSession({ cards, onCommit, onExit }: QuizSessionProps) {
  const [mode, setMode] = useState<QuizMode>('cloze');
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Array<{ id: string; attemptScore: number }>>([]);
  const [salt, setSalt] = useState(0); // reshuffles cloze blanks on restart

  const restart = (nextMode: QuizMode) => {
    setMode(nextMode);
    setIndex(0);
    setResults([]);
    setSalt((s) => s + 1);
  };

  const record = (attemptScore: number) => {
    const card = cards[index];
    setResults((cur) => [...cur, { id: card.id, attemptScore }]);
    setIndex((i) => i + 1);
  };

  const done = index >= cards.length && cards.length > 0;
  const current = cards[index];
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.attemptScore, 0) / results.length) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderBottom: '1px solid var(--pale-stone)' }}>
        <div role="tablist" aria-label="Quiz mode" style={{ display: 'flex', gap: 6, flex: 1 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => restart(m.id)}
              style={{
                padding: '6px 12px', borderRadius: 999, minHeight: 34, cursor: 'pointer',
                fontSize: 12, fontFamily: 'Outfit, sans-serif',
                border: `1px solid ${mode === m.id ? 'var(--lamplight-accent)' : 'var(--pale-stone)'}`,
                background: mode === m.id ? 'var(--lamplight-accent)' : 'transparent',
                color: mode === m.id ? '#fff' : 'var(--silica)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Close quiz" onClick={onExit} style={iconBtn}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto', padding: 16 }}>
        {done ? (
          <div style={{ textAlign: 'center', color: 'var(--deep-umber)' }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Session complete</p>
            <p style={{ fontSize: 13, color: 'var(--silica)', marginBottom: 20 }}>Average score {avg}%</p>
            <button type="button" onClick={() => { onCommit(results); onExit(); }} style={primaryBtn}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: 'var(--silica)' }}>{formatCardRef(current)}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--silica)' }}>{index + 1} / {cards.length}</span>
            </div>
            {mode === 'cloze' && <ClozeQuiz key={`${current.id}-${salt}`} card={current} seedSalt={salt} onGraded={record} />}
            {mode === 'blank-page' && <BlankPageQuiz key={`${current.id}-${salt}`} card={current} onGraded={record} />}
            {mode === 'flashcard' && <FlashcardQuiz key={`${current.id}-${salt}`} card={current} onGraded={record} />}
          </>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
  border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--silica)', borderRadius: 6,
};
const primaryBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 6, border: 'none', background: 'var(--lamplight-accent)',
  color: '#fff', cursor: 'pointer', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 500, minHeight: 40,
};
