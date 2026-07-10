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
      <TodaysLampCard
        adapter={lamplightAdapter}
        userId={user.id}
        localDate={localDate}
        firstName={firstName}
        autoGenerate={autoGenerate}
      />
      {/* Panel-level navigation to the full reflections timeline — persistent
          across every TodaysLampCard phase (idle, generating, ready, error). */}
      <div
        className="flex justify-center pb-6"
        style={{ background: 'var(--alabaster)' }}
      >
        <Link
          to={pathToReflections}
          className="px-5 py-2.5 rounded-full text-sm cursor-pointer"
          style={{
            border: '1px solid var(--pale-stone)',
            color: 'var(--deep-umber)',
            fontFamily: 'Outfit, sans-serif',
            textDecoration: 'none',
          }}
        >
          Your Reflections
        </Link>
      </div>
    </div>
  );
}
