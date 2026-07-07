import { useEffect, useState } from 'react';
import { hasArrived } from './arrival';
import type { LamplightAdapter } from '../storage/lamplight-adapter';

// Same key WaymarksPeriodDetail writes (Task 16 `wm-opened:<periodKey>`); a 2-line read, safe to
// extract to a shared opened-store in a later cleanup.
function isOpened(periodKey: string): boolean {
  try { return localStorage.getItem(`wm-opened:${periodKey}`) === '1'; } catch { return false; }
}

// The gold arrival dot shows when the newest reflection has arrived (past 07:00 local on the 1st of
// the following month) AND the reader has not yet broken its seal. Existence + newest come from
// listReflections; hasArrived is the pure time gate.
// Hook + its one-line badge component are intentionally co-located (brief calls for a single file).
// eslint-disable-next-line react-refresh/only-export-components
export function useArrivalDot(adapter: LamplightAdapter, userId: string, timezone?: string): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    void (async () => {
      try {
        const items = await adapter.listReflections(userId);
        const newest = items.filter((i) => i.hiddenAt === null)[0];
        const arrived = !!newest && hasArrived(new Date(), newest.periodKey, tz) && !isOpened(newest.periodKey);
        if (alive) setShow(arrived);
      } catch {
        // Presentational, non-gating badge: any adapter failure just means no dot.
        if (alive) setShow(false);
      }
    })();
    return () => { alive = false; };
  }, [adapter, userId, timezone]);
  return show;
}

// A small gold dot (#C49A78) — the arrival cue on the Lamplight tab. Inline-styled so it needs no
// new stylesheet; mirror the existing daily-lamp badge placement when mounting it.
export function ArrivalDot() {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-block', width: 6, height: 6, marginLeft: 4, borderRadius: '50%', background: '#C49A78', verticalAlign: 'middle' }}
    />
  );
}
