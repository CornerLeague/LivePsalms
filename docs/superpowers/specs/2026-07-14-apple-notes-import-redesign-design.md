# Apple Notes Import — Guided, Tap-Free Redesign — Design Spec

**Date:** 2026-07-14
**Status:** Approved (brainstorm) — pending spec review
**Supersedes/extends:** `docs/superpowers/specs/2026-06-12-apple-notes-connect-panel-ux-design.md` (that spec built the platform-aware panel + status banner; this one turns it into a guided step flow and removes the Shortcut's per-note tapping).
**Primary component:** `src/auth/components/ApplePersonalTokensSection.tsx` (the "Connect Apple Notes" panel in `ProfilePage.tsx:343`)
**Also:** `docs/runbooks/apple-notes-import.md` (Shortcut recipe — source of truth for the out-of-repo Shortcut)

## Problem

The current Apple Notes import feels bad. The distributed Apple Shortcut makes the user **tap through and select notes one by one** every time, and the web panel is a flat wall of buttons with no clear ordering or "here's what to do" guidance. The user's three original asks were: (1) a "Select All" button, (2) a clearer step-by-step in-depth guide, (3) a fixed-size scrollable note-selection box with an always-visible Import button.

## Reality check (why the design is shaped this way)

The user's mental model — "a React box that lists my Apple Notes with checkboxes + Select All + Import" — **is not buildable**, and understanding why drives the whole design:

- The **web panel never sees the user's Apple Notes.** iCloud has **no public Notes API.** The panel only mints a token, links to the Shortcut, and lists tokens.
- The **note-grabbing happens inside the Apple Shortcut**, on-device, in **Apple's own native UI** — which we cannot restyle or inject React into. The per-note picker (the tapping pain) lives there.
- The Shortcut is authored in Apple's Shortcuts app and distributed as an **iCloud link** — it is **NOT code in this repo.** There is no `.shortcut` file to edit. The **runbook is its source of truth.**

So the three asks map to reality as:

| Ask | Where it lives | Approach |
|---|---|---|
| "Select All" | Apple Shortcut's picker | **Delete the per-note picker.** Make tap-free folder/all import the default — "Select All" becomes moot. |
| In-depth step-by-step guide | React panel | **Build it** — guided numbered flow + expandable detailed walkthrough. |
| Fixed-size scrollable note box w/ always-visible Import | Would need a React note list (impossible) | **Not buildable / dropped.** No React selection box exists in this flow. |

## Goal

1. **Tap-free import** — rebuild the Shortcut so the user picks scope **once** (a one-tap "All notes" vs "Choose a folder" menu) and everything imports with no per-note tapping.
2. **Guided web panel** — replace the flat panel with an ordered, numbered guide (generate token → install → run → confirm), with an expandable detailed walkthrough for depth.
3. **Honest status** — clearer post-run confirmation, plus a quiet always-visible note about the edit-makes-a-duplicate gotcha and a "run it again anytime" reassurance.

**Non-goals (YAGNI):** No React list of Apple Notes (impossible — no iCloud API). No in-app "Select All" button (selection is folder/all in the Shortcut, tap-free). No real-time/per-note import progress (import runs on-device; the web app can't observe a run live — `last_used_at` + imported count remain the honest signals). Not touching the file-drop `UploadModal` / `WelcomeImportStep` importers (separate flow). No AI processing of imported notes.

## Two deliverables

This work has two halves with different owners. **The panel redesign ships independently and is valuable on its own; the tapping only disappears once the rebuilt Shortcut is live.**

### Deliverable 1 — Shortcut rebuild (owned by user/maintainer; out-of-repo GUI work)

The agent **cannot** build, test, or distribute the Shortcut (Apple GUI + iCloud). The agent **can** write exact steps and update the runbook. The human with an Apple device rebuilds it, tests it, shares a new iCloud link, and hands that link back for the agent to wire into the panel constant.

New Shortcut recipe (replaces the current per-note picker):

1. **Ask for Input** (Text) once for the token → **Set Variable** `token`. *(First-run prompt; recommend storing it so repeat runs are one tap — see token-storage note below.)*
2. **Text** = endpoint URL → **Set Variable** `endpoint` (unchanged).
3. **Choose from Menu** with two items: **"Import all notes"** and **"Choose a folder"**.
   - "Import all notes" branch → **Find Notes** with no folder filter.
   - "Choose a folder" branch → **Find Notes** → filter **Folder is** → **Ask Each Time** (user picks one folder at run time).
   - **No** `Choose from List` per-note picker in either branch — this is the change that removes the tapping.
4. **Repeat with Each** over the found notes → per-note `Name`/`Body` → **Get Contents of URL** POST (unchanged from current recipe: `Authorization: Bearer <token>`, `Content-Type: application/json`, JSON body `{title, text, folder_name}`).
5. **Show Notification** after the loop: "Imported N notes" (tally `created` + `unchanged` from responses).

**Token-storage note:** the current runbook recommends **Ask for Input every run** (safer to share). For the user's personal use, storing the token once (a **Text** action holding it + Set Variable, no prompt) is much nicer on repeat runs. The runbook will document **both**, defaulting the shared/distributed link to Ask-for-Input, and telling the user how to switch their personal copy to stored.

Agent updates `docs/runbooks/apple-notes-import.md`: replace the "Shortcut recipe" and "Building the Shortcut step by step" sections with the menu-based, no-per-note-picker recipe above; keep Behaviour/Dedup/Rate-limit/Deployment/Revocation sections. When the user provides the new iCloud link, the agent swaps `APPLE_SHORTCUT_ICLOUD_URL` in the panel (until then, the constant stays as-is and the panel still works).

### Deliverable 2 — Web panel redesign (agent-built code)

Turn `ApplePersonalTokensSection` into a **guided, numbered flow**. Reuse the existing, already-tested primitives — `deriveImportStatus`, `detectApplePlatform` (`apple-import-status.ts`), and `countImportedNotes`/`listTokens`/`createToken`/`revokeToken` (`personal-tokens.ts`) — do not reinvent them.

**The four steps (numbered, ordered):**

1. **Generate your token** — inline generate + reveal-once + Copy (existing behavior, with the "copy now — you won't see it again" warning). Shows a **done** check once a token exists.
2. **Install the Shortcut** — the existing `Install Shortcut` (iCloud link) + `Get the Shortcuts app` fallback, platform-tuned copy ("on your iPhone/iPad" vs "on your Mac").
3. **Run it & choose your notes** — short "here's what you'll see" copy explaining the one-tap **All notes / Choose a folder** menu and pasting the token on first run.
4. **Confirm** — the status banner (`deriveImportStatus`) confirming "✅ N notes imported · last import …".

**Step completion is only claimed where a real signal exists** (see `deriveImportSteps` below) — we do not fake checkmarks for things we can't observe.

**Detailed walkthrough:** a collapsed **"See the full step-by-step"** disclosure (`<details>`/toggle) under the steps, holding the in-depth version (what each Shortcut screen looks like, the menu choice, where imported notes land). Keeps the panel calm while satisfying the "in-depth guide" ask.

**Status honesty additions:**
- Keep the top status banner from `deriveImportStatus`.
- Add a quiet, always-visible one-liner: editing a note in Apple Notes and re-importing creates a **new** copy (identity is content hash), and "you can run the Shortcut again anytime — re-importing unchanged notes is safe."

**Non-Apple browsers:** unchanged — "Apple Notes import needs an iPhone, iPad, or Mac. You can still generate a token here to use on your Apple device." Token generate + list still render.

**Token list / Revoke:** preserved (last-used + Revoke), moved to a small "Your tokens" area below the guide.

## Architecture (decompose — pure logic extracted, matching the June spec's pattern)

Keep `ApplePersonalTokensSection` as the composition root. Add one pure, unit-tested helper for step state; reuse everything else.

### New: `src/auth/apple-import-steps.ts` (pure, unit-tested)

```ts
export type StepState = 'done' | 'active' | 'upcoming';
export type StepId = 'token' | 'install' | 'run' | 'confirm';
export interface GuideStep { id: StepId; title: string; state: StepState; }

// Pure derivation from signals the panel already has.
// hasToken  = tokenCount > 0
// hasRun    = lastUsedAt != null  (the Shortcut POSTed at least once → PAT consumed)
// importedCount from countImportedNotes
export function deriveImportSteps(input: {
  hasToken: boolean;
  hasRun: boolean;
  importedCount: number;
}): GuideStep[];
```

**Step-state rules (honest — only claim `done` on a real signal):**

| Step | `done` when | `active` when | `upcoming` when |
|---|---|---|---|
| `token` | `hasToken` | `!hasToken` | (never) |
| `install` | `hasRun` | `hasToken && !hasRun` | `!hasToken` |
| `run` | `hasRun` | (never — shares `install`'s only signal; see note) | `!hasRun` |
| `confirm` | `importedCount > 0` | `hasRun && importedCount === 0` | `!hasRun` |

**Why `run` is never `active`:** the only device-side signal we have is `hasRun` (`lastUsedAt != null`, i.e. the Shortcut POSTed at least once and consumed the PAT). We cannot distinguish "installed but not yet run" from "not installed." So Install carries the `active` highlight through the whole "have token, haven't run" window, and both Install and Run flip to `done` the instant the Shortcut first runs. This keeps **exactly one `active` step** in the normal path (token → install → confirm → complete), and `deriveImportSteps` guarantees ordering (a later step is never `done`/`active` while an earlier one is `upcoming`).

### Reused unchanged
- `apple-import-status.ts` — `detectApplePlatform`, `deriveImportStatus` (banner). No change.
- `personal-tokens.ts` — `createToken` / `listTokens` / `revokeToken` / `countImportedNotes`. No change.

### Changed: `ApplePersonalTokensSection.tsx`
- Same data load as today: `listTokens` + `countImportedNotes` (parallel), derive `lastUsedAt`, `detectApplePlatform` once.
- Compute `deriveImportSteps({ hasToken: list.length>0, hasRun: lastUsedAt!=null, importedCount })` and render the numbered guide with per-step state styling (done = check, active = emphasized, upcoming = muted).
- Render the detailed-walkthrough disclosure and the edit-duplicate one-liner.
- Preserve all existing a11y contracts: `aria-labelledby` heading, reveal `role="status"`, error `role="alert"`, banner `role="status"`.
- Refresh queries after Generate/Revoke → steps + banner re-derive.

## Data flow

mount → `listTokens` + `countImportedNotes` (parallel) → `hasToken` / `hasRun` (from max `lastUsedAt`) / `importedCount` → `deriveImportSteps` (guide) + `deriveImportStatus` (banner). `detectApplePlatform` (sync) → branch copy/controls. Generate/Revoke → mutate → refresh → re-derive.

## Error handling

- Follows existing patterns: query failure → existing `error` state (`role="alert"`); `countImportedNotes` failure → treat as `0` (never blocks the panel); banner falls back to `idle`/`waiting`; clipboard/links degrade gracefully.
- `deriveImportSteps` is total (never throws); missing/zero signals → earliest step `active`, rest `upcoming`.
- 401-after-revoke and 429 rate-limit explained in the detailed-walkthrough copy (not error toasts — they happen on-device).

## Testing

- `apple-import-steps.test.ts` (pure): each step's `done`/`active`/`upcoming` across the matrix — no token, token-but-never-run, run-but-0-imported (waiting), imported>0; assert ordering invariant (no `done` after an `upcoming`) and exactly-one-`active` in the normal path.
- `ApplePersonalTokensSection.test.tsx`: renders 4 numbered steps; step 1 shows `done` when a token exists; the confirm step reflects the success banner when `countImportedNotes > 0`; the detailed-walkthrough disclosure is present and toggleable; non-Apple platform still shows Generate; Install button has the iCloud href; endpoint URL is **not** rendered (regression guard from the June spec).
- Existing `apple-import-status.test.ts` / `personal-tokens.test.ts` stay green (no changes to those modules).
- Gates: `tsc -b` + `vitest` + `eslint`, all green. (Pre-existing `garden-scene` vitest failure is not ours.)

## Acceptance criteria

1. Panel renders an ordered, numbered guide (token → install → run → confirm) with honest per-step state; step 1 checks when a token exists; confirm reflects imported count.
2. A collapsed "See the full step-by-step" detailed walkthrough is present and expandable.
3. The edit-makes-a-duplicate + "safe to re-run" note is always visible.
4. Non-Apple visitor still sees the "needs an Apple device" note and can generate a token; endpoint URL still absent.
5. Runbook updated with the menu-based, **no per-note picker** recipe (All notes / Choose a folder) + token-storage note; the actual Shortcut rebuild + new iCloud link is a documented human task (out-of-repo).
6. New pure logic unit-tested; component tests cover the guide, disclosure, platform branch, and URL-absence; `tsc -b` + vitest + eslint green.

## Sequencing / dependency note

- The **panel redesign (Deliverable 2) ships on its own** — no dependency on the Shortcut. It improves the guide, ordering, and status immediately.
- The **tapping only goes away when the rebuilt Shortcut (Deliverable 1) is live.** That requires the human to rebuild in the Shortcuts app from the updated runbook and provide a new iCloud link; the agent then swaps `APPLE_SHORTCUT_ICLOUD_URL`.
- Ship path: implement + PR the panel + runbook; user rebuilds the Shortcut in parallel; final follow-up commit swaps the iCloud link when it's ready.

## File summary

- **New:** `src/auth/apple-import-steps.ts` + `apple-import-steps.test.ts`
- **Change:** `src/auth/components/ApplePersonalTokensSection.tsx` + `ApplePersonalTokensSection.test.tsx` (guide, disclosure, edit-dup note)
- **Docs:** `docs/runbooks/apple-notes-import.md` — replace recipe/build sections with the menu-based, no-per-note-picker version + token-storage note.
- **Constant swap (follow-up, when link ready):** `APPLE_SHORTCUT_ICLOUD_URL` in `ApplePersonalTokensSection.tsx`.
- **Unchanged (reused):** `apple-import-status.ts`, `personal-tokens.ts`.
