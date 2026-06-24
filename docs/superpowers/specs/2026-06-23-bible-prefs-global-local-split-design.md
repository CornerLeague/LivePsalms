# Spec: Global-vs-Local Bible Preferences (version + verse layout)

**Date:** 2026-06-23
**Branch:** `feat/bible-version-global-prefs` (extends PR #53; modifies not-yet-merged code from that PR)
**Status:** Approved design — ready for implementation plan.

## Problem

Two issues with the Bible version + verse-layout preferences shipped in PR #53:

1. **Persistence bug — a change does not survive reload.** In `src/notepad/bible/useBibleTranslation.ts` (and its mirror `useBibleVerseLayout.ts`):
   - `setTranslation` fires the DB write as `void supabase.from('profiles').update(...)` — unawaited, so any failure (network/RLS/etc.) is **silent**.
   - The mount `useEffect` **unconditionally** runs `setState(remote)` + `saveEnum(...)` from the DB value. So on reload the DB value always wins, and there is also a race where a slow session-restore read lands *after* a user change and clobbers it.
   - Net effect: if the write silently failed, or the read races the change, reload reverts to the stale value.

2. **No global-vs-local distinction.** Both the Profile settings and the in-reader "Bible pillar" selector write the same way (auto-save to DB). The desired model: Settings is the single deliberate *global* change; the pillar is a quick *per-device* override.

## Approved Behavior

### Persistence model

- **localStorage** is the effective per-device value — instant, and **authoritative** for what the reader displays.
- **DB** (`profiles.bible_translation`, `profiles.bible_verse_layout`) is the **global** value. It is:
  - **Written only** by Profile Settings → **Save**.
  - **Read once** on first load, used **only to seed** a device whose localStorage is not yet set.
- **On reload:** localStorage wins. The DB read never overrides an already-set local value. (This removes today's clobber and the race — the core of the bug fix.)
- **Sync trade-off (accepted):** a global Save on device A does not auto-change device B if B already has a different local pillar override; B keeps its local pick until someone Saves there. (Decision: "Local wins; Save takes over.")

### Scope

Applies to **both** the Bible version and the verse-layout preference. The Settings Save button persists both together.

## Components & Changes

### 1. `session-storage.ts` — presence detection

The hooks must distinguish "localStorage was actually set" from "absent → using the BSB / `inline` default" (today `loadEnum` collapses both to the default).

- Add a small helper `hasStored(key: string): boolean` returning `readRaw(key) != null` (reuse the existing module-private safe-getter `readRaw` that `loadEnum` already uses; export `hasStored` alongside `loadEnum`/`saveEnum`). Keys unchanged: `KEY_BIBLE_TRANSLATION` (`psalms.bible.translation`), `KEY_BIBLE_VERSE_LAYOUT` (`psalms.bible.verseLayout`).

### 2. `useBibleTranslation.ts` / `useBibleVerseLayout.ts` — two write paths + seed-only hydration

Both hooks change identically:

- **Initial state:** unchanged — read localStorage synchronously via `loadEnum` (instant default).
- **Mount effect (`[userId]`):** if `!userId || !supabase` → return. Read the profile column. Then:
  - **Seed only when local is unset:** if `!hasStored(KEY)` *and* the remote value is valid → `setState(remote)` + `saveEnum(KEY, remote)`.
  - **Otherwise do nothing** — local wins; never override a set local value. (Keep the `cancelled`/unmount guard.)
- **Local setter** `setLocalTranslation(value)` / `setLocalVerseLayout(value)`: `setState(value)` + `saveEnum(KEY, value)`. **No DB write.**
- **Global write** (exposed via the provider, see below): `setState(value)` + `saveEnum(KEY, value)` + **awaited** `supabase.from('profiles').update({ <column>: value }).eq('id', userId)`, returning an error if it fails. No-op DB write when `!userId || !supabase` (still updates state + localStorage, returns `{ ok: true }`).

> The hooks may expose the global writer per-column; the provider composes them into a single `saveGlobalPrefs`. Exact factoring (one combined hook call vs. two) is a plan detail, provided the contract below holds.

### 3. `BiblePrefsProvider` / `bible-prefs-context.ts` — new interface

```ts
interface BiblePrefsContextValue {
  translation: BibleTranslation;
  verseLayout: VerseLayout;
  setLocalTranslation: (t: BibleTranslation) => void;   // pillar: localStorage only, no DB
  setLocalVerseLayout: (l: VerseLayout) => void;          // any in-reader layout control: local only, no DB
  saveGlobalPrefs: (p: { translation: BibleTranslation; verseLayout: VerseLayout })
    => Promise<{ ok: boolean; error?: string }>;          // Settings Save: DB (both columns) + localStorage + state, awaited
}
```

- `saveGlobalPrefs` writes **both** columns (awaiting both), updates state + localStorage for both, and returns `{ ok: false, error }` if any write fails. On `{ ok: true }` the saved values "take over" (state + localStorage now match the global value).
- The single-instance grep-guard test (`single-instance.test.ts`) keeps the underlying hooks confined to the prefs module; update it if symbol names change.

### 4. `BibleReadingSettingsSection.tsx` — draft form + Save

- Hold **draft** state (`useState`) for version + layout, **seeded from context** (`translation`, `verseLayout`) on mount and re-synced if context changes.
- The version `<select>` and the layout toggle buttons edit the **draft only** (no context/DB writes on change).
- A **Save** button:
  - **Enabled only when dirty** (draft differs from the current context values).
  - On click → `await saveGlobalPrefs(draft)`; disable + show "Saving…" while in flight.
  - Success → `toast.success('Bible settings saved')`. Error → `toast.error(result.error ?? 'Could not save Bible settings')`.
- Preserve the existing section/label styling conventions (`sectionStyle`, `labelStyle`, translation attribution `<p>`).

### 5. `BibleReader.tsx` toolbar — local set + nudge + tooltip

- Version `<select>` `onChange` → `onTranslationChange(value)` (now wired to `setLocalTranslation`) **then** fire a sonner toast nudge:
  - **Toast:** `Switched to ${translationInfo(value).label} on this device. To use it everywhere, set it in Profile → Bible & Reading.`
  - Fire the toast only on the user gesture (the `onChange`), not on seed/initial render.
- Replace the existing native-`title` **(i) icon** (`<span title={...attribution}><Info/></span>`, ~lines 197–199) with the app's Radix `Tooltip` (`src/components/ui/tooltip.tsx`):
  - **Tooltip content:** `Changing the version here applies to this device only. To set it everywhere, update Profile → Bible & Reading.` — with the translation attribution kept as a secondary line so licensing text is not lost.
  - Wrap with `TooltipProvider` if no ancestor provides one in this subtree.
- Any in-reader **verse-layout** control (the layout cycle) is wired to `setLocalVerseLayout` (local only). **No toast/tooltip nudge for layout** — the nudge is version-only, per the approved design.

### 6. Wiring

- `BibleStudyPane.tsx` (destructure ~line 55; props ~lines 127/129) and `StudyReader.tsx` (destructure ~line 12; props ~lines 18/20): update both the `useBiblePrefs()` destructuring (the old `setTranslation`/`setVerseLayout` no longer exist) **and** the JSX → `onTranslationChange={setLocalTranslation}`, `onVerseLayoutChange={setLocalVerseLayout}`. (`onVerseLayoutChange` is the reader's layout-cycle prop, optional in `BibleReader`.)
- No DB migration — `profiles.bible_translation` (037/038) and `profiles.bible_verse_layout` (040) already exist.

### 7. Touched files & test updates (interface rename surface)

Renaming the context setters (`setTranslation`/`setVerseLayout` → `setLocalTranslation`/`setLocalVerseLayout` + new `saveGlobalPrefs`) ripples to every consumer and its tests. Full surface:

- **Production:** `session-storage.ts` (add `hasStored`); `bible-prefs-context.ts` (new interface); `BiblePrefsProvider.tsx` (compose the new value — and update its docstring, which currently asserts the DB is the "durable, cross-device source of truth"; under the new model localStorage wins and the DB is the global-on-Save / seed-only value); `useBibleTranslation.ts` + `useBibleVerseLayout.ts`; `BibleReadingSettingsSection.tsx`; `BibleReader.tsx`; `BibleStudyPane.tsx`; `StudyReader.tsx`.
- **Tests to update:** `useBibleTranslation.test.ts` + `useBibleVerseLayout.test.ts` (setter now local-only; global writer is separate); `BibleReadingSettingsSection.test.tsx` (old "calls setTranslation on change" tests are replaced by the draft + Save tests); `BiblePrefsProvider.test.tsx` (buttons calling the old setters → new interface); `LamplightStudyPanel.test.tsx` (the `useBiblePrefs` mock object's shape); `single-instance.test.ts` (grep guard — update only if the hook/setter symbol names it matches change).
- **Read-only consumers — verified unaffected:** `LamplightStudyPanel.tsx`, `LamplightChat.tsx`, `Editor.tsx` read `translation`/`verseLayout` only and never call the setters.

## Data Flow Summary

- Effective value = provider state, hydrated instantly from localStorage, seeded from DB on first load only.
- **Pillar change** → `setLocal*` (state + localStorage), version also fires a toast nudge. No DB.
- **Settings Save** → `saveGlobalPrefs` (awaited DB for both columns + localStorage + state), success/error toast.
- **Reload** → localStorage wins; DB read seeds only when localStorage is unset.

## Testing

- **Hook regression / unit** (`useBibleTranslation`, mirror for layout):
  1. localStorage set + DB has a *different* value → after mount effect, state stays the **local** value (no override). *(direct regression for the reload bug)*
  2. localStorage **unset** + DB has a valid value → state **seeds** from DB and writes localStorage.
  3. `setLocal*` writes state + localStorage and does **not** call `supabase.update`.
  4. global writer **awaits** the DB update and returns `{ ok: false, error }` when it rejects; returns `{ ok: true }` and updates state + localStorage on success; `{ ok: true }` no-op DB path when signed out.
- **Settings section:** Save disabled until draft is dirty; clicking Save calls `saveGlobalPrefs(draft)`; success path shows the success toast and clears dirty; error path shows the error toast and leaves the form editable.
- **Pillar:** `onChange` calls `setLocalTranslation` and triggers a toast; the (i) tooltip renders the nudge message.
- Gates unchanged: `tsc -b` exit 0; `eslint` zero-new on touched files; the existing affected vitest set stays green.

## Out of Scope / Non-Goals

- Cross-device live sync of a global change to a device that already has a local override (explicitly accepted trade-off).
- Any change to how translations are fetched/rendered, the composite-PK reads, or the Lamplight edge functions.
- A migration (none needed).
