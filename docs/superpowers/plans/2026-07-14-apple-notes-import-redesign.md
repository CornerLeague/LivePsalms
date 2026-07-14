# Apple Notes Import — Guided, Tap-Free Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the "Connect Apple Notes" panel into an ordered, honest, numbered guide and rewrite the Shortcut runbook so import is one-tap folder/all selection with no per-note picking.

**Architecture:** Extract one new pure helper (`deriveImportSteps`) that derives per-step state (`done`/`active`/`upcoming`) from the three signals the panel already has, then restructure `ApplePersonalTokensSection` around a 4-step guide (token → install → run → confirm) with a collapsed detailed walkthrough and an always-visible "edit = duplicate / safe to re-run" note. The existing tested primitives (`apple-import-status.ts`, `personal-tokens.ts`) are reused unchanged. The Shortcut itself is out-of-repo Apple GUI work; only its runbook (source of truth) is edited here.

**Tech Stack:** React + TypeScript (Vite), Vitest + @testing-library/react (jsdom), Tailwind utility classes with CSS-var inline styles, ESLint, `tsc -b`.

## Global Constraints

- **Diff base is `origin/main` (`d295db2a`), NOT local `main@37be6b7`.** Branch: `feat/apple-notes-import-redesign`.
- **Gates (all must pass at completion):** `npm run test` (vitest run), `npx tsc -b`, `npx eslint`. The pre-existing `garden-scene` vitest failure is **not** ours — everything else must be green.
- **Reuse unchanged, do not reinvent:** `detectApplePlatform`, `deriveImportStatus` (`src/auth/apple-import-status.ts`); `createToken`, `listTokens`, `revokeToken`, `countImportedNotes` (`src/auth/personal-tokens.ts`).
- **Preserve existing a11y + behavior contracts in the panel:** `aria-labelledby="apple-notes-heading"` heading, top banner `role="status"`, token-reveal `role="status"`, error `role="alert"`; the raw import endpoint URL is **never** rendered; the "Generate token" button keeps that accessible name; token list + Revoke preserved.
- **Honesty rule:** a step is only shown `done` when a real device/data signal exists. `run` is **never** `active` (its only signal, `hasRun`, is shared with `install`).
- **Copy the imported-count string only in the top banner.** No other element may render text matching `/N notes imported/` (an existing test uses `getByText`, which throws on duplicate matches).
- **Commit message trailer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Leave untracked** the two pre-existing plan docs under `docs/superpowers/plans/` (`2026-07-11-waymarks-…`, `2026-07-12-memorize-tab.md`).

---

## File Structure

- **New:** `src/auth/apple-import-steps.ts` — pure `deriveImportSteps(...)` step-state logic. One responsibility: map signals → ordered `GuideStep[]`.
- **New:** `src/auth/apple-import-steps.test.ts` — unit tests for the matrix + invariants.
- **Modify:** `src/auth/components/ApplePersonalTokensSection.tsx` — restructure into the numbered guide + walkthrough + honesty note + "Your tokens" area.
- **Modify:** `src/auth/components/ApplePersonalTokensSection.test.tsx` — keep the 7 existing tests green; add 5 for the guide/state/disclosure/note.
- **Modify:** `docs/runbooks/apple-notes-import.md` — replace the recipe + build sections with the menu-based, no-per-note-picker version + token-storage note.
- **Unchanged (reused):** `src/auth/apple-import-status.ts`, `src/auth/personal-tokens.ts`, and their tests.
- **Follow-up (not a task):** swap `APPLE_SHORTCUT_ICLOUD_URL` in the component when the user hands back the rebuilt Shortcut's new iCloud link.

---

## Task 1: Pure step-state helper (`deriveImportSteps`)

**Files:**
- Create: `src/auth/apple-import-steps.ts`
- Test: `src/auth/apple-import-steps.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces:
  - `type StepState = 'done' | 'active' | 'upcoming'`
  - `type StepId = 'token' | 'install' | 'run' | 'confirm'`
  - `interface GuideStep { id: StepId; title: string; state: StepState }`
  - `function deriveImportSteps(input: { hasToken: boolean; hasRun: boolean; importedCount: number }): GuideStep[]` — returns exactly 4 steps in order `token, install, run, confirm`.

- [ ] **Step 1: Write the failing test**

Create `src/auth/apple-import-steps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveImportSteps, type GuideStep, type StepState } from './apple-import-steps';

const stateOf = (steps: GuideStep[], id: string): StepState =>
  steps.find((s) => s.id === id)!.state;

// Reachable states only (hasRun implies hasToken in the real data model:
// last_used_at is set only after a token is consumed).
const NO_TOKEN = { hasToken: false, hasRun: false, importedCount: 0 };
const TOKEN_NO_RUN = { hasToken: true, hasRun: false, importedCount: 0 };
const RUN_NO_IMPORT = { hasToken: true, hasRun: true, importedCount: 0 };
const COMPLETE = { hasToken: true, hasRun: true, importedCount: 3 };

describe('deriveImportSteps', () => {
  it('returns the four steps in fixed order with titles', () => {
    const steps = deriveImportSteps(NO_TOKEN);
    expect(steps.map((s) => s.id)).toEqual(['token', 'install', 'run', 'confirm']);
    expect(steps.every((s) => s.title.length > 0)).toBe(true);
  });

  it('no token: token active, everything after upcoming', () => {
    const s = deriveImportSteps(NO_TOKEN);
    expect(stateOf(s, 'token')).toBe('active');
    expect(stateOf(s, 'install')).toBe('upcoming');
    expect(stateOf(s, 'run')).toBe('upcoming');
    expect(stateOf(s, 'confirm')).toBe('upcoming');
  });

  it('token but no run: token done, install active, run+confirm upcoming', () => {
    const s = deriveImportSteps(TOKEN_NO_RUN);
    expect(stateOf(s, 'token')).toBe('done');
    expect(stateOf(s, 'install')).toBe('active');
    expect(stateOf(s, 'run')).toBe('upcoming');
    expect(stateOf(s, 'confirm')).toBe('upcoming');
  });

  it('run but nothing imported yet: token/install/run done, confirm active', () => {
    const s = deriveImportSteps(RUN_NO_IMPORT);
    expect(stateOf(s, 'token')).toBe('done');
    expect(stateOf(s, 'install')).toBe('done');
    expect(stateOf(s, 'run')).toBe('done');
    expect(stateOf(s, 'confirm')).toBe('active');
  });

  it('imported > 0: all four done', () => {
    const s = deriveImportSteps(COMPLETE);
    expect(s.every((step) => step.state === 'done')).toBe(true);
  });

  it('run is never active across reachable states', () => {
    for (const input of [NO_TOKEN, TOKEN_NO_RUN, RUN_NO_IMPORT, COMPLETE]) {
      expect(stateOf(deriveImportSteps(input), 'run')).not.toBe('active');
    }
  });

  it('exactly one active while incomplete, zero when complete', () => {
    const actives = (input: typeof NO_TOKEN) =>
      deriveImportSteps(input).filter((s) => s.state === 'active').length;
    expect(actives(NO_TOKEN)).toBe(1);
    expect(actives(TOKEN_NO_RUN)).toBe(1);
    expect(actives(RUN_NO_IMPORT)).toBe(1);
    expect(actives(COMPLETE)).toBe(0);
  });

  it('ordering invariant: no done/active step follows an upcoming step', () => {
    const rank: Record<StepState, number> = { done: 2, active: 1, upcoming: 0 };
    for (const input of [NO_TOKEN, TOKEN_NO_RUN, RUN_NO_IMPORT, COMPLETE]) {
      const seq = deriveImportSteps(input).map((s) => rank[s.state]);
      for (let i = 1; i < seq.length; i++) {
        // once we drop to upcoming (0), we never rise again
        if (seq[i - 1] === 0) expect(seq[i]).toBe(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/auth/apple-import-steps.test.ts`
Expected: FAIL — cannot resolve `./apple-import-steps`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/auth/apple-import-steps.ts`:

```ts
// src/auth/apple-import-steps.ts
// Pure, DOM-free step-state logic for the Connect Apple Notes guide.
// Unit-tested in isolation. Never throws.

export type StepState = 'done' | 'active' | 'upcoming';
export type StepId = 'token' | 'install' | 'run' | 'confirm';
export interface GuideStep {
  id: StepId;
  title: string;
  state: StepState;
}

// Signals the panel already has:
//   hasToken     = the user has at least one active token
//   hasRun       = the Shortcut has POSTed at least once (lastUsedAt != null)
//   importedCount= number of apple_notes-sourced notes
//
// Honesty: a step is only `done` on a real signal. `run` is never `active` —
// its only signal (hasRun) is shared with `install`, so `install` carries the
// active highlight through the whole "have token, haven't run" window and both
// flip to `done` the instant the Shortcut first runs. Precondition (from the
// data model): hasRun implies hasToken.
export function deriveImportSteps(input: {
  hasToken: boolean;
  hasRun: boolean;
  importedCount: number;
}): GuideStep[] {
  const { hasToken, hasRun, importedCount } = input;

  const token: StepState = hasToken ? 'done' : 'active';
  const install: StepState = hasRun ? 'done' : hasToken ? 'active' : 'upcoming';
  const run: StepState = hasRun ? 'done' : 'upcoming';
  const confirm: StepState = importedCount > 0 ? 'done' : hasRun ? 'active' : 'upcoming';

  return [
    { id: 'token', title: 'Generate your token', state: token },
    { id: 'install', title: 'Install the Shortcut', state: install },
    { id: 'run', title: 'Run it & choose your notes', state: run },
    { id: 'confirm', title: 'Confirm your import', state: confirm },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/auth/apple-import-steps.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + lint the new file**

Run: `npx tsc -b && npx eslint src/auth/apple-import-steps.ts src/auth/apple-import-steps.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/auth/apple-import-steps.ts src/auth/apple-import-steps.test.ts
git commit -m "$(cat <<'EOF'
feat(apple-import): pure deriveImportSteps step-state helper

Derives honest per-step state (done/active/upcoming) for the guided
Apple Notes import flow from hasToken/hasRun/importedCount. `run` is
never active by design (shares install's only signal). Fully unit-tested:
the state matrix, ordering invariant, and one-active-while-incomplete.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Restructure the panel into the numbered guide

**Files:**
- Modify: `src/auth/components/ApplePersonalTokensSection.tsx` (full rewrite of the render tree; data/handlers unchanged)
- Test: `src/auth/components/ApplePersonalTokensSection.test.tsx` (keep 7 existing, add 5)

**Interfaces:**
- Consumes: `deriveImportSteps`, `StepId`, `StepState` from `src/auth/apple-import-steps` (Task 1); `detectApplePlatform`, `deriveImportStatus`, `ImportTone` from `apple-import-status`; `createToken`/`listTokens`/`revokeToken`/`countImportedNotes`/`PersonalToken` from `personal-tokens`.
- Produces: same exported component `ApplePersonalTokensSection({ client, userId })` and `IMPORT_ENDPOINT` const (both unchanged in signature). Consumed by `src/auth/ProfilePage.tsx:345`.

- [ ] **Step 1: Add the 5 new failing tests**

Append these tests inside the existing `describe('ApplePersonalTokensSection', ...)` block in `src/auth/components/ApplePersonalTokensSection.test.tsx` (just before its closing `});`). Do **not** touch the 7 existing tests.

```tsx
  it('renders the four numbered guide steps', async () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() => expect(screen.getByText('Generate your token')).toBeInTheDocument());
    expect(screen.getByText('Install the Shortcut')).toBeInTheDocument();
    expect(screen.getByText('Run it & choose your notes')).toBeInTheDocument();
    expect(screen.getByText('Confirm your import')).toBeInTheDocument();
  });

  it('marks the token step done and install active once a token exists', async () => {
    vi.mocked(tokens.listTokens).mockResolvedValue([
      { id: 't1', name: 'Apple Notes Shortcut', lastUsedAt: null, createdAt: '2026-06-11T00:00:00Z' },
    ]);
    const { container } = render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() =>
      expect(container.querySelector('[data-step-id="token"]')).toHaveAttribute('data-step-state', 'done'),
    );
    expect(container.querySelector('[data-step-id="install"]')).toHaveAttribute('data-step-state', 'active');
    expect(container.querySelector('[data-step-id="run"]')).toHaveAttribute('data-step-state', 'upcoming');
  });

  it('marks the confirm step done when notes have been imported', async () => {
    vi.mocked(tokens.listTokens).mockResolvedValue([
      { id: 't1', name: 'Apple Notes Shortcut', lastUsedAt: '2026-06-12T11:58:00Z', createdAt: '2026-06-11T00:00:00Z' },
    ]);
    vi.mocked(tokens.countImportedNotes).mockResolvedValue(3);
    const { container } = render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    await waitFor(() =>
      expect(container.querySelector('[data-step-id="confirm"]')).toHaveAttribute('data-step-state', 'done'),
    );
  });

  it('shows the expandable detailed walkthrough', async () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    expect(screen.getByText(/see the full step-by-step/i)).toBeInTheDocument();
    // Walkthrough-only phrasing (not present in the compact step body):
    expect(screen.getByText(/where they land/i)).toBeInTheDocument();
  });

  it('always shows the edit-makes-a-duplicate and safe-to-re-run note', () => {
    render(<ApplePersonalTokensSection client={client} userId="u-1" />);
    expect(screen.getByText(/re-importing creates a/i)).toBeInTheDocument();
    expect(screen.getByText(/run the Shortcut again anytime/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the component tests to verify the new ones fail**

Run: `npx vitest run src/auth/components/ApplePersonalTokensSection.test.tsx`
Expected: the 5 new tests FAIL (missing "Generate your token", missing `data-step-id`, missing walkthrough, missing note); the 7 existing tests still PASS.

- [ ] **Step 3: Rewrite the component render tree**

Replace the entire contents of `src/auth/components/ApplePersonalTokensSection.tsx` with:

```tsx
// src/auth/components/ApplePersonalTokensSection.tsx
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createToken, listTokens, revokeToken, countImportedNotes, type PersonalToken,
} from '../personal-tokens';
import { detectApplePlatform, deriveImportStatus, type ImportTone } from '../apple-import-status';
import { deriveImportSteps, type StepId, type StepState } from '../apple-import-steps';

// Baked into the distributed Apple Shortcut by maintainers; intentionally NOT
// rendered in the panel (users never need the raw endpoint). Exported so it
// stays available to maintainers/tooling without tripping noUnusedLocals.
export const IMPORT_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/import-apple-note`;
const APPLE_SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/bcf5f879ac954f3cbf7d99c3d5ffe29a';
const SHORTCUTS_APP_STORE_URL = 'https://apps.apple.com/app/shortcuts/id915249334';

const TONE_BG: Record<ImportTone, string> = {
  success: 'rgba(120, 160, 110, 0.16)',
  waiting: 'var(--pale-stone)',
  idle: 'var(--pale-stone)',
};

// Number-badge styling per step state.
const BADGE_STYLE: Record<StepState, { background: string; color: string }> = {
  done: { background: 'rgba(120, 160, 110, 0.9)', color: 'var(--alabaster)' },
  active: { background: 'var(--deep-umber)', color: 'var(--alabaster)' },
  upcoming: { background: 'var(--pale-stone)', color: 'var(--silica)' },
};

const stepTitleStyle = {
  color: 'var(--deep-umber)',
  fontFamily: 'Outfit, sans-serif',
  fontWeight: 600,
} as const;
const stepBodyStyle = { color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' } as const;

export interface ApplePersonalTokensSectionProps {
  client: SupabaseClient;
  userId: string;
}

export function ApplePersonalTokensSection({ client, userId }: ApplePersonalTokensSectionProps) {
  const [list, setList] = useState<PersonalToken[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [raw, setRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [platform] = useState(() => detectApplePlatform(navigator.userAgent));

  const refresh = useCallback(async () => {
    try {
      const [t, count] = await Promise.all([
        listTokens(client),
        // A count failure must not block the panel — treat as 0 (spec error handling).
        countImportedNotes(client).catch(() => 0),
      ]);
      setList(t);
      setImportedCount(count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tokens');
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Clear the "Copied" confirmation a moment after it appears.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = () => {
    if (!raw) return;
    void navigator.clipboard?.writeText(raw);
    setCopied(true);
  };

  const onGenerate = async () => {
    setBusy(true); setError(null); setCopied(false);
    try {
      const token = await createToken(client, userId, 'Apple Notes Shortcut');
      setRaw(token);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create token');
    } finally { setBusy(false); }
  };

  const onRevoke = async (id: string) => {
    setBusy(true); setError(null);
    try { await revokeToken(client, id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to revoke token'); }
    finally { setBusy(false); }
  };

  // Most-recent last-used across active tokens (ISO strings sort lexicographically).
  const lastUsedAt = list.reduce<string | null>((acc, t) => {
    if (!t.lastUsedAt) return acc;
    return !acc || t.lastUsedAt > acc ? t.lastUsedAt : acc;
  }, null);

  const status = deriveImportStatus({ tokenCount: list.length, lastUsedAt, importedCount });
  const steps = deriveImportSteps({
    hasToken: list.length > 0,
    hasRun: lastUsedAt != null,
    importedCount,
  });

  const isApple = platform === 'ios' || platform === 'macos';
  const devicePhrase = platform === 'ios' ? 'on your iPhone or iPad' : 'on your Mac';

  const badge = (n: number, state: StepState) => (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full text-xs shrink-0"
      style={{ width: 22, height: 22, ...BADGE_STYLE[state] }}
    >
      {state === 'done' ? '✓' : n}
    </span>
  );

  // Per-step body content (typed exhaustively so titles come from the helper and
  // stay DRY). Bodies reference component state, so they live inside render.
  const stepBodies: Record<StepId, ReactNode> = {
    token: (
      <>
        <p className="text-xs mb-2" style={stepBodyStyle}>
          Create a private key that lets the Shortcut send your notes to Psalms.
        </p>
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={busy}
          className="text-xs px-3 py-2 rounded-lg disabled:opacity-50"
          style={{ background: 'var(--deep-umber)', color: 'var(--alabaster)', fontFamily: 'Outfit, sans-serif' }}
        >
          Generate token
        </button>
        {raw && (
          <div role="status" className="mt-2 px-3 py-3 rounded-lg" style={{ background: 'var(--pale-stone)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
              <strong>Copy this token now &mdash; you won&rsquo;t see it again.</strong>
            </p>
            <code className="block text-xs break-all mb-2" style={{ color: 'var(--deep-umber)', fontFamily: 'monospace' }}>
              {raw}
            </code>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCopy}
                className="text-xs underline"
                style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
              >
                Copy
              </button>
              {copied && (
                <span role="status" className="text-xs" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
                  Copied
                </span>
              )}
            </div>
          </div>
        )}
      </>
    ),
    install: isApple ? (
      <>
        <p className="text-xs mb-2" style={stepBodyStyle}>
          Open the Shortcut {devicePhrase}. If the Shortcuts app isn&rsquo;t installed, get it first.
        </p>
        <div className="flex flex-col gap-2">
          <a
            href={APPLE_SHORTCUT_ICLOUD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-2 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--deep-umber)', color: 'var(--alabaster)', fontFamily: 'Outfit, sans-serif' }}
          >
            Install Shortcut
          </a>
          <a
            href={SHORTCUTS_APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline text-center"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            Get the Shortcuts app
          </a>
        </div>
      </>
    ) : (
      <p className="text-xs" style={stepBodyStyle}>
        Apple Notes import needs an iPhone, iPad, or Mac. You can still generate a token
        here to use on your Apple device.
      </p>
    ),
    run: (
      <p className="text-xs" style={stepBodyStyle}>
        Run the Shortcut and pick <strong>Import all notes</strong> or <strong>Choose a folder</strong>&nbsp;
        &mdash; one tap, no picking notes one by one. Paste your token the first time it asks.
      </p>
    ),
    confirm: (
      <p className="text-xs" style={stepBodyStyle}>
        Your notes land in the notepad under an <strong>Apple&nbsp;Notes</strong> folder.
        The banner above updates once a run finishes.
      </p>
    ),
  };

  return (
    <section
      aria-labelledby="apple-notes-heading"
      className="px-6 py-6 rounded-xl"
      style={{ background: 'var(--alabaster)', border: '1px solid var(--pale-stone)' }}
    >
      <h3
        id="apple-notes-heading"
        className="text-sm mb-2"
        style={{ fontFamily: 'Cormorant Garamond, serif', color: 'var(--deep-umber)' }}
      >
        Connect Apple Notes
      </h3>

      {/* Top status banner — the only place the imported-count string is rendered. */}
      <div
        role="status"
        className="mb-4 px-3 py-2 rounded-lg"
        style={{ background: TONE_BG[status.tone], fontFamily: 'Outfit, sans-serif' }}
      >
        <p
          className="text-xs"
          style={{ color: status.tone === 'idle' ? 'var(--silica)' : 'var(--deep-umber)' }}
        >
          {status.headline}
        </p>
        {status.detail && (
          <p className="text-xs mt-1" style={{ color: 'var(--silica)' }}>{status.detail}</p>
        )}
      </div>

      {/* Numbered guide */}
      <ol className="flex flex-col gap-4 mb-4">
        {steps.map((s, i) => (
          <li key={s.id} data-step-id={s.id} data-step-state={s.state} className="flex gap-3">
            {badge(i + 1, s.state)}
            <div className="flex-1">
              <p className="text-xs mb-1" style={stepTitleStyle}>{s.title}</p>
              {stepBodies[s.id]}
            </div>
          </li>
        ))}
      </ol>

      {/* Detailed walkthrough (calm by default, in-depth when opened) */}
      <details className="mb-3">
        <summary
          className="text-xs cursor-pointer"
          style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
        >
          See the full step-by-step
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-xs" style={stepBodyStyle}>
          <p>
            <strong>1. Token.</strong> Tap <em>Generate token</em> above and copy the
            {' '}<code>psalms_pat_&hellip;</code> value. It&rsquo;s shown only once &mdash; generate a
            new one anytime if you lose it.
          </p>
          <p>
            <strong>2. Install.</strong> Tap <em>Install Shortcut</em>{' '}
            {isApple ? devicePhrase : 'on your Apple device'}. It opens in the Shortcuts app;
            tap <em>Add Shortcut</em>. No Shortcuts app? Install it from the App Store first.
          </p>
          <p>
            <strong>3. Run &amp; choose.</strong> Open the Shortcut and run it. You&rsquo;ll see a
            menu: <em>Import all notes</em> brings in everything; <em>Choose a folder</em> imports
            one folder. Either way it&rsquo;s a single tap &mdash; no selecting notes individually.
            The first run asks for your token; paste the value you copied.
          </p>
          <p>
            <strong>4. Where they land.</strong> Imported notes appear in your Psalms notepad
            inside an <em>Apple Notes</em> folder. Re-run anytime to pull in new notes.
          </p>
          <p>
            <strong>If a run fails:</strong> a <em>401</em> means the token was revoked or mistyped
            &mdash; generate a fresh one. A <em>429</em> means you imported a lot quickly; wait a
            bit and run again.
          </p>
        </div>
      </details>

      {/* Always-visible honesty note */}
      <p className="text-xs mb-4" style={stepBodyStyle}>
        Editing a note in Apple Notes and re-importing creates a <strong>new</strong> copy
        (notes are matched by their content). You can run the Shortcut again anytime &mdash;
        re-importing unchanged notes is safe.
      </p>

      {error && (
        <p
          role="alert"
          className="text-xs mb-3"
          style={{ color: '#b04040', fontFamily: 'Outfit, sans-serif' }}
        >
          {error}
        </p>
      )}

      {/* Your tokens */}
      {list.length > 0 && (
        <div>
          <p className="text-xs mb-2" style={stepBodyStyle}>Your tokens</p>
          <ul className="flex flex-col gap-2">
            {list.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 text-xs"
                style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
              >
                <span>{t.name}</span>
                <span style={{ color: 'var(--silica)' }}>
                  {t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : 'never used'}
                </span>
                <button
                  type="button"
                  onClick={() => void onRevoke(t.id)}
                  disabled={busy}
                  className="underline disabled:opacity-50"
                  style={{ color: '#b04040' }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the full component test file to verify all 12 pass**

Run: `npx vitest run src/auth/components/ApplePersonalTokensSection.test.tsx`
Expected: PASS — 7 existing + 5 new = 12 tests.

If the "renders the four numbered guide steps" test fails on `getByText('Run it & choose your notes')`, confirm the JSX renders the title as a plain string (`{s.title}`) — the `&` is a literal ampersand, not an entity, so the DOM text is exactly `Run it & choose your notes`.

- [ ] **Step 5: Run the whole auth suite to confirm no collateral breakage**

Run: `npx vitest run src/auth`
Expected: PASS (including `apple-import-steps.test.ts`, `apple-import-status.test.ts`, `personal-tokens.test.ts`).

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc -b && npx eslint src/auth/components/ApplePersonalTokensSection.tsx src/auth/components/ApplePersonalTokensSection.test.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/auth/components/ApplePersonalTokensSection.tsx src/auth/components/ApplePersonalTokensSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(apple-import): guided numbered panel with honest step state

Restructure Connect Apple Notes into a 4-step guide (token → install →
run → confirm) driven by deriveImportSteps, plus a collapsed
"See the full step-by-step" walkthrough and an always-visible
edit-makes-a-duplicate / safe-to-re-run note. Token generate/reveal/copy,
revoke, status banner, platform branch, and endpoint-URL absence all
preserved. 7 existing + 5 new component tests green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rewrite the Shortcut runbook (menu-based, no per-note picker)

**Files:**
- Modify: `docs/runbooks/apple-notes-import.md`

**Interfaces:**
- Consumes: nothing (docs).
- Produces: the source-of-truth recipe the human uses to rebuild the out-of-repo Shortcut. No code depends on it.

There is no automated test for docs; verification is a careful re-read against acceptance criterion 5 plus the repo-wide gates staying green.

- [ ] **Step 1: Update the "User setup" step 3 to describe the one-tap menu**

In `docs/runbooks/apple-notes-import.md`, replace the current step 3 under `## User setup`:

```markdown
3. On first run the Shortcut prompts for the token and stores it; paste the value.
```

with:

```markdown
3. Run the Shortcut. It shows a one-tap menu — **Import all notes** or
   **Choose a folder** — then imports everything with no per-note tapping. On the
   first run it asks for your token; paste the value you copied.
```

- [ ] **Step 2: Replace the "Shortcut recipe" section**

Replace the entire `## Shortcut recipe (build once, distribute as an iCloud link)` section (from that heading through the "Why no dates?" blockquote, inclusive) with:

```markdown
## Shortcut recipe (build once, distribute as an iCloud link)

The recipe is **menu-driven and tap-free**: the user chooses scope **once**
(all notes, or one folder) and every matching note imports with **no per-note
picker**. Removing the old `Choose from List` per-note step is the whole point —
it is what made the user tap through notes one by one.

1. **Ask for Input** (Text) → prompt `Paste your Psalms token (psalms_pat_…)` →
   **Set Variable** `token`. *(First-run prompt. To make repeat runs one tap, see
   the token-storage note below.)*
2. **Text** → the import endpoint
   `https://<project-ref>.functions.supabase.co/import-apple-note`
   (or `${VITE_SUPABASE_URL}/functions/v1/import-apple-note`) → **Set Variable** `endpoint`.
3. **Choose from Menu** with two items:
   - **Import all notes** → **Find Notes** with **no folder filter** (every note).
   - **Choose a folder** → **Find Notes** → **Add Filter → Folder → is → Ask Each Time**
     (the user picks one folder at run time).
   There is **no** `Choose from List` per-note picker in either branch.
4. **Repeat with Each** over the found notes. Inside the loop, the current note is the
   **Repeat Item** variable (the Note type exposes **Name, Summary, Body, Folder, Tags** —
   no dates, which is why the server keys off content):
   - Repeat Item → **Name** → **Set Variable** `noteTitle`.
   - Repeat Item → **Body** → **Set Variable** `noteText`.
   - **Get Contents of URL** (input = `endpoint`):
     - Method: `POST`
     - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
     - Request Body: JSON →
       `{ "title": noteTitle, "text": noteText, "folder_name": "<folder name>" }`
5. **Show Notification** after the loop with a count of `created` + `unchanged`
   responses (e.g. "Imported N notes").

The endpoint returns `{ status: "created" | "unchanged", note_id }` per note.

**Token-storage note.** The steps above prompt for the token **every run** (safest for
a link you share with others, so no one inherits your token). For your **own personal**
copy, storing the token once is much nicer: replace step 1 (Ask for Input + Set Variable)
with a single **Text** action holding your `psalms_pat_…` value + **Set Variable** `token`
— no prompt on future runs. Keep the shared/distributed link on Ask-for-Input; switch only
your personal copy to stored.

> **Why no dates?** Apple Shortcuts cannot read a note's id or its creation/
> modification dates (the Note variable only exposes Name, Summary, Body, Folder,
> Tags). So the server identifies a note by a **hash of its title + body**, not by
> date. Sending `created_at`/`modified_at` is unnecessary (and they'd be empty).
```

- [ ] **Step 3: Replace the "Building the Shortcut step by step" section**

Replace the entire `## Building the Shortcut step by step (maintainer, one-time)` section (from that heading through its closing blockquote `> Note: a Shortcut is authored in Apple's GUI …`, inclusive) with:

```markdown
## Building the Shortcut step by step (maintainer, one-time)

Build this once in the **Shortcuts app** (easiest on a Mac, also works on iPhone/iPad),
test it, then share it as an iCloud link. Each numbered step is one action you add by
searching the action list and dragging it in, in order.

**Prep:** Shortcuts → **File ▸ New Shortcut** (Mac) or **+** (iOS). Name it
`Import Apple Notes`. It runs standalone (Share Sheet not needed).

1. **Ask for Input** → Input type **Text**, prompt `Paste your Psalms token (psalms_pat_…)`.
   Then **Set Variable** `token`.
   *(To store the token instead of prompting: replace these two with one **Text** action
   holding the token + **Set Variable** `token`. Recommended only for your personal copy —
   see the token-storage note above.)*

2. **Text** → the endpoint URL exactly:
   `https://<project-ref>.functions.supabase.co/import-apple-note`
   Then **Set Variable** `endpoint`. *(Replace `<project-ref>` before sharing.)*

3. **Choose from Menu** (search "Choose from Menu"). Set two menu items:
   **Import all notes** and **Choose a folder**. This creates two branches — put the
   matching **Find Notes** action inside each:
   - Under **Import all notes** → **Find Notes** with **no filter** (all notes).
   - Under **Choose a folder** → **Find Notes** → **Add Filter → Folder → is**, then tap the
     folder value and pick **Ask Each Time** so the user chooses a folder at run time.
   Leave **Sort by** / **Limit** off in both. **Do not** add a `Choose from List` action —
   the tap-free import is the point.

4. **Repeat with Each** (search "Repeat with Each"), passed the **Notes** output of the
   branch you're in. (Simplest: end both menu branches by setting a shared `notes` variable,
   then place one **Repeat with Each** over `notes` after the menu.) Everything below goes
   *inside* the Repeat block. The current note is the **Repeat Item** variable.

   There is **no** "Get Details of Notes" action. To read a field, insert **Repeat Item**
   and click the token to choose the detail (Name, Summary, Body, Folder, Tags — **no dates**).

   4a. **Text** → insert **Repeat Item** → choose **Name** → **Set Variable** `noteTitle`.

   4b. **Text** → insert **Repeat Item** → choose **Body** → **Set Variable** `noteText`.

   4c. **Get Contents of URL**, input = the `endpoint` variable. **Show More** and set:
       - **Method:** `POST`
       - **Headers:** `Authorization` = `Bearer ` then the `token` variable;
         `Content-Type` = `application/json`
       - **Request Body: JSON**, add fields (Type = Text): `title` = `noteTitle`,
         `text` = `noteText`, `folder_name` = the folder name (a Text value, or reuse the
         **Ask Each Time** folder from step 3).

   4d. *(Optional)* **Get Dictionary Value** → key `status` from the **Contents of URL**
       output → **Add to Variable** `results` to tally outcomes.

5. *(After End Repeat)* **Show Notification** (or **Show Result**) with the `results` count
   so the user sees how many notes were created/unchanged.

**Test before sharing:** run against a small test folder (2–3 notes) via **Choose a folder**,
then via **Import all notes**. First run reports `created`; an immediate re-run reports
`unchanged`. (Editing a note's text then re-running imports it as a *new* note — identity is
the title+body hash; see Behaviour.) Confirm the notes appear under **Apple Notes › <folder>**
in the Psalms notepad.

**Distribute:** Shortcuts → right-click → **Share** → **Copy iCloud Link** (enable iCloud
sharing if prompted). Put that link in the Settings → Connect Apple Notes panel constant
(`APPLE_SHORTCUT_ICLOUD_URL`) and in the "User setup" section above. Anyone with the link
installs it in one tap; on first run it prompts for their own token.

> Note: a Shortcut is authored in Apple's GUI and lives as a `.shortcut` file in
> iCloud, not as code in this repo. These instructions are the source of truth for
> rebuilding it; there is no file to commit here beyond this runbook.
```

- [ ] **Step 4: Verify the untouched sections are intact**

Run: `grep -n '^## ' docs/runbooks/apple-notes-import.md`
Expected headings, in order: `User setup`, `Shortcut recipe (build once, distribute as an iCloud link)`, `Building the Shortcut step by step (maintainer, one-time)`, `Behaviour`, `Deployment (run by a maintainer)`, `Revocation`. Confirm **Behaviour**, **Deployment**, and **Revocation** are unchanged.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/apple-notes-import.md
git commit -m "$(cat <<'EOF'
docs(apple-import): menu-based, tap-free Shortcut runbook

Replace the per-note recipe with a Choose from Menu flow (Import all
notes / Choose a folder) and drop the Choose from List picker that forced
one-by-one tapping. Document the token-storage option (prompt-per-run for
shared links, stored for a personal copy). Behaviour/Deployment/Revocation
unchanged. The Shortcut itself is out-of-repo Apple GUI work.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (run once after all tasks)

- [ ] **Full gates green**

Run: `npm run test`
Expected: all suites pass **except** the pre-existing `garden-scene` failure (not ours). Confirm `apple-import-steps` (8) and `ApplePersonalTokensSection` (12) are green.

Run: `npx tsc -b`
Expected: exits 0.

Run: `npx eslint src/auth`
Expected: no new errors on the touched files.

- [ ] **Manual smoke check (optional, browser)**

Load the profile/settings page in the dev server, open **Connect Apple Notes**, and confirm: 4 numbered steps render; step 1 checks after Generate; the "See the full step-by-step" disclosure expands; the edit-duplicate note is visible; a non-Apple UA still shows the "needs an Apple device" line + Generate button and no Install link.

---

## Post-plan follow-up (not a task — gated on external input)

When the user rebuilds the Shortcut from the updated runbook and hands back the **new iCloud link**, swap the value of `APPLE_SHORTCUT_ICLOUD_URL` in `src/auth/components/ApplePersonalTokensSection.tsx` (and update the "User setup" link in the runbook), then update the existing component test's expected href. Ship as a one-line follow-up commit.

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- Tap-free import / menu recipe → Task 3 (runbook) + noted Deliverable 1 human step. ✓
- Guided web panel (numbered token→install→run→confirm) → Task 2. ✓
- Honest status / `deriveImportSteps` matrix + "run never active" → Task 1 (helper + tests) + Task 2 (wiring, `data-step-state`). ✓
- Detailed walkthrough disclosure → Task 2 (`<details>`). ✓
- Edit-duplicate + safe-to-re-run note → Task 2 (always-visible `<p>`). ✓
- Reuse `apple-import-status.ts` / `personal-tokens.ts` unchanged → no task modifies them; imports only. ✓
- Non-Apple branch preserved; endpoint URL absent → Task 2 (install-step non-Apple body; no endpoint render) + existing tests retained. ✓
- Token list / Revoke moved to "Your tokens" area → Task 2. ✓
- Testing (pure matrix + component guide/disclosure/platform/URL-absence) → Task 1 + Task 2 tests. ✓
- Acceptance criteria 1–6 → covered across Tasks 1–3 + Final verification. ✓
- iCloud-link swap as follow-up → documented as post-plan follow-up. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — every code and doc step contains full content. ✓

**3. Type consistency:** `deriveImportSteps({ hasToken, hasRun, importedCount })` and the `StepState`/`StepId`/`GuideStep` names match between Task 1 (definition), its tests, and Task 2 (import + `BADGE_STYLE: Record<StepState, …>`, `stepBodies: Record<StepId, ReactNode>`, `steps.map`). `deriveImportStatus` and `PersonalToken` shapes match the reused modules. Component still exports `ApplePersonalTokensSection` + `IMPORT_ENDPOINT` unchanged (consumed at `ProfilePage.tsx:345`). ✓
