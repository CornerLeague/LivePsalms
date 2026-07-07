import { Link } from 'react-router-dom';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useAccountProfile } from '@/auth/context/useAccountProfile';
import type { LamplightAdapter } from '../../storage/lamplight-adapter';
import { useLamplightSettings } from '../../hooks/useLamplightSettings';
import { useLamplightEntitlement } from '../../hooks/useLamplightEntitlement';
import { SignInGate } from './SignInGate';
import { ConsentCard } from './ConsentCard';
import { OptedOutCard } from './OptedOutCard';
import { TodaysLampCard } from './TodaysLampCard';
import { PaywallCard } from './PaywallCard';
import { firstNameOf } from '../../first-load/notepad-first-load';
import { sanitizeFirstName } from '../../utils/personalization';

export interface LamplightTabPanelProps {
  lamplightAdapter: LamplightAdapter;
  autoGenerate?: boolean;
}

export function LamplightTabPanel({ lamplightAdapter, autoGenerate = true }: LamplightTabPanelProps) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  // Vanity-aware link target — the same seam useUsernameGate/NotepadRoutes.tsx uses.
  // Falls back to the legacy /notebook/reflections path (now a correct redirect, not
  // a dead end) while the profile is still loading, so the link is never broken.
  const { profile } = useAccountProfile();
  const pathToReflections = profile?.username
    ? `/notebook/u/${profile.username}/reflections`
    : '/notebook/reflections';

  const settingsState = useLamplightSettings({ adapter: lamplightAdapter, userId });
  const entitlementState = useLamplightEntitlement({ adapter: lamplightAdapter, userId });

  if (!user) return <SignInGate />;

  if (settingsState.isLoading || entitlementState.isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-[420px]"
        style={{ background: 'var(--alabaster)' }}
      >
        <p
          className="text-xs"
          style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
        >
          Loading…
        </p>
      </div>
    );
  }

  if (settingsState.settings === null) {
    return (
      <ConsentCard
        onTurnOn={() =>
          settingsState.upsert({
            enabled: true,
            consentDecidedAt: new Date().toISOString(),
          })
        }
        onMaybeLater={() =>
          settingsState.upsert({
            enabled: false,
            consentDecidedAt: new Date().toISOString(),
          })
        }
      />
    );
  }

  if (!settingsState.settings.enabled) {
    return <OptedOutCard onChangeMind={() => settingsState.deleteAll()} />;
  }

  if (!entitlementState.hasAccess('today')) {
    return <PaywallCard />;
  }

  const localDate = new Date().toLocaleDateString('en-CA');
  const firstName = sanitizeFirstName(firstNameOf(user));
  return (
    <div>
      {/* No .wm-label class here (final-review rider): that class's custom properties
          (--wm-silica, --wm-sans) are scoped to .wm-root and only load with the lazy
          waymarks route chunk — outside it, .wm-label falls back to unstyled text.
          The literal styles below reproduce its typographic rule set locally. */}
      <Link
        to={pathToReflections}
        style={{
          display: 'inline-block',
          marginBottom: '0.75rem',
          color: '#C49A78',
          textDecoration: 'none',
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          fontSize: '0.72rem',
          fontFamily: 'Outfit, sans-serif',
        }}
      >
        Your path of months is here →
      </Link>
      <TodaysLampCard
        adapter={lamplightAdapter}
        userId={user.id}
        localDate={localDate}
        firstName={firstName}
        autoGenerate={autoGenerate}
      />
    </div>
  );
}
