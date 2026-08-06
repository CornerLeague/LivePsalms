// src/notepad/study/insights/PassageDoor.tsx
// Door 1 — The Passage. Four sections, progressively outward: what this passage
// is doing, what sits either side of it, the shape of the chapter around it,
// and where it lands.
//
// TWO RENDER PATHS, and the difference is the point (design D3):
//   cached   → one public DB read, on screen immediately. No spinner.
//   uncached → nothing until the reader presses "Study this passage", then the
//              sections stream in one at a time.
//
// Every section may be absent, and absence renders NOTHING — no heading, no
// placeholder, no apology. A chapter whose shape the grounding could not
// support simply has three sections instead of four. That is a normal outcome,
// which is why the tool allows an empty field at all.
import { usePassageInsight } from './usePassageInsight';
import {
  PASSAGE_SECTIONS,
  type PassageInsightInvoke,
  type PassageInsightScope,
} from './passage-insight-stream-client';

export interface PassageDoorProps {
  scope: PassageInsightScope;
  /** null for a reader who cannot generate. The cache read still runs. */
  invoke: PassageInsightInvoke | null;
  /** Plus/promo. Cached content ignores this entirely — only the action is gated. */
  canGenerate: boolean;
}

export function PassageDoor({ scope, invoke, canGenerate }: PassageDoorProps) {
  const { sections, loading, streaming, error, generate } = usePassageInsight(
    scope,
    canGenerate ? invoke : null,
  );

  if (loading) return null;

  // Nothing generated yet. The action is the door.
  if (sections === null) {
    if (!canGenerate || !invoke) {
      // A signed-out or non-entitled reader sees no action and no tease. The
      // other doors of the overlay carry their own content; this one simply is
      // not there for them yet.
      return null;
    }
    return (
      <div style={{ padding: '24px 0' }}>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={streaming}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: '1px solid var(--deep-umber)',
            background: 'transparent',
            color: 'var(--deep-umber)',
            fontSize: 14,
            cursor: streaming ? 'default' : 'pointer',
          }}
        >
          Study this passage
        </button>
        {error && (
          <p style={{ fontSize: 13, color: 'var(--deep-umber)', opacity: 0.75, marginTop: 10 }}>
            That didn’t finish. Try again.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {PASSAGE_SECTIONS.map((section) => {
        const body = sections[section.key] ?? '';
        // The heading belongs to the body. An empty section is not a section.
        if (body.trim().length === 0) return null;
        return (
          <section key={section.key} style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7, margin: '0 0 8px' }}>
              {section.label}
            </h3>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--deep-umber)', margin: 0, whiteSpace: 'pre-wrap' }}>
              {body}
            </p>
          </section>
        );
      })}
    </div>
  );
}
