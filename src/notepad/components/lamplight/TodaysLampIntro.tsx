import { Link } from 'react-router-dom';
import { todaysLampIntro } from '../../lamplight/lamplight-copy';

export interface TodaysLampIntroProps {
  firstName: string | null;
  onStart: () => void;
  reflectionsHref?: string;
}

export function TodaysLampIntro({ firstName, onStart, reflectionsHref }: TodaysLampIntroProps) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[420px] px-6 text-center"
      style={{ background: 'var(--alabaster)' }}
    >
      <div className="text-3xl mb-3" aria-hidden>🕯</div>
      <h3
        className="text-base mb-2"
        style={{ fontFamily: 'Cormorant Garamond, serif', color: 'var(--deep-umber)' }}
      >
        Today's Lamp
      </h3>
      <p
        className="text-xs mb-5 max-w-[320px] leading-relaxed"
        style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
      >
        {todaysLampIntro(firstName)}
      </p>
      <button
        type="button"
        onClick={onStart}
        className="px-5 py-2.5 rounded-full text-sm cursor-pointer"
        style={{
          background: 'var(--deep-umber)',
          color: 'var(--alabaster)',
          fontFamily: 'Outfit, sans-serif',
        }}
      >
        Show Me Today's Lamp
      </button>
      {reflectionsHref && (
        <Link
          to={reflectionsHref}
          className="mt-3 px-5 py-2.5 rounded-full text-sm cursor-pointer"
          style={{
            border: '1px solid var(--pale-stone)',
            color: 'var(--deep-umber)',
            fontFamily: 'Outfit, sans-serif',
            textDecoration: 'none',
          }}
        >
          Your Reflections
        </Link>
      )}
    </div>
  );
}
