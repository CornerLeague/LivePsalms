import { useTodaysLamp } from '../../hooks/useTodaysLamp';
import type { LamplightAdapter } from '../../storage/lamplight-adapter';
import type { DailyDevotion } from '../../storage/lamplight-artifacts';
import { TodaysLampLoading } from './TodaysLampLoading';
import { TodaysLampError } from './TodaysLampError';
import { TodaysLampIntro } from './TodaysLampIntro';

export interface TodaysLampCardProps {
  adapter: LamplightAdapter;
  userId: string;
  localDate: string;
  firstName: string | null;
  autoGenerate?: boolean;
}

export function TodaysLampCard({
  adapter, userId, localDate, firstName, autoGenerate = true,
}: TodaysLampCardProps) {
  const { state, start, retry } = useTodaysLamp({ adapter, userId, localDate, autoGenerate });

  if (state.phase === 'idle')        return <TodaysLampIntro firstName={firstName} onStart={start} />;
  if (state.phase === 'retrieving') return <TodaysLampLoading stage={state.stage} firstName={firstName} />;
  if (state.phase === 'generating' || state.phase === 'refining') return <TodaysLampLoading stage="composing" firstName={firstName} />;
  if (state.phase === 'error')      return <TodaysLampError reason={state.reason} firstName={firstName} onRetry={retry} />;
  if (state.phase !== 'ready')                                       return null;

  return (
    <Devotion
      artifact={state.artifact}
      localDate={localDate}
    />
  );
}

function Devotion(props: {
  artifact: DailyDevotion;
  localDate: string;
}) {
  const { artifact, localDate } = props;
  return (
    <div
      className="px-6 py-6 max-w-[640px] mx-auto"
      style={{ background: 'var(--alabaster)' }}
    >
      <div
        className="flex items-center gap-2 mb-5 text-[11px]"
        style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
      >
        <span aria-hidden>🕯</span>
        <span>Today · {formatLocalDate(localDate)}</span>
      </div>

      <p
        className="mb-6 text-sm leading-relaxed"
        style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
      >
        {artifact.opening}
      </p>

      <div
        className="border-t border-b py-4 mb-6"
        style={{ borderColor: 'var(--pale-stone)' }}
      >
        <div
          className="text-[11px] mb-2 uppercase tracking-wider"
          style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
        >
          {artifact.scripture.ref}
        </div>
        <p
          className="text-lg italic leading-relaxed"
          style={{ color: 'var(--deep-umber)', fontFamily: 'Cormorant Garamond, serif' }}
        >
          {artifact.scripture.text}
        </p>
      </div>

      <p
        className="mb-6 text-sm leading-relaxed"
        style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
      >
        {artifact.reflection}
      </p>

      <p
        className="mb-6 text-sm italic pl-4 border-l-2 leading-relaxed"
        style={{
          color: 'var(--deep-umber)',
          fontFamily: 'Outfit, sans-serif',
          borderColor: 'var(--pale-stone)',
        }}
      >
        {artifact.prompt}
      </p>

      <div
        className="border-t pt-4 mb-4 text-[11px]"
        style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif', borderColor: 'var(--pale-stone)' }}
      >
        <div className="mb-1">Drawing from your notes about:</div>
        <ul className="list-disc list-inside space-y-0.5">
          {artifact.note_citations.map((c, i) => (
            <li key={`${c.note_id}-${i}`}>{c.reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function formatLocalDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(s => Number.parseInt(s, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}
