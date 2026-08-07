// src/notepad/study/insights/SectionFooter.tsx
// The Insights → Chat door, one per rendered section (parent design §8).
//
// It PREFILLS and never sends. Pressing it closes the overlay and puts the
// question in the study chat box, where the reader edits it or doesn't and
// presses Send themselves — decision 7, and the reason this is a button rather
// than a shortcut.
//
// Rendered only beneath a section that actually rendered. An omitted section
// has no footer: a prompt under a heading that is not there advertises a door
// into a room the grounding could not build.
import { ArrowUpRight } from 'lucide-react';

export interface SectionFooterProps {
  /** The composed, reader-form question. Already scoped to the open passage. */
  prompt: string;
  onPress: (prompt: string) => void;
}

export function SectionFooter({ prompt, onPress }: SectionFooterProps) {
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={() => onPress(prompt)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          // 44px tall — the same touch-target floor B4 applies to the overlay's
          // own controls. This one sits mid-scroll on a phone.
          minHeight: 44,
          padding: '10px 14px',
          borderRadius: 999,
          border: '1px solid var(--pale-stone)',
          background: 'transparent',
          color: 'var(--lamplight-accent)',
          fontFamily: 'Outfit, sans-serif',
          fontSize: 13,
          lineHeight: 1.35,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span>{prompt}</span>
        <ArrowUpRight className="w-3.5 h-3.5" style={{ flexShrink: 0 }} aria-hidden />
      </button>
    </div>
  );
}
