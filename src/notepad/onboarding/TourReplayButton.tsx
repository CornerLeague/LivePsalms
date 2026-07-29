import { CircleHelp } from 'lucide-react';
import { useOnboarding } from './useOnboarding';

interface TourReplayButtonProps {
  className?: string;
  size?: number;
}

/**
 * Header icon that restarts the onboarding walkthrough. Sits beside the
 * ThemeToggle in the desktop toolbar and both mobile headers (and mirrors the
 * toggle's hover/sizing idiom), replacing the old checklist "Replay tour" row
 * as the one place the tour can be reopened.
 */
export function TourReplayButton({ className, size = 18 }: TourReplayButtonProps) {
  const { replayTour } = useOnboarding();
  return (
    <button
      type="button"
      aria-label="Replay the tour"
      title="Replay the tour"
      data-tour="tour-replay-button"
      onClick={replayTour}
      className={
        'flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ' +
        (className ?? '')
      }
      style={{ color: 'var(--deep-umber)' }}
    >
      <CircleHelp size={size} />
    </button>
  );
}
