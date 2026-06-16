import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { decideOnboardingActions } from './onboarding-state';
import { decideMerge } from './onboarding-lifecycle';
import { appendStudyDate, hasThreeConsecutiveDays } from './streak';
import { useOnboardingAdapter } from './useOnboardingAdapter';
import {
  ANON_EVENT_TO_ITEM,
  JOURNEY_EVENT_TO_ITEM,
  ONBOARDING_LAUNCH_MS,
  defaultAccountProgress,
} from './onboarding-types';
import type {
  AccountProgress,
  AnonProgress,
  OnboardingEvent,
} from './onboarding-types';
import {
  ONBOARDING_ANON_TOUR_DONE_KEY,
  clearAnon,
  markAnonTourDone,
  readAnonProgress,
  readAnonTourDone,
  writeAnonProgress,
} from './onboarding-storage';
import { OnboardingContext, type OnboardingContextValue } from './useOnboarding';
import { setOnboardingSink } from './onboarding-events';

const nowIso = (): string => new Date().toISOString();
const todayYMD = (): string => nowIso().slice(0, 10);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthSession();
  const userId = user?.id ?? null;
  const signedIn = !!user;

  const eligibleForJourney = useMemo(() => {
    const created = user?.created_at;
    if (!created) return false;
    const ts = Date.parse(created);
    if (Number.isNaN(ts)) return false;
    return ts >= ONBOARDING_LAUNCH_MS;
  }, [user?.created_at]);

  const adapter = useOnboardingAdapter(userId);

  const [anonTourDone, setAnonTourDone] = useState(false);
  const [anon, setAnon] = useState<AnonProgress | null>(null);
  const [account, setAccount] = useState<AccountProgress | null>(null);
  // True only after the async account-load effect settles (success OR failure),
  // so the merge effect never acts on a transient pre-load null.
  const [accountLoaded, setAccountLoaded] = useState(false);

  // Sync read of anonymous state from localStorage on mount.
  useEffect(() => {
    try {
      setAnonTourDone(readAnonTourDone(localStorage));
      setAnon(readAnonProgress(localStorage));
    } catch {
      /* degraded storage — leave defaults */
    }
  }, []);

  // Async load of account progress whenever the adapter (i.e. user) changes.
  useEffect(() => {
    // A user change must re-load: reset the gate so the merge effect waits.
    setAccountLoaded(false);
    if (!adapter) {
      setAccount(null);
      // No adapter (signed out) — nothing to load; treat as settled.
      setAccountLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await adapter.getProgress();
        if (!cancelled) setAccount(loaded);
      } catch (err) {
        if (!cancelled) {
          console.warn('[OnboardingProvider] getProgress failed:', err);
          setAccount(null);
        }
      } finally {
        // Settle the gate on BOTH success and failure so the merge effect
        // (and the provider) never deadlock waiting on a load that failed.
        if (!cancelled) setAccountLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const persistAccount = useCallback(
    (next: AccountProgress) => {
      if (!adapter) return;
      try {
        adapter.saveProgress(next).catch((err) => {
          console.warn('[OnboardingProvider] saveProgress failed:', err);
        });
      } catch (err) {
        console.warn('[OnboardingProvider] saveProgress threw:', err);
      }
    },
    [adapter],
  );

  // One-time anon -> account merge on first signed-in load. The decision is a
  // pure function over a state snapshot; this effect owns only the mergedRef
  // latch and the I/O dispatch.
  const mergedRef = useRef(false);
  useEffect(() => {
    const decision = decideMerge({
      alreadyMerged: mergedRef.current,
      authLoading: loading,
      signedIn,
      hasAdapter: !!adapter,
      accountLoaded,
      account,
      anon,
    });
    switch (decision.kind) {
      case 'idle':
        break;
      case 'already-merged':
        mergedRef.current = true;
        break;
      case 'merge':
        // Latch BEFORE writes so a thrown persist still consumes the once-latch
        // (no retry loop).
        mergedRef.current = true;
        try {
          setAccount(decision.next);
          persistAccount(decision.next);
          clearAnon(localStorage);
        } catch (err) {
          console.warn('[OnboardingProvider] merge failed:', err);
        }
        break;
    }
  }, [signedIn, adapter, account, anon, anonTourDone, loading, accountLoaded, persistAccount]);

  const reportOnboardingEvent = useCallback(
    (event: OnboardingEvent) => {
      try {
        if (!signedIn) {
          const itemId = ANON_EVENT_TO_ITEM[event];
          if (!itemId) return;
          setAnon((prev) => {
            const base: AnonProgress = prev ?? { items: {}, dismissed: false };
            if (base.items[itemId] != null) return base;
            const next: AnonProgress = {
              ...base,
              items: { ...base.items, [itemId]: nowIso() },
            };
            writeAnonProgress(localStorage, next);
            return next;
          });
          return;
        }

        if (!eligibleForJourney) return;

        setAccount((prev) => {
          const base: AccountProgress = prev ?? defaultAccountProgress();
          const items = { ...base.items };
          const itemId = JOURNEY_EVENT_TO_ITEM[event];
          if (itemId && items[itemId] == null) items[itemId] = nowIso();
          const studyDates = appendStudyDate(base.studyDates, todayYMD());
          if (hasThreeConsecutiveDays(studyDates) && items['streak-3'] == null) {
            items['streak-3'] = nowIso();
          }
          const next: AccountProgress = { ...base, items, studyDates };
          persistAccount(next);
          return next;
        });
      } catch (err) {
        console.warn('[OnboardingProvider] reportOnboardingEvent failed:', err);
      }
    },
    [signedIn, eligibleForJourney, persistAccount],
  );

  // Register the provider as the global onboarding-event sink so React-free
  // domain classes (NoteCollection, FolderHierarchy) and TipTap extensions can
  // emit progress events via emitOnboardingEvent without importing the provider.
  // reportOnboardingEvent is a stable useCallback; depending on it keeps the
  // registered fn current so emitted events always reach the latest handler.
  useEffect(() => {
    setOnboardingSink(reportOnboardingEvent);
    return () => setOnboardingSink(null);
  }, [reportOnboardingEvent]);

  const completeGuidedNote = useCallback(
    (status: 'done' | 'skipped') => {
      try {
        setAccount((prev) => {
          const base: AccountProgress = prev ?? defaultAccountProgress();
          const next: AccountProgress = { ...base, guidedNote: status };
          persistAccount(next);
          return next;
        });
      } catch (err) {
        console.warn('[OnboardingProvider] completeGuidedNote failed:', err);
      }
    },
    [persistAccount],
  );

  const dismissChecklist = useCallback(() => {
    try {
      if (!signedIn) {
        setAnon((prev) => {
          const base: AnonProgress = prev ?? { items: {}, dismissed: false };
          const next: AnonProgress = { ...base, dismissed: true };
          writeAnonProgress(localStorage, next);
          return next;
        });
        return;
      }
      setAccount((prev) => {
        const base: AccountProgress = prev ?? defaultAccountProgress();
        const next: AccountProgress = { ...base, dismissed: true };
        persistAccount(next);
        return next;
      });
    } catch (err) {
      console.warn('[OnboardingProvider] dismissChecklist failed:', err);
    }
  }, [signedIn, persistAccount]);

  const replayTour = useCallback(() => {
    try {
      localStorage.removeItem(ONBOARDING_ANON_TOUR_DONE_KEY);
    } catch {
      /* ignore */
    }
    setAnonTourDone(false);
  }, []);

  const markTourDone = useCallback(() => {
    try {
      markAnonTourDone(localStorage);
    } catch {
      /* ignore */
    }
    setAnonTourDone(true);
  }, []);

  const actions = useMemo(
    () =>
      decideOnboardingActions({
        authLoading: loading,
        signedIn,
        eligibleForJourney,
        anonTourDone,
        anon,
        account,
      }),
    [loading, signedIn, eligibleForJourney, anonTourDone, anon, account],
  );

  const value: OnboardingContextValue = useMemo(
    () => ({
      actions,
      anon,
      account,
      reportOnboardingEvent,
      completeGuidedNote,
      dismissChecklist,
      replayTour,
      markTourDone,
    }),
    [
      actions,
      anon,
      account,
      reportOnboardingEvent,
      completeGuidedNote,
      dismissChecklist,
      replayTour,
      markTourDone,
    ],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
