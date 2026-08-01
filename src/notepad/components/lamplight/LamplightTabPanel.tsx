import { useAuthSession } from '@/auth/context/useAuthSession';
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
      {/* Reflections now has its own top-level door (desktop toolbar + mobile tab
          bar), so the Lamplight card no longer carries a "Your Reflections" CTA. */}
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
