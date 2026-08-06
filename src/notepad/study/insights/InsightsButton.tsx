// src/notepad/study/insights/InsightsButton.tsx
// The door into Insights, in the Study side-panel tab row.
//
// Shaped like ReflectionsButton — a rounded outlined pill, deliberately unlike
// the flat Notes/Chat/Memorize tabs — because it opens a destination rather
// than switching an in-pane tab. It takes the Study desk's existing
// --lamplight-accent rather than minting a ninth CTA token across eight theme
// palettes.
import { Sparkles } from 'lucide-react';

export interface InsightsButtonProps {
  onClick: () => void;
  className?: string;
}

export function InsightsButton({ onClick, className = '' }: InsightsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Insights on this passage"
      aria-label="Open Insights"
      className={`flex items-center gap-1.5 px-3 h-8 rounded-full transition-colors cursor-pointer shrink-0 hover:bg-black/5 dark:hover:bg-white/10 ${className}`}
      style={{
        border: '1.5px solid var(--lamplight-accent)',
        background: 'color-mix(in srgb, var(--lamplight-accent) 8%, transparent)',
        color: 'var(--lamplight-accent)',
        fontFamily: 'Outfit, sans-serif',
      }}
    >
      <Sparkles className="w-3.5 h-3.5" />
      <span className="text-[11px] font-medium tracking-wide">Insights</span>
    </button>
  );
}
