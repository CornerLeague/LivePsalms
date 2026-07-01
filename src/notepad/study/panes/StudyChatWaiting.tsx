// src/notepad/study/panes/StudyChatWaiting.tsx
import { useEffect, useMemo, useState } from 'react';

// Short, comforting Scriptures shown while Lamplight prepares a reply. Kept to
// public-domain wording (KJV / WEB / BSB are consistent on these) so there's no
// translation-copyright concern. Styled unlike a reply (centered serif italic in
// the accent tone) so a waiting verse is never mistaken for the answer.
const WAITING_VERSES: { text: string; ref: string }[] = [
  { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
  { text: 'The LORD is my light and my salvation — whom shall I fear?', ref: 'Psalm 27:1' },
  { text: 'Wait for the LORD; be strong, and take heart.', ref: 'Psalm 27:14' },
  { text: 'The LORD is near to all who call on Him.', ref: 'Psalm 145:18' },
  { text: 'The light shines in the darkness, and the darkness has not overcome it.', ref: 'John 1:5' },
  { text: 'Come to Me, all who are weary and burdened, and I will give you rest.', ref: 'Matthew 11:28' },
  { text: 'Cast all your anxiety on Him, because He cares for you.', ref: '1 Peter 5:7' },
  { text: 'Your word is a lamp to my feet and a light to my path.', ref: 'Psalm 119:105' },
  { text: 'His mercies are new every morning; great is Your faithfulness.', ref: 'Lamentations 3:22–23' },
  { text: 'Peace I leave with you; My peace I give to you.', ref: 'John 14:27' },
  { text: 'Those who wait upon the LORD will renew their strength.', ref: 'Isaiah 40:31' },
  { text: 'The LORD your God is with you, He is mighty to save.', ref: 'Zephaniah 3:17' },
  { text: 'Trust in the LORD with all your heart.', ref: 'Proverbs 3:5' },
  { text: 'I have called you by name; you are Mine.', ref: 'Isaiah 43:1' },
  { text: 'The LORD is my shepherd; I shall not want.', ref: 'Psalm 23:1' },
];

/** Types one line in, character by character. Fresh instance per verse (keyed),
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
      if (i < text.length) timers.push(setTimeout(tick, 30));
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
  // so the same wait doesn't always open with the same verse.
  const [order, setOrder] = useState<number[]>(() => WAITING_VERSES.map((_, i) => i));
  useEffect(() => {
    const idx = WAITING_VERSES.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    // Apply via a timer so the shuffle isn't a synchronous setState in the effect.
    const t = setTimeout(() => setOrder(idx), 0);
    return () => clearTimeout(t);
  }, []);
  const [pos, setPos] = useState(0);
  const verse = WAITING_VERSES[order[pos % order.length]];

  // Advance to the next verse once the current one has had time to type + rest.
  // setPos fires inside a timer (never synchronously in the effect body).
  useEffect(() => {
    const dwell = reduce ? 4200 : Math.min(3200 + verse.text.length * 30, 6500);
    const t = setTimeout(() => setPos((p) => p + 1), dwell);
    return () => clearTimeout(t);
  }, [pos, verse, reduce]);

  return (
    <div
      style={{
        position: 'relative',
        padding: '28px 18px',
        margin: '4px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
      }}
    >
      {/* "Lamplight" + animated dots — a typing-style indicator. */}
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--silica)',
        }}
      >
        Lamplight
        <span className="lamplight-dots" aria-hidden><span /><span /><span /></span>
      </span>
      {/* key={pos} remounts per verse so the CSS fade-in replays; TypeLine streams it. */}
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
        <TypeLine text={verse.text} animate={!reduce} />
      </span>
      <span aria-hidden style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--silica)' }}>
        {verse.ref}
      </span>
      {/* One steady status for screen readers; the verses themselves are decorative. */}
      <span
        role="status"
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        Lamplight is preparing a reply…
      </span>
    </div>
  );
}
