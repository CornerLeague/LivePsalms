import { loadingState } from '../../lamplight/lamplight-copy';

export interface TodaysLampLoadingProps {
  stage: 'notes' | 'scripture' | 'composing';
  firstName: string | null;
}

export function TodaysLampLoading({ stage, firstName }: TodaysLampLoadingProps) {
  const copyByStage: Record<'notes' | 'scripture' | 'composing', string> = {
    notes: 'Reading your recent notes…',
    scripture: 'Searching Scripture…',
    composing: loadingState(firstName),
  };
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[420px] px-6 text-center"
      style={{ background: 'var(--alabaster)' }}
    >
      <div className="text-3xl mb-3 animate-pulse" aria-hidden>🕯</div>
      <p
        className="text-xs"
        style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
        role="status"
        aria-live="polite"
      >
        {copyByStage[stage]}
      </p>
    </div>
  );
}
