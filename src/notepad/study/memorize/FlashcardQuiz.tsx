// src/notepad/study/memorize/FlashcardQuiz.tsx
// Reference flashcard mode: prompt with the reference, reveal the verse, self-rate.
import { useState } from 'react';
import { formatCardRef, type MemorizeCard } from './memorize-types';

export interface FlashcardQuizProps {
  card: MemorizeCard;
  onGraded: (scorePercent: number) => void;
}

export function FlashcardQuiz({ card, onGraded }: FlashcardQuizProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--deep-umber)', textAlign: 'center' }}>
      <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>{formatCardRef(card)}</p>
      {revealed ? (
        <>
          <p style={{ fontFamily: 'Georgia, serif', fontSize: 16, lineHeight: 1.8, marginBottom: 20 }}>{card.text}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button type="button" onClick={() => onGraded(0)} style={{ ...rateBtn, background: '#efe4e0', color: '#b45454' }}>Again</button>
            <button type="button" onClick={() => onGraded(100)} style={{ ...rateBtn, background: 'var(--lamplight-accent)', color: '#fff' }}>Got it</button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setRevealed(true)} style={{ ...rateBtn, background: 'var(--lamplight-accent)', color: '#fff' }}>
          Reveal
        </button>
      )}
    </div>
  );
}

const rateBtn: React.CSSProperties = {
  padding: '10px 22px', borderRadius: 6, border: 'none', cursor: 'pointer',
  fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 500, minHeight: 44,
};
