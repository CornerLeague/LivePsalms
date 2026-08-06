import { useNavigate } from 'react-router-dom';
import { Waypoints } from 'lucide-react';
import { useAccountProfile } from '@/auth/context/useAccountProfile';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { reflectionsPath } from './waymarks/reflections-path';

interface ReflectionsButtonProps {
  /** Extra classes for spacing at the call site (margins, etc.). */
  className?: string;
}

/**
 * Reflections — a top-level destination (its own door), the focal feature.
 * A featured pill in the app's warm "path" voice; it opens the full path of
 * stones. Rendered in the desktop editor tab bar, right before the Lamplight
 * tab, so the two "path" destinations sit together.
 *
 * Vanity-aware target — the same seam the old "Your Reflections" CTA used;
 * falls back to the legacy redirect while the username loads. Signed-out
 * readers can't reach the (Plus-gated, signed-in) path, so the door sends them
 * to sign-in rather than silently bouncing off the redirect — parity with how
 * Lamplight gates signed-out users.
 */
export function ReflectionsButton({ className = '' }: ReflectionsButtonProps) {
  const navigate = useNavigate();
  const { profile } = useAccountProfile();
  const { user } = useAuthSession();
  const reflectionsHref = user ? reflectionsPath(profile?.username) : '/login';

  return (
    <button
      data-tour="reflections-entry"
      onClick={() => navigate(reflectionsHref)}
      title="Your Reflections"
      className={`flex items-center gap-1.5 px-3 h-8 rounded-full transition-colors cursor-pointer shrink-0 hover:bg-black/5 dark:hover:bg-white/10 ${className}`}
      style={{
        border: '1.5px solid var(--reflections-cta-bg)',
        background: 'color-mix(in srgb, var(--reflections-cta-bg) 8%, transparent)',
        color: 'var(--reflections-cta-bg)',
        fontFamily: 'Outfit, sans-serif',
      }}
    >
      <Waypoints className="w-3.5 h-3.5" />
      <span className="text-[11px] font-medium tracking-wide">Reflections</span>
    </button>
  );
}
