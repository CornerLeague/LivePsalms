// src/notepad/study/panes/StudyChatWaiting.tsx
import { useEffect, useMemo, useState } from 'react';

// Gentle encouragements shown while Lamplight prepares a reply. They never make
// promises on God's behalf or speak prophetically — they steady and invite,
// offering reflection as possibility rather than pronouncement (Lamplight voice).
// Styled deliberately unlike a reply (centered, serif, italic, accent-toned) so a
// waiting line is never mistaken for the answer.
const WAITING_LINES = [
  'Be still a moment; the light is drawing near.',
  'Even the waiting is held in kinder hands.',
  'Grace is never in a hurry, and neither are you.',
  'Every question carried to the Light is already heard.',
  'Let the quiet become a kind of prayer.',
  'Mercy keeps its own gentle time.',
  'What you seek in the Word is also seeking you.',
  'Rest here — nothing true is ever rushed.',
  'The same hands that hung the stars are near.',
  'Breathe; you are known, and you are kept.',
  'Hope gathers slowly, like light before dawn.',
  'The Word is patient; it will meet you where you are.',
  'Peace is settling in, one small moment at a time.',
  'Faith often grows quietest in the waiting.',
  'Come as you are; there is room enough here.',
];

/** Types one line in, character by character. Fresh instance per line (keyed),
 *  so all state updates land inside timers — never synchronously in the effect. */
function TypeLine({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? '' : text);
  useEffect(() => {
    if (!animate) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      i += 1;
      setShown(text.slice(0, i));
      if (i < text.length) timers.push(setTimeout(tick, 32));
    };
    timers.push(setTimeout(tick, 80));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [text, animate]);
  return <>{shown}</>;
}

export function StudyChatWaiting() {
  const reduce = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // Shuffle once on mount — in an effect, where impurity (Math.random) is allowed —
  // so the same wait doesn't always open with the same line.
  const [order, setOrder] = useState<number[]>(() => WAITING_LINES.map((_, i) => i));
  useEffect(() => {
    const idx = WAITING_LINES.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    // Apply via a timer so the shuffle isn't a synchronous setState in the effect.
    const t = setTimeout(() => setOrder(idx), 0);
    return () => clearTimeout(t);
  }, []);
  const [pos, setPos] = useState(0);
  const line = WAITING_LINES[order[pos % order.length]];

  // Advance to the next line once the current one has had time to type + rest.
  // setPos fires inside a timer (never synchronously in the effect body).
  useEffect(() => {
    const dwell = reduce ? 3600 : Math.min(2600 + line.length * 32, 5200);
    const t = setTimeout(() => setPos((p) => p + 1), dwell);
    return () => clearTimeout(t);
  }, [pos, line, reduce]);

  return (
    <div
      style={{
        position: 'relative',
        padding: '28px 18px',
        margin: '4px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        textAlign: 'center',
      }}
    >
      <span
        aria-hidden
        style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--silica)', opacity: 0.7 }}
      >
        While you wait
      </span>
      {/* key={pos} remounts per line so the CSS fade-in replays; TypeLine streams it. */}
      <span
        key={pos}
        aria-hidden
        className="lamplight-waitline"
        style={{
          maxWidth: '32ch',
          fontFamily: 'Fraunces, Georgia, serif',
          fontStyle: 'italic',
          fontSize: 15,
          lineHeight: 1.6,
          color: 'var(--lamplight-accent)',
        }}
      >
        <TypeLine text={line} animate={!reduce} />
      </span>
      {/* One steady status for screen readers; the poetic lines themselves are decorative. */}
      <span
        role="status"
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        Lamplight is preparing a reflection…
      </span>
    </div>
  );
}
