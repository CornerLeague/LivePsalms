// src/notepad/study/memorize/BlankPageQuiz.tsx
// "Blank page" full-recall mode: type the verse from memory, then reveal a
// word-level diff against the frozen snapshot and self-confirm.
import { useState } from 'react';
import { diffRecall, type BlankPageDiff } from './blank-page-diff';
import type { MemorizeCard } from './memorize-types';

export interface BlankPageQuizProps {
  card: MemorizeCard;
  onGraded: (scorePercent: number) => void;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  matched: { color: 'var(--deep-umber)' },
  missed: { color: '#b58a3c', textDecoration: 'underline' },
  extra: { color: '#b45454', textDecoration: 'line-through' },
};

export function BlankPageQuiz({ card, onGraded }: BlankPageQuizProps) {
  const [entry, setEntry] = useState('');
  const [diff, setDiff] = useState<BlankPageDiff | null>(null);

  return (
    <div style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--deep-umber)' }}>
      {diff == null ? (
        <>
          <textarea
            aria-label="Type the verse from memory"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            rows={4}
            placeholder="Type the verse from memory…"
            style={{
              width: '100%', borderRadius: 6, border: '1px solid var(--pale-stone)',
              background: 'transparent', color: 'var(--deep-umber)', padding: 10,
              fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 1.7, resize: 'vertical',
            }}
          />
          <button type="button" onClick={() => setDiff(diffRecall(card.text, entry))} style={primaryBtn}>
            Reveal &amp; compare
          </button>
        </>
      ) : (
        <div>
          <p style={{ fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 2 }}>
            {diff.tokens.map((t, i) => (
              <span key={i} style={STATUS_STYLE[t.status]}>{t.text}{' '}</span>
            ))}
          </p>
          <p style={{ fontSize: 13, margin: '8px 0' }}>
            {diff.matched}/{diff.totalExpected} words — {diff.scorePercent}%
          </p>
          <button type="button" onClick={() => onGraded(diff.scorePercent)} style={primaryBtn}>Continue</button>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  marginTop: 12, padding: '9px 18px', borderRadius: 6, border: 'none',
  background: 'var(--lamplight-accent)', color: '#fff', cursor: 'pointer',
  fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 500, minHeight: 40,
};
