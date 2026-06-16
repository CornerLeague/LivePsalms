# Notepad Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two onboarding lanes for the notepad — an anonymous spotlight tour + "Get started" checklist (pure localStorage), and a post-signup guided first-study note + "Your journey" checklist (account-persisted) — that merge anonymous progress into the account on first signed-in load and degrade silently when Supabase is absent.

**Architecture:** A new self-contained module `src/notepad/onboarding/`. Pure, exhaustively-tested decision logic (`onboarding-state.ts`) is separated from UI, mirroring the existing `notepad-first-load.ts` pattern. Persistence sits behind two seams: namespaced localStorage helpers for anonymous data, and an `OnboardingProgressAdapter` (local + Supabase implementations, selected exactly like `useBibleHighlights`) for account data backed by a new `profiles.onboarding_progress` JSONB column. An `OnboardingProvider` owns runtime state and exposes `reportOnboardingEvent(event)`; eight existing completion points call it. The existing `/welcome` flow is untouched.

**Tech Stack:** Vite + React + TypeScript, Vitest + React Testing Library, TipTap (guided-note template JSON), `animejs@^4` (already a dependency) for tour transitions, Supabase (`profiles` table + RLS already permits self-update), existing `usePrefersReducedMotion` hook.

---

## Domain language (docs/CONTEXT.md)

This feature introduces these deep modules. After the feature ships, add glossary entries for the ones that carry real domain decisions; generic infrastructure does NOT get an entry.

- **OnboardingState** — the pure decision module: `(auth state, gating, storage flags, progress) -> OnboardingAction[]`. A decision module like `NotepadFirstLoad`, not a state machine. **Earns a glossary entry.**
- **OnboardingProgressAdapter** — the persistence seam for account-side progress (local + Supabase). Real seam because two adapters exist. **Earns a glossary entry.**
- **AnonProgress / AccountProgress** — the two serialized progress shapes. Worth an entry because the merge contract depends on their exact shapes.
- `onboarding-storage.ts`, `streak.ts`, `OnboardingProvider`, tour/checklist components — generic infrastructure; **no glossary entry** unless a load-bearing decision emerges.

Apply **deletion-test discipline**: each new module must earn its keep. If a module is a trivial pass-through, fold it into its caller.

## File structure

```
src/notepad/onboarding/
  onboarding-types.ts            Types, item IDs, event union, event→item maps, launch constant.
  onboarding-state.ts            OnboardingState: pure decideOnboardingActions().  No React.
  streak.ts                      Pure study-date streak helpers.
  merge-anon-progress.ts         Pure idempotent sign-up merge.
  onboarding-storage.ts          Anonymous localStorage boundary (Pick<Storage> injected).
  adapters/
    types.ts                     OnboardingProgressAdapter interface.
    local-onboarding-adapter.ts  localStorage-backed, userId-scoped (offline + write-fail cache).
    supabase-onboarding-adapter.ts  profiles.onboarding_progress JSONB read/write.
  useOnboardingAdapter.ts        useMemo adapter selection (mirrors useBibleHighlights).
  OnboardingProvider.tsx         Context: progress + actions + reportOnboardingEvent(). Mounts merge.
  useOnboarding.ts               Context consumer hook.
  tour/
    tour-steps.ts                The 5 stop definitions (anchor selector, copy, placement).
    SpotlightTour.tsx            Dimmed overlay + rect cutout + tooltip card. animejs.
  checklist/
    get-started-items.ts         Anonymous items (4) + their event mapping.
    journey-items.ts             Account items (7) + their event mapping.
    ChecklistPanel.tsx           Floating panel <-> collapsed pill. Renders either item set.
  guided-note/
    guided-note-template.ts      TipTap JSON template with inline "try it" prompts.

supabase/migrations/028_onboarding_progress.sql   Adds profiles.onboarding_progress jsonb.
```

Integration edits to existing files (no structural changes): mount `OnboardingProvider`, add a `useOnboarding`-driven mount in the workspace, add 8 `reportOnboardingEvent` calls, add 5 `data-tour` attributes.

## Shared contracts (defined in Task 1, referenced everywhere)

```ts
// src/notepad/onboarding/onboarding-types.ts
export type OnboardingEvent =
  | 'note-created'
  | 'verse-linked'
  | 'highlight-created'
  | 'scan-completed'
  | 'folder-created'
  | 'graph-visited'
  | 'lamplight-connection'
  | 'search-used';

export type AnonItemId = 'write-first-note' | 'link-verse' | 'highlight' | 'create-account';
export type JourneyItemId =
  | 'first-study-note' | 'create-folder' | 'scan-note'
  | 'lamplight-connections' | 'visit-graph' | 'streak-3' | 'search-notes';

export type GuidedNoteStatus = 'pending' | 'done' | 'skipped';

export interface AnonProgress {
  /** itemId -> ISO completion timestamp. */
  items: Partial<Record<AnonItemId, string>>;
  dismissed: boolean;
}

export interface AccountProgress {
  guidedNote: GuidedNoteStatus;
  /** itemId -> ISO completion timestamp. */
  items: Partial<Record<JourneyItemId, string>>;
  dismissed: boolean;
  /** distinct 'YYYY-MM-DD' study dates, ascending. */
  studyDates: string[];
  /** set true after the one-time anon->account merge. */
  merged: boolean;
}

export type OnboardingAction =
  | { kind: 'start-tour' }
  | { kind: 'show-get-started' }
  | { kind: 'offer-guided-note' }
  | { kind: 'show-journey' };
```

---

### Task 1: Types, constants, and event→item maps

**Files:**
- Create: `src/notepad/onboarding/onboarding-types.ts`
- Test: `src/notepad/onboarding/onboarding-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/onboarding/onboarding-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  ANON_EVENT_TO_ITEM,
  JOURNEY_EVENT_TO_ITEM,
  defaultAccountProgress,
  defaultAnonProgress,
} from './onboarding-types';

describe('onboarding event maps', () => {
  it('maps anon completion events to anon item ids', () => {
    expect(ANON_EVENT_TO_ITEM['note-created']).toBe('write-first-note');
    expect(ANON_EVENT_TO_ITEM['verse-linked']).toBe('link-verse');
    expect(ANON_EVENT_TO_ITEM['highlight-created']).toBe('highlight');
  });

  it('does not map account-only events into the anon set', () => {
    expect(ANON_EVENT_TO_ITEM['folder-created']).toBeUndefined();
    expect(ANON_EVENT_TO_ITEM['scan-completed']).toBeUndefined();
  });

  it('maps journey events to journey item ids', () => {
    expect(JOURNEY_EVENT_TO_ITEM['note-created']).toBe('first-study-note');
    expect(JOURNEY_EVENT_TO_ITEM['folder-created']).toBe('create-folder');
    expect(JOURNEY_EVENT_TO_ITEM['scan-completed']).toBe('scan-note');
    expect(JOURNEY_EVENT_TO_ITEM['lamplight-connection']).toBe('lamplight-connections');
    expect(JOURNEY_EVENT_TO_ITEM['graph-visited']).toBe('visit-graph');
    expect(JOURNEY_EVENT_TO_ITEM['search-used']).toBe('search-notes');
  });

  it('streak-3 is not directly event-mapped (computed from studyDates)', () => {
    expect(Object.values(JOURNEY_EVENT_TO_ITEM)).not.toContain('streak-3');
  });

  it('default progress shapes are empty and unmerged', () => {
    expect(defaultAnonProgress()).toEqual({ items: {}, dismissed: false });
    expect(defaultAccountProgress()).toEqual({
      guidedNote: 'pending', items: {}, dismissed: false, studyDates: [], merged: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/onboarding-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/onboarding/onboarding-types.ts
export type OnboardingEvent =
  | 'note-created' | 'verse-linked' | 'highlight-created' | 'scan-completed'
  | 'folder-created' | 'graph-visited' | 'lamplight-connection' | 'search-used';

export type AnonItemId = 'write-first-note' | 'link-verse' | 'highlight' | 'create-account';
export type JourneyItemId =
  | 'first-study-note' | 'create-folder' | 'scan-note'
  | 'lamplight-connections' | 'visit-graph' | 'streak-3' | 'search-notes';

export type GuidedNoteStatus = 'pending' | 'done' | 'skipped';

export interface AnonProgress {
  items: Partial<Record<AnonItemId, string>>;
  dismissed: boolean;
}

export interface AccountProgress {
  guidedNote: GuidedNoteStatus;
  items: Partial<Record<JourneyItemId, string>>;
  dismissed: boolean;
  studyDates: string[];
  merged: boolean;
}

export type OnboardingAction =
  | { kind: 'start-tour' }
  | { kind: 'show-get-started' }
  | { kind: 'offer-guided-note' }
  | { kind: 'show-journey' };

/** Anonymous "Get started" checklist completes only on these three events;
 *  'create-account' completes when the user signs in (handled in the provider). */
export const ANON_EVENT_TO_ITEM: Partial<Record<OnboardingEvent, AnonItemId>> = {
  'note-created': 'write-first-note',
  'verse-linked': 'link-verse',
  'highlight-created': 'highlight',
};

/** "Your journey" checklist mapping. streak-3 is computed from studyDates, not an event. */
export const JOURNEY_EVENT_TO_ITEM: Partial<Record<OnboardingEvent, JourneyItemId>> = {
  'note-created': 'first-study-note',
  'folder-created': 'create-folder',
  'scan-completed': 'scan-note',
  'lamplight-connection': 'lamplight-connections',
  'graph-visited': 'visit-graph',
  'search-used': 'search-notes',
};

/** Accounts created at/after this instant are eligible for the journey lane.
 *  Set to the feature launch date so existing users see nothing new. */
export const ONBOARDING_LAUNCH_MS = Date.parse('2026-06-11T00:00:00.000Z');

export const ALL_JOURNEY_ITEM_IDS: JourneyItemId[] = [
  'first-study-note', 'create-folder', 'scan-note',
  'lamplight-connections', 'visit-graph', 'streak-3', 'search-notes',
];

export const ALL_ANON_ITEM_IDS: AnonItemId[] = [
  'write-first-note', 'link-verse', 'highlight', 'create-account',
];

export function defaultAnonProgress(): AnonProgress {
  return { items: {}, dismissed: false };
}

export function defaultAccountProgress(): AccountProgress {
  return { guidedNote: 'pending', items: {}, dismissed: false, studyDates: [], merged: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/onboarding-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/onboarding-types.ts src/notepad/onboarding/onboarding-types.test.ts
git commit -m "feat(onboarding): shared types, item ids, and event maps"
```

---

### Task 2: Streak calculation (pure)

**Files:**
- Create: `src/notepad/onboarding/streak.ts`
- Test: `src/notepad/onboarding/streak.test.ts`

Spec: "Streak: computed from distinct study dates appended per session with any note edit; three consecutive days completes the item."

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/onboarding/streak.test.ts
import { describe, it, expect } from 'vitest';
import { appendStudyDate, hasThreeConsecutiveDays } from './streak';

describe('appendStudyDate', () => {
  it('adds a new date and keeps the list sorted ascending', () => {
    expect(appendStudyDate(['2026-06-10'], '2026-06-09')).toEqual(['2026-06-09', '2026-06-10']);
  });
  it('is idempotent for a date already present', () => {
    expect(appendStudyDate(['2026-06-10'], '2026-06-10')).toEqual(['2026-06-10']);
  });
  it('returns a new array (no mutation)', () => {
    const input = ['2026-06-10'];
    appendStudyDate(input, '2026-06-11');
    expect(input).toEqual(['2026-06-10']);
  });
});

describe('hasThreeConsecutiveDays', () => {
  it('true for three consecutive calendar days', () => {
    expect(hasThreeConsecutiveDays(['2026-06-09', '2026-06-10', '2026-06-11'])).toBe(true);
  });
  it('true when a 3-run exists with extra non-adjacent dates', () => {
    expect(hasThreeConsecutiveDays(['2026-06-01', '2026-06-09', '2026-06-10', '2026-06-11'])).toBe(true);
  });
  it('false for a gap inside the window', () => {
    expect(hasThreeConsecutiveDays(['2026-06-09', '2026-06-11', '2026-06-12'])).toBe(false);
  });
  it('false for fewer than three dates', () => {
    expect(hasThreeConsecutiveDays(['2026-06-10', '2026-06-11'])).toBe(false);
  });
  it('handles month/year boundary', () => {
    expect(hasThreeConsecutiveDays(['2026-12-30', '2026-12-31', '2027-01-01'])).toBe(true);
  });
  it('ignores duplicate dates when counting the run', () => {
    expect(hasThreeConsecutiveDays(['2026-06-09', '2026-06-09', '2026-06-10', '2026-06-11'])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/streak.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/onboarding/streak.ts
/** 'YYYY-MM-DD' strings. Pure; no Date.now coupling — caller passes today's date. */

export function appendStudyDate(dates: string[], todayYMD: string): string[] {
  const set = new Set(dates);
  set.add(todayYMD);
  return [...set].sort();
}

/** True if the distinct dates contain any run of three consecutive calendar days. */
export function hasThreeConsecutiveDays(dates: string[]): boolean {
  const distinct = [...new Set(dates)].sort();
  if (distinct.length < 3) return false;
  for (let i = 0; i + 2 < distinct.length; i++) {
    if (isNextDay(distinct[i], distinct[i + 1]) && isNextDay(distinct[i + 1], distinct[i + 2])) {
      return true;
    }
  }
  return false;
}

function isNextDay(a: string, b: string): boolean {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  return db - da === 86_400_000;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/streak.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/streak.ts src/notepad/onboarding/streak.test.ts
git commit -m "feat(onboarding): pure study-date streak helpers"
```

---

### Task 3: OnboardingState — decision table (pure)

**Files:**
- Create: `src/notepad/onboarding/onboarding-state.ts`
- Test: `src/notepad/onboarding/onboarding-state.test.ts`

This is the load-bearing module. It must cover **every auth/storage combination**. Mirrors `decideFirstLoadActions`: empty list while loading; pure, no React.

Decision contract:

```ts
interface OnboardingStateInput {
  authLoading: boolean;
  signedIn: boolean;
  /** account created at/after ONBOARDING_LAUNCH_MS — gating for the journey lane. */
  eligibleForJourney: boolean;
  anonTourDone: boolean;
  anon: AnonProgress | null;        // null == no anon data yet
  account: AccountProgress | null;  // null == no account row yet
}
```

Rules (the table the tests enumerate):
- `authLoading` → `[]`.
- **Signed out:**
  - `!anonTourDone` → `['start-tour', 'show-get-started']`.
  - `anonTourDone` and checklist not dismissed → `['show-get-started']`.
  - `anonTourDone` and `anon.dismissed` → `[]`.
- **Signed in but `!eligibleForJourney`** → `[]` (existing users see nothing new).
- **Signed in and eligible** (treat `account == null` as `defaultAccountProgress()`):
  - journey complete (all 7 items present) OR `account.dismissed` → `[]`.
  - else if `guidedNote === 'pending'` → `['offer-guided-note', 'show-journey']`.
  - else (`done`/`skipped`) → `['show-journey']`.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/onboarding/onboarding-state.test.ts
import { describe, it, expect } from 'vitest';
import { decideOnboardingActions } from './onboarding-state';
import type { AccountProgress, AnonProgress } from './onboarding-types';
import { ALL_JOURNEY_ITEM_IDS, defaultAccountProgress } from './onboarding-types';

const anon = (over: Partial<AnonProgress> = {}): AnonProgress => ({ items: {}, dismissed: false, ...over });
const acct = (over: Partial<AccountProgress> = {}): AccountProgress => ({ ...defaultAccountProgress(), ...over });

describe('decideOnboardingActions', () => {
  it('returns nothing while auth is loading', () => {
    expect(decideOnboardingActions({
      authLoading: true, signedIn: false, eligibleForJourney: false,
      anonTourDone: false, anon: null, account: null,
    })).toEqual([]);
  });

  describe('signed out (anonymous lane)', () => {
    it('first visit: starts tour and shows get-started', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: false, eligibleForJourney: false,
        anonTourDone: false, anon: null, account: null,
      })).toEqual([{ kind: 'start-tour' }, { kind: 'show-get-started' }]);
    });
    it('tour done, checklist active: shows get-started only', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: false, eligibleForJourney: false,
        anonTourDone: true, anon: anon(), account: null,
      })).toEqual([{ kind: 'show-get-started' }]);
    });
    it('tour done, checklist dismissed: nothing', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: false, eligibleForJourney: false,
        anonTourDone: true, anon: anon({ dismissed: true }), account: null,
      })).toEqual([]);
    });
  });

  describe('signed in', () => {
    it('ineligible account (pre-launch): nothing', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: false,
        anonTourDone: true, anon: null, account: acct(),
      })).toEqual([]);
    });
    it('eligible, guided note pending: offers guided note + journey', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: acct({ guidedNote: 'pending' }),
      })).toEqual([{ kind: 'offer-guided-note' }, { kind: 'show-journey' }]);
    });
    it('eligible, null account treated as fresh -> offer + journey', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: null,
      })).toEqual([{ kind: 'offer-guided-note' }, { kind: 'show-journey' }]);
    });
    it('eligible, guided note skipped: journey only', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: acct({ guidedNote: 'skipped' }),
      })).toEqual([{ kind: 'show-journey' }]);
    });
    it('eligible, journey dismissed: nothing', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: acct({ guidedNote: 'done', dismissed: true }),
      })).toEqual([]);
    });
    it('eligible, all journey items complete: nothing (retires itself)', () => {
      const items = Object.fromEntries(ALL_JOURNEY_ITEM_IDS.map((id) => [id, '2026-06-11T00:00:00Z']));
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null,
        account: acct({ guidedNote: 'done', items: items as AccountProgress['items'] }),
      })).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/onboarding-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/onboarding/onboarding-state.ts
import type { AccountProgress, AnonProgress, OnboardingAction } from './onboarding-types';
import { ALL_JOURNEY_ITEM_IDS, defaultAccountProgress } from './onboarding-types';

export interface OnboardingStateInput {
  authLoading: boolean;
  signedIn: boolean;
  eligibleForJourney: boolean;
  anonTourDone: boolean;
  anon: AnonProgress | null;
  account: AccountProgress | null;
}

export function decideOnboardingActions(input: OnboardingStateInput): OnboardingAction[] {
  if (input.authLoading) return [];

  if (!input.signedIn) {
    if (!input.anonTourDone) {
      return [{ kind: 'start-tour' }, { kind: 'show-get-started' }];
    }
    if (input.anon?.dismissed) return [];
    return [{ kind: 'show-get-started' }];
  }

  if (!input.eligibleForJourney) return [];

  const account = input.account ?? defaultAccountProgress();
  if (account.dismissed || isJourneyComplete(account)) return [];

  if (account.guidedNote === 'pending') {
    return [{ kind: 'offer-guided-note' }, { kind: 'show-journey' }];
  }
  return [{ kind: 'show-journey' }];
}

export function isJourneyComplete(account: AccountProgress): boolean {
  return ALL_JOURNEY_ITEM_IDS.every((id) => account.items[id] != null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/onboarding-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/onboarding-state.ts src/notepad/onboarding/onboarding-state.test.ts
git commit -m "feat(onboarding): OnboardingState pure decision table"
```

---

### Task 4: Anon→account merge (pure, idempotent)

**Files:**
- Create: `src/notepad/onboarding/merge-anon-progress.ts`
- Test: `src/notepad/onboarding/merge-anon-progress.test.ts`

Spec: note/verse/highlight completions pre-credit the journey checklist; a completed anonymous "first note" auto-skips the guided first-study note; a `merged` flag makes the merge idempotent. Of the anon items, only `write-first-note` maps to a journey item (`first-study-note`) — and it additionally auto-skips the guided note. `link-verse`/`highlight` have no journey counterpart (those were guided-note sub-steps, and the guided note is auto-skipped), so they credit nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/onboarding/merge-anon-progress.test.ts
import { describe, it, expect } from 'vitest';
import { mergeAnonIntoAccount } from './merge-anon-progress';
import { defaultAccountProgress, defaultAnonProgress } from './onboarding-types';

const NOW = '2026-06-11T12:00:00.000Z';

describe('mergeAnonIntoAccount', () => {
  it('is a no-op when account is already merged', () => {
    const account = { ...defaultAccountProgress(), merged: true, guidedNote: 'done' as const };
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': NOW } };
    expect(mergeAnonIntoAccount(anon, true, account, NOW)).toBe(account);
  });

  it('credits first-study-note and auto-skips the guided note when anon first-note done', () => {
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': '2026-06-10T09:00:00Z' } };
    const out = mergeAnonIntoAccount(anon, false, null, NOW);
    expect(out.items['first-study-note']).toBe('2026-06-10T09:00:00Z');
    expect(out.guidedNote).toBe('skipped');
    expect(out.merged).toBe(true);
  });

  it('leaves guided note pending when anon has no first note', () => {
    const anon = { ...defaultAnonProgress(), items: { 'highlight': NOW } };
    const out = mergeAnonIntoAccount(anon, false, null, NOW);
    expect(out.items['first-study-note']).toBeUndefined();
    expect(out.guidedNote).toBe('pending');
    expect(out.merged).toBe(true);
  });

  it('handles null anon (no anonymous activity)', () => {
    const out = mergeAnonIntoAccount(null, false, null, NOW);
    expect(out).toEqual({ ...defaultAccountProgress(), merged: true });
  });

  it('preserves existing account journey items already credited', () => {
    const account = { ...defaultAccountProgress(), items: { 'create-folder': '2026-06-01T00:00:00Z' } };
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': NOW } };
    const out = mergeAnonIntoAccount(anon, false, account, NOW);
    expect(out.items['create-folder']).toBe('2026-06-01T00:00:00Z');
    expect(out.items['first-study-note']).toBe(NOW);
  });

  it('is idempotent: merging the result again returns it unchanged', () => {
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': NOW } };
    const once = mergeAnonIntoAccount(anon, false, null, NOW);
    const twice = mergeAnonIntoAccount(anon, false, once, NOW);
    expect(twice).toEqual(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/merge-anon-progress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/onboarding/merge-anon-progress.ts
import type { AccountProgress, AnonProgress } from './onboarding-types';
import { defaultAccountProgress } from './onboarding-types';

/** One-time idempotent merge of anonymous progress into the account.
 *  Returns the same reference unchanged when account.merged is already true. */
export function mergeAnonIntoAccount(
  anon: AnonProgress | null,
  _anonTourDone: boolean,
  account: AccountProgress | null,
  nowIso: string,
): AccountProgress {
  if (account?.merged) return account;

  const base = account ?? defaultAccountProgress();
  const next: AccountProgress = {
    ...base,
    items: { ...base.items },
    studyDates: [...base.studyDates],
    merged: true,
  };

  const anonFirstNote = anon?.items['write-first-note'];
  if (anonFirstNote) {
    if (next.items['first-study-note'] == null) next.items['first-study-note'] = anonFirstNote;
    if (next.guidedNote === 'pending') next.guidedNote = 'skipped';
  }

  return next;
}
```

Note: `nowIso` is kept in the signature for symmetry with the provider call site and future credit timestamps; the current rules reuse the anon timestamp. Do not remove it — the provider passes it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/merge-anon-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/merge-anon-progress.ts src/notepad/onboarding/merge-anon-progress.test.ts
git commit -m "feat(onboarding): idempotent anon->account merge"
```

---

### Task 5: Anonymous localStorage boundary

**Files:**
- Create: `src/notepad/onboarding/onboarding-storage.ts`
- Test: `src/notepad/onboarding/onboarding-storage.test.ts`

Mirrors the `TreeViewState`/`NotepadFirstLoad` storage-helper pattern: accept `Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>` so it's testable without a DOM; degrade to "ignore and continue" on malformed JSON / quota errors. Keys: `onboarding_anon_tour_done`, `onboarding_anon_checklist`.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/onboarding/onboarding-storage.test.ts
import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_ANON_TOUR_DONE_KEY, ONBOARDING_ANON_CHECKLIST_KEY,
  readAnonTourDone, markAnonTourDone,
  readAnonProgress, writeAnonProgress, clearAnon,
} from './onboarding-storage';
import { defaultAnonProgress } from './onboarding-types';

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('onboarding anon storage', () => {
  it('tour-done round-trips', () => {
    const s = fakeStorage();
    expect(readAnonTourDone(s)).toBe(false);
    markAnonTourDone(s);
    expect(s.data.get(ONBOARDING_ANON_TOUR_DONE_KEY)).toBe('1');
    expect(readAnonTourDone(s)).toBe(true);
  });

  it('checklist progress round-trips', () => {
    const s = fakeStorage();
    expect(readAnonProgress(s)).toBeNull();
    const p = { ...defaultAnonProgress(), items: { highlight: '2026-06-11T00:00:00Z' } };
    writeAnonProgress(s, p);
    expect(s.data.get(ONBOARDING_ANON_CHECKLIST_KEY)).toBeTypeOf('string');
    expect(readAnonProgress(s)).toEqual(p);
  });

  it('returns null on malformed JSON instead of throwing', () => {
    const s = fakeStorage();
    s.data.set(ONBOARDING_ANON_CHECKLIST_KEY, '{not json');
    expect(readAnonProgress(s)).toBeNull();
  });

  it('write failures are swallowed', () => {
    const s = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(() => writeAnonProgress(s, defaultAnonProgress())).not.toThrow();
    expect(() => markAnonTourDone(s)).not.toThrow();
  });

  it('clearAnon removes both keys', () => {
    const s = fakeStorage();
    markAnonTourDone(s);
    writeAnonProgress(s, defaultAnonProgress());
    clearAnon(s);
    expect(s.data.has(ONBOARDING_ANON_TOUR_DONE_KEY)).toBe(false);
    expect(s.data.has(ONBOARDING_ANON_CHECKLIST_KEY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/onboarding-storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/onboarding/onboarding-storage.ts
import type { AnonProgress } from './onboarding-types';

export const ONBOARDING_ANON_TOUR_DONE_KEY = 'onboarding_anon_tour_done';
export const ONBOARDING_ANON_CHECKLIST_KEY = 'onboarding_anon_checklist';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readAnonTourDone(storage: StorageLike): boolean {
  try {
    return storage.getItem(ONBOARDING_ANON_TOUR_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markAnonTourDone(storage: StorageLike): void {
  try {
    storage.setItem(ONBOARDING_ANON_TOUR_DONE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function readAnonProgress(storage: StorageLike): AnonProgress | null {
  try {
    const raw = storage.getItem(ONBOARDING_ANON_CHECKLIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnonProgress;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return { items: parsed.items ?? {}, dismissed: Boolean(parsed.dismissed) };
  } catch {
    return null;
  }
}

export function writeAnonProgress(storage: StorageLike, progress: AnonProgress): void {
  try {
    storage.setItem(ONBOARDING_ANON_CHECKLIST_KEY, JSON.stringify(progress));
  } catch {
    /* ignore */
  }
}

export function clearAnon(storage: StorageLike): void {
  try {
    storage.removeItem(ONBOARDING_ANON_TOUR_DONE_KEY);
    storage.removeItem(ONBOARDING_ANON_CHECKLIST_KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/onboarding-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/onboarding-storage.ts src/notepad/onboarding/onboarding-storage.test.ts
git commit -m "feat(onboarding): anonymous localStorage boundary"
```

---

### Task 6: Account progress adapters (local + Supabase) + selection hook

**Files:**
- Create: `src/notepad/onboarding/adapters/types.ts`
- Create: `src/notepad/onboarding/adapters/local-onboarding-adapter.ts`
- Create: `src/notepad/onboarding/adapters/supabase-onboarding-adapter.ts`
- Create: `src/notepad/onboarding/useOnboardingAdapter.ts`
- Test: `src/notepad/onboarding/adapters/local-onboarding-adapter.test.ts`
- Test: `src/notepad/onboarding/adapters/supabase-onboarding-adapter.test.ts`

Mirrors `src/notepad/bible/highlights/` exactly: an interface, a local adapter (userId-scoped localStorage; this is also the write-fail cache for the Supabase path), a Supabase adapter reading/writing `profiles.onboarding_progress`, and a `useMemo` selection mirroring `useBibleHighlights` (`supabase && userId ? Supabase : local`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/notepad/onboarding/adapters/local-onboarding-adapter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalOnboardingAdapter } from './local-onboarding-adapter';
import { defaultAccountProgress } from '../onboarding-types';

describe('LocalOnboardingAdapter', () => {
  beforeEach(() => localStorage.clear());

  it('returns null before anything is saved', async () => {
    const a = new LocalOnboardingAdapter('u1');
    expect(await a.getProgress()).toBeNull();
  });

  it('saves and reloads progress scoped by user id', async () => {
    const a = new LocalOnboardingAdapter('u1');
    const p = { ...defaultAccountProgress(), guidedNote: 'done' as const };
    await a.saveProgress(p);
    expect(await a.getProgress()).toEqual(p);
    // different user is isolated
    expect(await new LocalOnboardingAdapter('u2').getProgress()).toBeNull();
  });
});
```

```ts
// src/notepad/onboarding/adapters/supabase-onboarding-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SupabaseOnboardingAdapter } from './supabase-onboarding-adapter';
import { defaultAccountProgress } from '../onboarding-types';

function fakeClient(row: unknown) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const eqSelect = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: eqSelect }));
  const eqUpdate = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq: eqUpdate }));
  const from = vi.fn(() => ({ select, update }));
  return { client: { from } as any, from, select, update, eqUpdate };
}

describe('SupabaseOnboardingAdapter', () => {
  it('reads onboarding_progress for the user', async () => {
    const p = { ...defaultAccountProgress(), guidedNote: 'skipped' as const };
    const f = fakeClient({ onboarding_progress: p });
    const a = new SupabaseOnboardingAdapter(f.client, 'u1');
    expect(await a.getProgress()).toEqual(p);
    expect(f.from).toHaveBeenCalledWith('profiles');
    expect(f.select).toHaveBeenCalledWith('onboarding_progress');
  });

  it('returns null when the column is empty', async () => {
    const f = fakeClient({ onboarding_progress: null });
    expect(await new SupabaseOnboardingAdapter(f.client, 'u1').getProgress()).toBeNull();
  });

  it('writes the column via update().eq(id)', async () => {
    const f = fakeClient({ onboarding_progress: null });
    const a = new SupabaseOnboardingAdapter(f.client, 'u1');
    const p = defaultAccountProgress();
    await a.saveProgress(p);
    expect(f.update).toHaveBeenCalledWith({ onboarding_progress: p });
    expect(f.eqUpdate).toHaveBeenCalledWith('id', 'u1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/onboarding/adapters/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```ts
// src/notepad/onboarding/adapters/types.ts
import type { AccountProgress } from '../onboarding-types';

export interface OnboardingProgressAdapter {
  getProgress(): Promise<AccountProgress | null>;
  saveProgress(progress: AccountProgress): Promise<void>;
}
```

```ts
// src/notepad/onboarding/adapters/local-onboarding-adapter.ts
import type { AccountProgress } from '../onboarding-types';
import type { OnboardingProgressAdapter } from './types';

const keyFor = (userId: string) => `onboarding_account_progress_${userId}`;

/** localStorage-backed account progress. Used offline, and as the retry cache
 *  when the Supabase write path is unavailable (spec: degrade silently). */
export class LocalOnboardingAdapter implements OnboardingProgressAdapter {
  #key: string;
  constructor(userId: string) {
    this.#key = keyFor(userId);
  }
  async getProgress(): Promise<AccountProgress | null> {
    try {
      const raw = localStorage.getItem(this.#key);
      return raw ? (JSON.parse(raw) as AccountProgress) : null;
    } catch {
      return null;
    }
  }
  async saveProgress(progress: AccountProgress): Promise<void> {
    try {
      localStorage.setItem(this.#key, JSON.stringify(progress));
    } catch {
      /* ignore */
    }
  }
}
```

```ts
// src/notepad/onboarding/adapters/supabase-onboarding-adapter.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountProgress } from '../onboarding-types';
import type { OnboardingProgressAdapter } from './types';

export class SupabaseOnboardingAdapter implements OnboardingProgressAdapter {
  #client: SupabaseClient;
  #userId: string;
  constructor(client: SupabaseClient, userId: string) {
    this.#client = client;
    this.#userId = userId;
  }
  async getProgress(): Promise<AccountProgress | null> {
    const { data, error } = await this.#client
      .from('profiles')
      .select('onboarding_progress')
      .eq('id', this.#userId)
      .single();
    if (error) throw error;
    return (data?.onboarding_progress as AccountProgress | null) ?? null;
  }
  async saveProgress(progress: AccountProgress): Promise<void> {
    const { error } = await this.#client
      .from('profiles')
      .update({ onboarding_progress: progress })
      .eq('id', this.#userId);
    if (error) throw error;
  }
}
```

```ts
// src/notepad/onboarding/useOnboardingAdapter.ts
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type { OnboardingProgressAdapter } from './adapters/types';
import { LocalOnboardingAdapter } from './adapters/local-onboarding-adapter';
import { SupabaseOnboardingAdapter } from './adapters/supabase-onboarding-adapter';

/** Account-progress adapter selection, mirroring useBibleHighlights.
 *  Returns null when there is no signed-in user (anonymous lane uses localStorage helpers). */
export function useOnboardingAdapter(userId: string | null): OnboardingProgressAdapter | null {
  return useMemo(() => {
    if (!userId) return null;
    if (supabase) return new SupabaseOnboardingAdapter(supabase, userId);
    return new LocalOnboardingAdapter(userId);
  }, [userId]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/onboarding/adapters/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/adapters src/notepad/onboarding/useOnboardingAdapter.ts
git commit -m "feat(onboarding): account progress adapters + selection hook"
```

---

### Task 7: Migration 028 — profiles.onboarding_progress JSONB column

**Files:**
- Create: `supabase/migrations/028_onboarding_progress.sql`

CAUTION (from `021_protect_privileged_profile_columns.sql`): `onboarding_progress` must stay **user-writable**. Do NOT add it to the protected-columns trigger. The existing `profiles` UPDATE policy is `using (auth.uid() = id)`, and because the column is not in the trigger's blocked list, an authenticated user can self-update it. No RLS or trigger change is needed — only the column.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/028_onboarding_progress.sql
-- Notepad onboarding: per-user "Your journey" progress for accounts created
-- after the onboarding feature launch. Shape (TS AccountProgress):
--   { guidedNote: 'pending'|'done'|'skipped', items: Record<itemId, isoTimestamp>,
--     dismissed: boolean, studyDates: string[], merged: boolean }
--
-- INTENTIONALLY user-writable. The profiles UPDATE policy (auth.uid() = id) already
-- allows self-update, and this column is deliberately NOT added to
-- protect_privileged_profile_columns() (021) — onboarding progress is owned by the
-- user, unlike is_admin / note_count / highest_note_count.
alter table public.profiles
  add column if not exists onboarding_progress jsonb;
```

- [ ] **Step 2: Verify it does not touch the protected-columns trigger**

Run: `grep -n "onboarding_progress" supabase/migrations/021_protect_privileged_profile_columns.sql`
Expected: no output (column is absent from the protected list — correct).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/028_onboarding_progress.sql
git commit -m "feat(onboarding): migration 028 add profiles.onboarding_progress jsonb"
```

> **Deploy note (do at ship time, not now):** apply with `supabase db push`. Verify Supabase CLI link state first (memory: manual migration apply is the norm — e.g. 027 still needed a manual apply). Signed-in journey persistence is inert until this column exists; it degrades silently in the meantime.

---

### Task 8: Checklist item definitions (get-started + journey)

**Files:**
- Create: `src/notepad/onboarding/checklist/get-started-items.ts`
- Create: `src/notepad/onboarding/checklist/journey-items.ts`
- Test: `src/notepad/onboarding/checklist/items.test.ts`

Pure data + a labels contract the panel renders. Keeping copy here (not in JSX) keeps the panel a thin renderer.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/onboarding/checklist/items.test.ts
import { describe, it, expect } from 'vitest';
import { GET_STARTED_ITEMS } from './get-started-items';
import { JOURNEY_ITEMS } from './journey-items';
import { ALL_ANON_ITEM_IDS, ALL_JOURNEY_ITEM_IDS } from '../onboarding-types';

describe('checklist item definitions', () => {
  it('get-started has exactly the 4 anon items with labels, in order', () => {
    expect(GET_STARTED_ITEMS.map((i) => i.id)).toEqual([
      'write-first-note', 'link-verse', 'highlight', 'create-account',
    ]);
    expect(GET_STARTED_ITEMS.every((i) => i.label.length > 0)).toBe(true);
    expect(new Set(GET_STARTED_ITEMS.map((i) => i.id))).toEqual(new Set(ALL_ANON_ITEM_IDS));
  });

  it('journey has exactly the 7 items with labels, in order', () => {
    expect(JOURNEY_ITEMS.map((i) => i.id)).toEqual([
      'first-study-note', 'create-folder', 'scan-note',
      'lamplight-connections', 'visit-graph', 'streak-3', 'search-notes',
    ]);
    expect(JOURNEY_ITEMS.every((i) => i.label.length > 0)).toBe(true);
    expect(new Set(JOURNEY_ITEMS.map((i) => i.id))).toEqual(new Set(ALL_JOURNEY_ITEM_IDS));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/checklist/items.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```ts
// src/notepad/onboarding/checklist/get-started-items.ts
import type { AnonItemId } from '../onboarding-types';

export interface ChecklistItemDef<Id extends string> {
  id: Id;
  label: string;
  hint?: string;
}

export const GET_STARTED_ITEMS: ChecklistItemDef<AnonItemId>[] = [
  { id: 'write-first-note', label: 'Write your first note' },
  { id: 'link-verse', label: 'Link a verse' },
  { id: 'highlight', label: 'Highlight something' },
  { id: 'create-account', label: 'Create an account', hint: 'Save your work across devices' },
];
```

```ts
// src/notepad/onboarding/checklist/journey-items.ts
import type { JourneyItemId } from '../onboarding-types';
import type { ChecklistItemDef } from './get-started-items';

export const JOURNEY_ITEMS: ChecklistItemDef<JourneyItemId>[] = [
  { id: 'first-study-note', label: 'Complete your first study note' },
  { id: 'create-folder', label: 'Create a folder' },
  { id: 'scan-note', label: 'Scan a handwritten note' },
  { id: 'lamplight-connections', label: 'Explore Lamplight connections' },
  { id: 'visit-graph', label: 'Visit your connections graph' },
  { id: 'streak-3', label: 'Study 3 days in a row' },
  { id: 'search-notes', label: 'Search your notes' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/checklist/items.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/checklist/get-started-items.ts src/notepad/onboarding/checklist/journey-items.ts src/notepad/onboarding/checklist/items.test.ts
git commit -m "feat(onboarding): get-started and journey checklist item definitions"
```

---

### Task 9: Guided-note TipTap template

**Files:**
- Create: `src/notepad/onboarding/guided-note/guided-note-template.ts`
- Test: `src/notepad/onboarding/guided-note/guided-note-template.test.ts`

A templated TipTap doc with inline do-it prompts (link a verse, highlight it, ask Lamplight). The function returns `{ title, content }` where `content` is a JSON string (the shape `StorageAdapter.createNote` stores). Validate it's parseable and contains the three prompts. Reference an existing note's content shape — confirm the editor uses `StarterKit` doc JSON (per CONTEXT.md `NoteEditor`).

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/onboarding/guided-note/guided-note-template.test.ts
import { describe, it, expect } from 'vitest';
import { buildGuidedNote } from './guided-note-template';

describe('buildGuidedNote', () => {
  it('returns a titled note with valid TipTap doc JSON', () => {
    const note = buildGuidedNote();
    expect(note.title.length).toBeGreaterThan(0);
    const doc = JSON.parse(note.content);
    expect(doc.type).toBe('doc');
    expect(Array.isArray(doc.content)).toBe(true);
  });

  it('includes the three inline try-it prompts as plain text', () => {
    const text = JSON.stringify(JSON.parse(buildGuidedNote().content));
    expect(text).toMatch(/link a verse/i);
    expect(text).toMatch(/highlight/i);
    expect(text).toMatch(/lamplight/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/guided-note/guided-note-template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/onboarding/guided-note/guided-note-template.ts
/** A first-study note seeded with inline "try it" prompts. content is TipTap
 *  doc JSON stringified — the shape StorageAdapter.createNote stores. */
export function buildGuidedNote(): { title: string; content: string } {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Your first study note' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Welcome! This note walks you through three things that make studying here powerful. Edit freely — it is yours.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '1. Link a verse — type a reference like John 3:16 and it becomes a living link.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '2. Highlight a line — select any text and pick a highlight color from the toolbar.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '3. Ask Lamplight — open the Lamplight panel to discover connections to your other notes.' }] },
    ],
  };
  return { title: 'Your first study note', content: JSON.stringify(doc) };
}
```

> **Verify before shipping:** open one existing note and confirm the `doc`/`heading`/`paragraph` node names match what `NoteEditor`'s StarterKit produces (CONTEXT.md §NoteEditor lists the extensions). Adjust node names if the repo's StarterKit config differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/guided-note/guided-note-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/guided-note/
git commit -m "feat(onboarding): guided first-study note template"
```

---

### Task 10: OnboardingProvider + useOnboarding (context, merge, optimistic writes)

**Files:**
- Create: `src/notepad/onboarding/OnboardingProvider.tsx`
- Create: `src/notepad/onboarding/useOnboarding.ts`
- Test: `src/notepad/onboarding/OnboardingProvider.test.tsx`

The runtime brain. Owns progress state, runs the one-time merge on first signed-in load, computes `actions` via `decideOnboardingActions`, and exposes `reportOnboardingEvent`. Writes are optimistic (state updates immediately; adapter write follows; failure keeps in-memory + local cache). Everything wrapped so a null adapter / thrown adapter never breaks the notepad.

Context value:

```ts
export interface OnboardingContextValue {
  actions: OnboardingAction[];
  anon: AnonProgress | null;
  account: AccountProgress | null;
  reportOnboardingEvent: (event: OnboardingEvent) => void;
  completeGuidedNote: (status: 'done' | 'skipped') => void;
  dismissChecklist: () => void;
  replayTour: () => void;
  markTourDone: () => void;
}
```

Provider responsibilities (implementation guidance — keep the brain here, keep components dumb):
- Read `useAuthSession()` → `{ user, loading }`. `userId = user?.id ?? null`. `signedIn = !!user`.
- `eligibleForJourney`: `user?.created_at` parsed ≥ `ONBOARDING_LAUNCH_MS` (Supabase `User.created_at` is ISO). Anonymous → false (irrelevant; anon lane is separate).
- Load anon state from `localStorage` via the storage helpers; load account state via `useOnboardingAdapter(userId)` (effect; tolerate throw → fall back to `LocalOnboardingAdapter` cache, then null).
- **Merge once:** on first signed-in load where `account?.merged !== true`, compute `mergeAnonIntoAccount(anon, anonTourDone, account, nowIso)`, persist via adapter (optimistic), then `clearAnon(localStorage)`. Also credit the `create-account` anon item is moot post-merge.
- `reportOnboardingEvent(event)`: if signed out → map via `ANON_EVENT_TO_ITEM`, stamp timestamp, `writeAnonProgress`. If signed in & eligible → map via `JOURNEY_EVENT_TO_ITEM`, stamp, plus on any event append today's date via `appendStudyDate` and set `streak-3` when `hasThreeConsecutiveDays`. Persist via adapter (optimistic). All writes wrapped in try/catch.
- `actions` = `decideOnboardingActions({ authLoading: loading, signedIn, eligibleForJourney, anonTourDone, anon, account })`, memoized.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/onboarding/OnboardingProvider.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { OnboardingProvider } from './OnboardingProvider';
import { useOnboarding } from './useOnboarding';

const authState = vi.fn();
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => authState() }));
// Force the localStorage path for account progress (supabase null).
vi.mock('@/lib/supabase', () => ({ supabase: null }));

function Probe() {
  const o = useOnboarding();
  return (
    <div>
      <span data-testid="actions">{o.actions.map((a) => a.kind).join(',')}</span>
      <button onClick={() => o.reportOnboardingEvent('note-created')}>note</button>
      <span data-testid="anon-first">{String(o.anon?.items['write-first-note'] != null)}</span>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  authState.mockReturnValue({ user: null, loading: false });
});
afterEach(cleanup);

describe('OnboardingProvider', () => {
  it('signed-out first visit yields start-tour + show-get-started', async () => {
    render(<OnboardingProvider><Probe /></OnboardingProvider>);
    await waitFor(() => expect(screen.getByTestId('actions').textContent).toBe('start-tour,show-get-started'));
  });

  it('reportOnboardingEvent(note-created) marks the anon checklist item', async () => {
    render(<OnboardingProvider><Probe /></OnboardingProvider>);
    await act(async () => { screen.getByText('note').click(); });
    await waitFor(() => expect(screen.getByTestId('anon-first').textContent).toBe('true'));
    // persisted to localStorage
    expect(localStorage.getItem('onboarding_anon_checklist')).toContain('write-first-note');
  });

  it('never throws when adapter/auth is degraded', async () => {
    authState.mockReturnValue({ user: { id: 'u1', created_at: '2026-06-12T00:00:00Z' }, loading: false });
    expect(() => render(<OnboardingProvider><Probe /></OnboardingProvider>)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/OnboardingProvider.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the context, hook, and provider**

Implement `useOnboarding.ts` (a `createContext` + `useContext` that throws a clear error if used outside the provider, mirroring how other notepad providers expose hooks). Implement `OnboardingProvider.tsx` per the responsibilities above. Reference `useBibleHighlights.ts` for the optimistic write + `.catch(console.warn)` pattern and `useNotepadFirstLoad.tsx` for effect-driven storage reads. Keep all adapter/auth access inside try/catch so a degraded environment yields empty actions rather than a crash.

Key implementation notes for the implementer:
- Hold `anon`, `account`, `anonTourDone` in `useState`. Hydrate from storage in a mount effect (anon sync; account async).
- `nowIso()` / `todayYMD()`: use `new Date().toISOString()` and slice(0,10) at the call site (not in pure modules — those receive the value).
- On sign-in with `account` lacking `merged`, run merge then `clearAnon`. Guard with a ref so it fires once.
- `markTourDone`/`replayTour` write `onboarding_anon_tour_done` (set / removeItem) and update `anonTourDone` state.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/OnboardingProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/OnboardingProvider.tsx src/notepad/onboarding/useOnboarding.ts src/notepad/onboarding/OnboardingProvider.test.tsx
git commit -m "feat(onboarding): provider with merge, optimistic writes, and actions"
```

---

### Task 11: ChecklistPanel (floating panel ↔ pill, both item sets)

**Files:**
- Create: `src/notepad/onboarding/checklist/ChecklistPanel.tsx`
- Test: `src/notepad/onboarding/checklist/ChecklistPanel.test.tsx`

A floating panel collapsible to a pill, dismissible, rendering either `GET_STARTED_ITEMS` or `JOURNEY_ITEMS` with completion ticks. Driven by props (presentational) so it's testable without the provider; the consuming mount (Task 14) wires it to `useOnboarding`.

Props:

```ts
export interface ChecklistPanelProps {
  title: string;                         // "Get started" | "Your journey"
  items: { id: string; label: string; hint?: string }[];
  completed: Record<string, boolean>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDismiss: () => void;
  onReplayTour?: () => void;             // only the get-started panel passes this
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/onboarding/checklist/ChecklistPanel.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChecklistPanel } from './ChecklistPanel';
import { GET_STARTED_ITEMS } from './get-started-items';

afterEach(cleanup);

const base = {
  title: 'Get started',
  items: GET_STARTED_ITEMS,
  completed: { 'write-first-note': true },
  collapsed: false,
  onToggleCollapsed: vi.fn(),
  onDismiss: vi.fn(),
};

describe('ChecklistPanel', () => {
  it('renders all items and marks completed ones', () => {
    render(<ChecklistPanel {...base} />);
    expect(screen.getByText('Write your first note')).toBeInTheDocument();
    expect(screen.getByText('Link a verse')).toBeInTheDocument();
    // completed item exposes an accessible checked state
    expect(screen.getByRole('checkbox', { name: /write your first note/i })).toBeChecked();
  });

  it('collapsed renders a pill, not the full list', () => {
    render(<ChecklistPanel {...base} collapsed />);
    expect(screen.queryByText('Link a verse')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('dismiss and collapse fire their callbacks', () => {
    const onDismiss = vi.fn();
    const onToggleCollapsed = vi.fn();
    render(<ChecklistPanel {...base} onDismiss={onDismiss} onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(onDismiss).toHaveBeenCalled();
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it('shows replay-tour link when provided', () => {
    render(<ChecklistPanel {...base} onReplayTour={vi.fn()} />);
    expect(screen.getByRole('button', { name: /replay tour/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/checklist/ChecklistPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Build the presentational component. Each item row is a `role="checkbox"` with `aria-checked` and an accessible name equal to its label. Collapsed state renders a single pill `<button>` (accessible name includes the title) that calls `onToggleCollapsed`. Include `Dismiss` and `Collapse` buttons (accessible names) and an optional `Replay tour` button. Match Tailwind conventions used elsewhere in `src/notepad/components/` (read `LevelUpModal.tsx` for the project's modal/overlay class vocabulary). **Do not invent new visual design beyond the spec — if a styling choice isn't specified, keep it minimal and consistent with existing panels; ask the user before any non-specified visual flourish.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/onboarding/checklist/ChecklistPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/checklist/ChecklistPanel.tsx src/notepad/onboarding/checklist/ChecklistPanel.test.tsx
git commit -m "feat(onboarding): ChecklistPanel presentational component"
```

---

### Task 12: SpotlightTour + tour-steps

**Files:**
- Create: `src/notepad/onboarding/tour/tour-steps.ts`
- Create: `src/notepad/onboarding/tour/SpotlightTour.tsx`
- Test: `src/notepad/onboarding/tour/tour-steps.test.ts`
- Test: `src/notepad/onboarding/tour/SpotlightTour.test.tsx`

Custom tour engine — no new deps. Positions from `getBoundingClientRect`; throttled `resize`/`scroll` recompute; reduced-motion via existing `usePrefersReducedMotion`; missing anchor → skip step silently; final card is the sign-up nudge.

`tour-steps.ts`:

```ts
export interface TourStep {
  id: string;
  anchor: string;          // CSS selector, e.g. '[data-tour="new-note-sidebar-button"]'
  title: string;
  body: string;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'create-note', anchor: '[data-tour="new-note-sidebar-button"]', title: 'Create a note', body: 'Start every study here. Tap to make your first note.', placement: 'right' },
  { id: 'verse-linking', anchor: '[data-tour="editor-bible-panel"]', title: 'Link verses', body: 'Type a reference and it becomes a living link to Scripture.', placement: 'left' },
  { id: 'highlights', anchor: '[data-tour="highlight-toolbar"]', title: 'Highlight & decorate', body: 'Select text to highlight the lines that matter.', placement: 'bottom' },
  { id: 'graph', anchor: '[data-tour="graph-toggle-button"]', title: 'See connections', body: 'Your notes and verses form a graph of backlinks.', placement: 'bottom' },
  { id: 'lamplight', anchor: '[data-tour="lamplight-panel-entry"]', title: 'Ask Lamplight', body: 'Discover connections between what you are studying and your notes.', placement: 'left' },
];

/** The final sign-up nudge card has no anchor — rendered centered. */
export const TOUR_SIGNUP_CARD = {
  title: 'Make it yours',
  body: 'Create a free account to save your notes across devices.',
  cta: 'Create account',
};
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/notepad/onboarding/tour/tour-steps.test.ts
import { describe, it, expect } from 'vitest';
import { TOUR_STEPS, TOUR_SIGNUP_CARD } from './tour-steps';

describe('tour-steps', () => {
  it('defines the five spotlight stops with anchors and copy', () => {
    expect(TOUR_STEPS).toHaveLength(5);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['create-note', 'verse-linking', 'highlights', 'graph', 'lamplight']);
    expect(TOUR_STEPS.every((s) => s.anchor.startsWith('[data-tour='))).toBe(true);
    expect(TOUR_STEPS.every((s) => s.title && s.body)).toBe(true);
  });
  it('final sign-up card has a CTA', () => {
    expect(TOUR_SIGNUP_CARD.cta.length).toBeGreaterThan(0);
  });
});
```

```tsx
// src/notepad/onboarding/tour/SpotlightTour.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SpotlightTour } from './SpotlightTour';

vi.mock('@/hooks/use-prefers-reduced-motion', () => ({ usePrefersReducedMotion: () => true }));

afterEach(cleanup);

describe('SpotlightTour', () => {
  it('renders the first step and advances on next', () => {
    // anchor present in the DOM
    const el = document.createElement('button');
    el.setAttribute('data-tour', 'new-note-sidebar-button');
    document.body.appendChild(el);
    render(<SpotlightTour onComplete={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText('Create a note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('Link verses')).toBeInTheDocument();
    el.remove();
  });

  it('skip fires onSkip', () => {
    const onSkip = vi.fn();
    render(<SpotlightTour onComplete={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('missing anchor does not crash; step still shows its card', () => {
    // no data-tour elements in DOM
    expect(() => render(<SpotlightTour onComplete={vi.fn()} onSkip={vi.fn()} />)).not.toThrow();
    expect(screen.getByText('Create a note')).toBeInTheDocument();
  });

  it('reaching the end shows the sign-up card then completes', () => {
    const onComplete = vi.fn();
    render(<SpotlightTour onComplete={onComplete} onSkip={vi.fn()} />);
    // click Next through all 5 steps to the signup card
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: /next|done/i }));
    expect(screen.getByText('Make it yours')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/onboarding/tour/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

Implement `tour-steps.ts` as above. Implement `SpotlightTour.tsx`:
- Props: `{ onComplete: () => void; onSkip: () => void; onSignUp?: () => void }`.
- State: `index` (0..steps.length, where length == signup card).
- For the current step, `document.querySelector(step.anchor)?.getBoundingClientRect()`. If absent, render the card centered (no cutout) — never block. Recompute rect on throttled `resize`/`scroll` (reuse a simple `requestAnimationFrame` throttle).
- Dimmed full-screen overlay with a rect "cutout" (e.g. an SVG mask or a box-shadow ring around the rect). animejs transitions on card position; **skip animation entirely when `usePrefersReducedMotion()` is true**.
- Buttons: `Skip` (calls `onSkip`), `Next` (advance; label `Done` on the last spotlight step before the signup card), and on the signup card a `Create account` CTA (`onSignUp`) plus a control that calls `onComplete`.
- Escape key and Skip both call `onSkip`.

Keep `import { animate } from 'animejs'` (v4 named export — confirm the exact v4 import in `node_modules/animejs` before use; v4 exposes `createTimeline`/`animate`). If the import shape is uncertain, gate the animation so a wrong import never breaks rendering (try/catch around the animate call).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/onboarding/tour/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/tour/
git commit -m "feat(onboarding): custom SpotlightTour engine + step definitions"
```

---

### Task 13: Mount provider + onboarding surfaces in the notepad workspace

**Files:**
- Modify: the notepad workspace shell that renders the `/notepad/notes` view. Per exploration, the signed-out route renders `<Notepad />` (`src/components/sections/Notepad.tsx`) via `src/auth/username/NotepadRoutes.tsx`; `useNotepadFirstLoad()` is mounted in `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`. **Confirm the actual top-level notepad workspace component** (the one common to mobile + desktop that always renders for `/notepad/notes`) and mount there. If mobile/desktop are separate shells, mount the provider at the nearest common parent (likely `Notepad.tsx`).
- Create: `src/notepad/onboarding/OnboardingSurfaces.tsx` (the single component that consumes `useOnboarding`, renders the tour/checklist/guided-note offer based on `actions`).
- Test: `src/notepad/onboarding/OnboardingSurfaces.test.tsx`

- [ ] **Step 1: Write the failing test for OnboardingSurfaces**

```tsx
// src/notepad/onboarding/OnboardingSurfaces.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OnboardingSurfaces } from './OnboardingSurfaces';

const ctx = vi.fn();
vi.mock('./useOnboarding', () => ({ useOnboarding: () => ctx() }));

afterEach(cleanup);

describe('OnboardingSurfaces', () => {
  it('renders the get-started checklist when action present', () => {
    ctx.mockReturnValue({
      actions: [{ kind: 'show-get-started' }],
      anon: { items: {}, dismissed: false }, account: null,
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    render(<OnboardingSurfaces />);
    expect(screen.getByText(/get started/i)).toBeInTheDocument();
  });

  it('renders nothing when actions is empty', () => {
    ctx.mockReturnValue({
      actions: [], anon: null, account: null,
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    const { container } = render(<OnboardingSurfaces />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the journey checklist for show-journey', () => {
    ctx.mockReturnValue({
      actions: [{ kind: 'show-journey' }],
      anon: null, account: { guidedNote: 'done', items: {}, dismissed: false, studyDates: [], merged: true },
      reportOnboardingEvent: vi.fn(), completeGuidedNote: vi.fn(),
      dismissChecklist: vi.fn(), replayTour: vi.fn(), markTourDone: vi.fn(),
    });
    render(<OnboardingSurfaces />);
    expect(screen.getByText(/your journey/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/onboarding/OnboardingSurfaces.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OnboardingSurfaces and mount the provider**

`OnboardingSurfaces.tsx`: consume `useOnboarding()`. For each action kind render:
- `start-tour` → `<SpotlightTour onComplete={markTourDone} onSkip={markTourDone} onSignUp={...} />` (tour completion/skip both mark done — spec: interruption == skipped).
- `show-get-started` → `<ChecklistPanel title="Get started" items={GET_STARTED_ITEMS} completed={fromAnon(anon)} ... onReplayTour={replayTour} onDismiss={dismissChecklist} />` with local collapse state.
- `offer-guided-note` → a small offer affordance (button) that, when accepted, creates the guided note (delegated via a callback prop the workspace supplies, since note creation lives in `NotepadActions`) and calls `completeGuidedNote('done')`; skip calls `completeGuidedNote('skipped')`. Keep the actual `createNote` wiring in the workspace mount (Task 13 step 4), passed in as `onStartGuidedNote`.
- `show-journey` → `<ChecklistPanel title="Your journey" items={JOURNEY_ITEMS} completed={fromAccount(account)} ... />` plus the LevelUpModal-style finale when `isJourneyComplete(account)` transitions true.

Mount `<OnboardingProvider>` wrapping the notepad workspace subtree, and render `<OnboardingSurfaces onStartGuidedNote={createGuidedNote} />` inside it where `createGuidedNote` calls the existing note-create path (`NotepadActions`/`NoteCollection.createNote` then `updateNote` with the template content). Wrap the mount so it renders for both signed-out and signed-in users on `/notepad/notes`.

- [ ] **Step 4: Run the focused test + full onboarding suite**

Run: `npx vitest run src/notepad/onboarding/`
Expected: PASS. Then `npx tsc -b` (per memory: `tsc -b`, not `tsc --noEmit`) — expect zero NEW errors (the repo ships 4 pre-existing tsc errors in `force-sphere.test.ts`; verify your changes add none).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/OnboardingSurfaces.tsx src/notepad/onboarding/OnboardingSurfaces.test.tsx <workspace file>
git commit -m "feat(onboarding): mount provider and onboarding surfaces in notepad workspace"
```

---

### Task 14: Wire the 8 event observers

**Files (modify — one `reportOnboardingEvent(...)` call each):**
- `src/notepad/collection/note-collection.ts` — `createNote` (`note-created`)
- `src/notepad/extensions/bible-verse.ts` — verse-link insertion (`verse-linked`)
- `src/notepad/extensions/style-highlight.ts` — highlight applied (`highlight-created`)
- `src/notepad/components/TranscriptionReview.tsx` — `handleSave` success (`scan-completed`)
- `src/notepad/collection/folder-hierarchy.ts` — `createFolder` (`folder-created`)
- `src/components/sections/notepad/GraphPane.tsx` — mount/open (`graph-visited`)
- `src/notepad/components/lamplight/ConnectionCardsPanel.tsx` — `handleChipClick` expand (`lamplight-connection`)
- `src/notepad/components/SearchDialog.tsx` — open (`search-used`)
- Test: `src/notepad/onboarding/observers.integration.test.tsx`

The domain classes (`NoteCollection`, `FolderHierarchy`) are React-free and must NOT import the provider. Bridge via a lightweight event sink so the pure classes stay decoupled:

```ts
// add to src/notepad/onboarding/onboarding-events.ts
import type { OnboardingEvent } from './onboarding-types';
type Sink = (e: OnboardingEvent) => void;
let sink: Sink | null = null;
/** The provider registers itself here on mount; classes/components emit through it. */
export function setOnboardingSink(fn: Sink | null): void { sink = fn; }
export function emitOnboardingEvent(e: OnboardingEvent): void { try { sink?.(e); } catch { /* never break callers */ } }
```

The provider calls `setOnboardingSink(reportOnboardingEvent)` in a mount effect (and `setOnboardingSink(null)` on unmount). React components may call `reportOnboardingEvent` via `useOnboarding()` directly; non-React modules call `emitOnboardingEvent`.

- [ ] **Step 1: Write the failing integration test (representative two observers)**

```tsx
// src/notepad/onboarding/observers.integration.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setOnboardingSink, emitOnboardingEvent } from './onboarding-events';

afterEach(() => setOnboardingSink(null));

describe('onboarding event sink', () => {
  it('routes emitted events to the registered sink', () => {
    const sink = vi.fn();
    setOnboardingSink(sink);
    emitOnboardingEvent('note-created');
    emitOnboardingEvent('folder-created');
    expect(sink).toHaveBeenCalledWith('note-created');
    expect(sink).toHaveBeenCalledWith('folder-created');
  });
  it('never throws when no sink is registered', () => {
    setOnboardingSink(null);
    expect(() => emitOnboardingEvent('search-used')).not.toThrow();
  });
});
```

Additionally, add a focused test asserting `createNote` emits, using the real class with a fake adapter:

```ts
// src/notepad/collection/note-collection.onboarding.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setOnboardingSink } from '../onboarding/onboarding-events';
// import { NoteCollection } from './note-collection'; // construct with a fake StorageAdapter
afterEach(() => setOnboardingSink(null));

describe('NoteCollection emits note-created', () => {
  it('fires the onboarding event after a successful create', async () => {
    const sink = vi.fn();
    setOnboardingSink(sink);
    // const c = new NoteCollection(fakeAdapter); await c.init(); await c.createNote('root', 'devotion');
    // expect(sink).toHaveBeenCalledWith('note-created');
    expect(sink).toBeDefined(); // replace with the real construction per note-collection's test helpers
  });
});
```

> Implementer: complete the `NoteCollection` test by copying the construction/fake-adapter setup from the existing `note-collection.test.ts`, then assert the sink received `'note-created'`. Mirror this for `folder-hierarchy` (`folder-created`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/onboarding/observers.integration.test.tsx`
Expected: FAIL — `onboarding-events` not found.

- [ ] **Step 3: Implement the sink and add the 8 emit calls**

Create `onboarding-events.ts`. Then add exactly one emit per observer, at the verified success point:
- `note-collection.ts` `createNote`: after the state mutation that adds the note (the line after `this.update(...)`), `emitOnboardingEvent('note-created')`.
- `folder-hierarchy.ts` `createFolder`: after `this.setState(...)`, `emitOnboardingEvent('folder-created')`.
- `TranscriptionReview.tsx` `handleSave`: after `await markTranscriptionSaved(...)` resolves and before `onSaved(toSave)`, `emitOnboardingEvent('scan-completed')`.
- `SearchDialog.tsx`: inside the `setOpen(true)` branch of the keyboard effect (and any explicit open handler), `emitOnboardingEvent('search-used')`.
- `GraphPane.tsx`: a mount/`graphOpen` effect that emits `'graph-visited'` once on first open.
- `ConnectionCardsPanel.tsx` `handleChipClick`: after `await expand(relatedNoteId)`, `emitOnboardingEvent('lamplight-connection')`.
- `bible-verse.ts`: at the verse-mark insertion command. **Verify the exact insertion point first** (exploration flagged this is an auto-decorate plugin; the emit belongs wherever a verse mark is actually committed to the doc). If there is no discrete user "link a verse" command, emit from the `NoteEditor` verse-tooltip/insert path instead — pick the single point that represents "the user linked a verse" and document the choice in the commit message.
- `style-highlight.ts`: in the `setStyleHighlight` command path after the mark is applied.

For React components, prefer `useOnboarding().reportOnboardingEvent` if the component is already inside the provider; otherwise use `emitOnboardingEvent`. Both reach the same sink.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/notepad/onboarding/ src/notepad/collection/` then `npx tsc -b`
Expected: PASS; zero new tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/onboarding/onboarding-events.ts src/notepad/collection/note-collection.ts src/notepad/collection/folder-hierarchy.ts src/notepad/components/TranscriptionReview.tsx src/notepad/components/SearchDialog.tsx src/components/sections/notepad/GraphPane.tsx src/notepad/components/lamplight/ConnectionCardsPanel.tsx src/notepad/extensions/bible-verse.ts src/notepad/extensions/style-highlight.ts src/notepad/onboarding/observers.integration.test.tsx src/notepad/collection/note-collection.onboarding.test.ts
git commit -m "feat(onboarding): wire 8 completion-point event observers via decoupled sink"
```

---

### Task 15: Add the 5 tour anchors (data-tour attributes)

**Files (modify — add one `data-tour="..."` attribute each):**
- `src/notepad/components/Sidebar.tsx` (or the `FolderItem`/type-group new-note button) → `data-tour="new-note-sidebar-button"`
- the editor Bible/verse-link toolbar button (confirm file: `NotepadToolbar.tsx` or the editor toolbar) → `data-tour="editor-bible-panel"`
- the highlight toolbar control → `data-tour="highlight-toolbar"`
- the graph toggle button (in/near `GraphPane.tsx` or the workspace toolbar) → `data-tour="graph-toggle-button"`
- the Lamplight panel entry button → `data-tour="lamplight-panel-entry"`

These selectors must exactly match `TOUR_STEPS[*].anchor` from Task 12.

- [ ] **Step 1: Write a guard test that the anchors match the tour steps**

```ts
// src/notepad/onboarding/tour/anchors.contract.test.ts
import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from './tour-steps';

/** Guards against drift between TOUR_STEPS selectors and the data-tour values
 *  added to the workspace. Update both together. */
describe('tour anchor contract', () => {
  it('every step targets a known data-tour token', () => {
    const tokens = TOUR_STEPS.map((s) => s.anchor.replace('[data-tour="', '').replace('"]', ''));
    expect(tokens).toEqual([
      'new-note-sidebar-button', 'editor-bible-panel', 'highlight-toolbar',
      'graph-toggle-button', 'lamplight-panel-entry',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (steps already exist)**

Run: `npx vitest run src/notepad/onboarding/tour/anchors.contract.test.ts`
Expected: PASS (this locks the token list).

- [ ] **Step 3: Add the five attributes**

For each target element, locate it (grep for the button text / handler named in the exploration findings), confirm it's the element a user actually clicks for that action, and add the `data-tour` attribute. Do not change layout, classes, or behavior — attribute only. If an element is conditionally rendered or collapsed on mobile, that's fine: the tour skips missing anchors silently (Task 12).

- [ ] **Step 4: Verify attributes are present**

Run: `grep -rn 'data-tour=' src/ | sort`
Expected: exactly the five tokens above, each once.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/components/Sidebar.tsx <editor toolbar file> <highlight toolbar file> src/components/sections/notepad/GraphPane.tsx <lamplight entry file> src/notepad/onboarding/tour/anchors.contract.test.ts
git commit -m "feat(onboarding): add 5 data-tour anchors for the spotlight tour"
```

---

### Task 16: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full onboarding suite**

Run: `npx vitest run src/notepad/onboarding/`
Expected: all PASS.

- [ ] **Step 2: Typecheck the real build**

Run: `npx tsc -b`
Expected: only the known pre-existing errors (`force-sphere.test.ts`, 4) — zero new ones. (Memory: `tsc -b` is the real check; bare `tsc --noEmit` checks nothing here.)

- [ ] **Step 3: Lint only the touched files**

Run: `npx eslint <space-separated list of files created/modified in this plan>`
Expected: zero errors in touched files. (Memory: ~100 pre-existing repo lint errors are out of scope; do not gate on a green repo-wide lint. Do not fix HeroDesktop/MoodBoard react-hooks errors.)

- [ ] **Step 4: Manual smoke (dev server)**

Run the dev server (preview "psalms-app", port 5173). Verify, signed out, that `/notepad/notes` auto-starts the tour on first visit (clear `onboarding_anon_*` keys first), the checklist appears, completing a note ticks "Write your first note", and refreshing does not re-run the tour. Then sign in with a freshly-created account and confirm the journey checklist appears and anonymous progress pre-credited. **If anything renders unexpectedly or a visual choice is ambiguous, stop and ask the user before adjusting styling.**

- [ ] **Step 5: Final state confirmation**

Confirm `git status` shows only this feature's files committed and the untracked files listed in the brief (`docs/*`, `public/Psalms_logo_*.png`, `supabase/.env.production`) left alone. Do NOT commit `supabase/.env.production`.

---

## Deploy checklist (after code ships — not part of task execution)

1. Apply the migration: verify Supabase CLI link state, then `supabase db push` (memory: migrations apply manually; 027 still needed a manual apply). Until applied, signed-in journey persistence is inert and degrades silently.
2. No edge-function changes — nothing to deploy via `supabase functions deploy`.
3. Frontend ships via the normal Vercel path.

## Self-review notes (author)

- **Spec coverage:** anonymous tour (T12,15), get-started checklist (T8,11,13), sign-up merge (T4,10), guided note (T9,13), journey checklist (T8,11,13), rewards/no-points (no tier-point writes anywhere — confirmed; finale uses LevelUpModal style only), rollout gating (`eligibleForJourney` in T3,10; anon localStorage gate in T5,10), persistence + optimistic writes + silent degrade (T6,10), streak (T2,10), all 8 observers (T14), all 5 anchors (T15), edge cases: missing anchor/reduced-motion/interrupted tour (T12), idempotent merge (T4). `/welcome` untouched (no edits to welcome files in any task).
- **Migration number corrected to 028** (024–027 already exist; the brief's "024" was stale).
- **021 trigger untouched** — column deliberately omitted from the protected list (T7 step 2 guards this).
- **Type consistency:** `AccountProgress`/`AnonProgress`/`OnboardingAction`/item-id unions defined once in T1 and imported everywhere; `decideOnboardingActions` input shape matches the provider call in T10; adapter interface (`getProgress`/`saveProgress`) consistent T6↔T10.
- **Open verification items handed to implementers (flagged inline):** exact `verse-linked` and `highlight-created` emit points, the editor/graph/lamplight anchor elements, the top-level workspace mount component, and the StarterKit node names for the guided-note template. Each task says to confirm before editing.
