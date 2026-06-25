# Notepad Dark Mode — Design

**Date:** 2026-06-22
**Status:** Approved (design); pending spec review
**Scope:** Dark theme for the entire notepad workspace (`/notepad/notes` — Journal, Study, Bible, Graph, Collection, Lamplight, onboarding, dialogs). Marketing/landing/auth/profile/admin routes are explicitly **out of scope** and stay light.

---

## 1. Summary

Add a user-selectable light/dark theme to the notepad. The notepad's surfaces are colored almost entirely through ~8 brand CSS custom properties applied via inline `style` (not Tailwind `dark:` classes), so the core of the feature is **redefining those variables under a dark scope** — that flips ~430 references plus the entire TipTap editor automatically. The remainder is a bounded set of hardcoded color literals and the graph canvas (which paints via JS, not CSS).

Persistence and the toggle clone the already-shipped `bible_translation` preference: a `profiles.theme` column synced for signed-in users, with `localStorage` as the instant/anonymous fallback.

Dark palette is derived from the **notepad landing hero**: warm near-black background (`#0e0e0e`), warm off-white ink (`#efedee` / `#f4f0e8`), warm taupe-gold accent (`#c4b5a0`), and warm grey muted tones (`#b7ada0` / `#8d8478`).

---

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | Whole notepad workspace; marketing/auth untouched |
| Trigger | Toggle, default `'system'` (follows OS until first explicit flip) |
| Palette | Notepad landing **hero** colors (warm near-black) |
| Persistence | `profiles.theme` synced; `localStorage` fallback for anon/offline |
| Scoping mechanism | **Approach C** — `.dark` on `<html>`, applied only while a notepad route is mounted |
| Desktop toggle placement | Beside the New Note `+` button in `NotepadToolbar.tsx` |
| Mobile toggle placement | Beside the account/User-icon button in `MobileNotesView.tsx` / `MobileEditorView.tsx` |

---

## 3. Architecture — Approach C (route-gated `.dark`)

The notepad has three paint roots (`DesktopNotepadWorkspace`, `MobileNotepadWorkspace`, `StudyWorkspace`) and many dialogs/dropdowns render in **React portals on `document.body`** (outside those roots). To cover portals + Tailwind `dark:` variants without leaking dark into marketing:

- A `ThemeProvider` owns theme state and applies the `dark` class to `document.documentElement` **only when** `effectiveTheme === 'dark'` **and** the current route is under `/notepad/notes`. The class is removed when leaving the notepad or switching to light.
- Brand-variable dark values live in a single `.dark { … }` block in `src/index.css`.
- Because `.dark` sits on `<html>` while in the notepad, portaled Radix surfaces and any Tailwind `dark:` variants resolve correctly. Because it is stripped on exit, marketing/landing/auth never render dark.
- Tailwind is already configured `darkMode: ["class"]` (`tailwind.config.js:3`), so no config change is needed.

**Rejected alternatives:**
- **A — `[data-theme="dark"]` on the 3 roots only.** Matches the `[data-mode="study"]` precedent and is zero-risk to marketing, but portaled dialogs/dropdowns mount outside the roots and would stay light without extra plumbing.
- **B — global always-on `.dark`.** Simplest, but darkens marketing/auth — out of scope.

### Provider placement

`ThemeProvider` mounts in `src/App.tsx` just inside `<AuthProvider>` (so it can read `useAuthSession`) and wraps `<Routes>`. The route-gating effect reads `useLocation()`.

Provider nesting (existing): `main.tsx` → `BrowserRouter` → `App` → `AuthProvider` → `RouteTransitionProvider` → `LoadingOverlayContext` → `Routes`. New: `ThemeProvider` between `AuthProvider` and `RouteTransitionProvider` (or wrapping `Routes`).

---

## 4. Theme state & persistence

### 4.1 Stored value
`theme: 'system' | 'light' | 'dark'`, default `'system'`.

- `'system'` resolves to live `'light' | 'dark'` via `matchMedia('(prefers-color-scheme: dark)')` with a `change` listener.
- The toggle UI shows the *resolved* state; the first flip writes an explicit `'light'` / `'dark'`.

### 4.2 `useThemePreference({ userId })`
Modeled directly on `src/notepad/bible/useBibleTranslation.ts`:

1. Initial state from synchronous `loadEnum(KEY_THEME, ['system','light','dark'], 'system')` (no FOUC).
2. When `userId` becomes available, hydrate from `profiles.theme` (`select` → set state if different).
3. Setter: write `localStorage` immediately via `saveEnum(KEY_THEME, value)`; for signed-in users also `supabase.from('profiles').update({ theme: value }).eq('id', userId)`.

`KEY_THEME = 'psalms.session.theme'` added to `src/notepad/session/session-storage.ts` (reuse `loadEnum` / `saveEnum`).

`userId` sourced as `const userId = user?.id ?? null;` from `useAuthSession()` (same idiom as `BibleStudyPane.tsx:26-27`).

### 4.3 Migration
`supabase/migrations/039_profiles_theme.sql` (next number after `038`):

```sql
alter table public.profiles
  add column theme text not null default 'system';

alter table public.profiles
  add constraint profiles_theme_check check (theme in ('light','dark','system'));
```

- Apply via `supabase db push`.
- **Verify** the new column is owner-writable and **not** captured by the `021_protect_privileged_profile_columns` trigger (model it after `bible_translation`, which is a plain owner `update`). Add/extend a case in `src/notepad/storage/profiles-privileged-columns.test.ts` asserting a user can self-update `theme`.

---

## 5. Palette mapping

Dark values derived from the landing hero (`src/notepad-landing/styles/landing.css`): bg `#0e0e0e`, ink `#efedee`/`#f4f0e8`, accent `#c4b5a0`, muted `#b7ada0`/`#8d8478`. The hero near-black anchors the **deepest** layer (`--app-bg`); the writing paper sits one step up as a **slightly-lifted warm charcoal** so long-form text doesn't read against pure black, and elevated chrome lifts once more. This gives a three-step warm elevation ramp: body `#0a0a0a` → paper `#16130f` → elevated `~#211d17`. Exact values are tuned during visual QA (Tier 4).

| Variable (role) | Light | Dark (starter) |
|---|---|---|
| `--app-bg` (body behind notepad — deepest layer) | `#988F80` | `#0a0a0a` |
| `--plaster` (workspace + editor paper — lifted warm charcoal) | `#F0ECE8` | `#16130f` |
| elevated surface (toolbars / sidebar / popovers — see §6) | plaster tint | `~#211d17` / `rgba(255,255,255,.05)` |
| `--deep-umber` (body ink) | `#3A3426` | `#efedee` |
| `--charred` (headings/titles) | `#19130C` | `#f4f0e8` |
| `--silica` (muted text/icons) | `#8A8B90` | `#8d8478` |
| `--warm-sand` (active/hover, blockquote rule) | `#BCB3A3` | `#c4b5a0` (low-alpha for fills) |
| `--pale-stone` (hairlines) | `#CECCCA` | `rgba(255,255,255,.10)` |
| `--alabaster` (lamplight empty bg) | `#F5F0E8` | `#14120f` |
| `--cream` (Study bg; currently inline fallback only) | `#F4F1EA` | `#0e0e0e` |
| `--lamplight-accent` (scripture gold) | `#C49A78` | `#c4b5a0` |

Plus a **warm-tinted dark mapping of the shadcn HSL set** (`--background`, `--foreground`, `--card(-foreground)`, `--popover(-foreground)`, `--primary(-foreground)`, `--secondary(-foreground)`, `--muted(-foreground)`, `--accent(-foreground)`, `--border`, `--input`, `--ring`, `--destructive(-foreground)`) so portaled dialogs/inputs/toasts/sonner match the warm dark rather than shadcn's default cool grey. Note `[data-mode="study"]` keeps its `--lamplight-accent` override (indigo `#43508C`) layered on top of dark.

---

## 6. Hardcoded-literal & graph strategy (tiered)

**Tier 1 — auto-flip (the 80%).** Add `.dark { … }` redefining the ~8 brand vars + shadcn HSL set. Flips ~430 var references and the entire TipTap editor (`.notepad-editor .tiptap` rules in `index.css` are all var-driven).

**Tier 2 — literal families.** Convert recurring inline literals to their corresponding vars (or add `.dark` overrides):
- `rgba(240,236,232,*)` → `--plaster` (panels/popovers/floating surfaces)
- `rgba(188,179,163,*)` → `--warm-sand` (active/hover rows, tags)
- `rgba(206,204,202,*)` → `--pale-stone` (translucent borders)
- `rgba(62,50,40,*)` / `rgba(58,52,38,*)` → `--deep-umber` ink (graph labels, scrollbars, scripture shadows)
- 20× `hover:bg-black/5` (and `bg-black/10`) → add `dark:hover:bg-white/10` (enabled by the `<html>.dark` class). Affected files include `Editor.tsx`, `Sidebar.tsx`, `GraphPane.tsx`, `NotepadToolbar.tsx`, `NotepadAuthControls.tsx`, `FolderItem.tsx`, `NoteItem.tsx`, `MobileNotesView.tsx`, `MobileEditorView.tsx`.

**Tier 3 — specific surfaces.**
- **Graph canvas** (`src/notepad/graph/graph-view.ts` `NODE_COLORS` lines 79-85; `src/components/sections/notepad/GraphPane.tsx` duplicate `NODE_COLORS` 16-22, edge `rgba(168,160,145,*)`, hover-label `rgba(62,50,40,*)`, popover surface/border, `accent-[#C49A78]`): the canvas paints via JS, so CSS vars don't reach it. Re-theme by reading the canvas element's computed CSS vars (`getComputedStyle`) at draw/init time and deriving the node/edge/label palette from them, so it auto-syncs with the theme. Node hues may need slight brightening for contrast on `#0e0e0e`; verify.
- `src/notepad/extensions/scripture-ref.css` — `/verse` dropdown + inline scripture pill gold accents, verse-card bg, shadows; add `.dark` overrides. Confirm the scoped `::selection` override still reads.
- `src/notepad/scan/scan.css` — scan/transcription UI (gold FAB, camera bg, error rose, found-verse teal).
- Lamplight chat bubbles (`components/lamplight/chat/*`, `study/panes/LamplightStudyPanel.tsx`).
- `src/notepad/decorations/DecorationItem.tsx` — `#fff` sticker handles, shadows.
- Named-but-fixed classes: `text-red-600` (error text ×8), `text-white` (×2) — contrast spot-check.
- Highlight swatches (`HighlightSwatchPopover.tsx`, `HighlightPill.tsx`, `extensions/bible-verse.ts`, `bible/highlights/*`) — verify swatch contrast; these may stay fixed by intent.

**Tier 4 — visual QA.** Manual pass across Journal, Study, Bible (reader + split), Graph, Collection/sidebar, onboarding SpotlightTour, search dialog, and all dropdowns/dialogs.

---

## 7. Toggle UI

A compact sun/moon control reusing `src/components/ui/switch.tsx` (or an icon `Toggle` from `src/components/ui/toggle.tsx`). Behavior: default `'system'`; control reflects the resolved state; first interaction sets explicit `'light'` / `'dark'`. A small icon-button (Sun/Moon from lucide-react) is the leading visual candidate; final form chosen during implementation to match adjacent controls.

**Mount points:**
- **Desktop Journal:** `src/notepad/components/NotepadToolbar.tsx`, beside the New Note `+` button (line ~136).
- **Mobile:** the header `flex items-center gap-1` row in `src/components/sections/notepad/mobile/MobileNotesView.tsx` and `MobileEditorView.tsx`, beside the account/User-icon button (line ~54).
- **Study desk:** the Journal toolbar isn't present on the Study desk; place the same control near the Study header's account control (`NotepadAuthControls`) for parity. Minor — confirmed during implementation.

The control reads/writes through `useThemePreference` (consumed from the `ThemeProvider` context); `userId` flows from `useAuthSession`.

---

## 8. Testing

- **Unit (`useThemePreference`):** localStorage default → `'system'`; profile hydrate on `userId`; setter writes localStorage + profile; `'system'` resolution and `matchMedia` `change` listener update. Mirror `useBibleTranslation` tests.
- **Migration guard:** extend `profiles-privileged-columns.test.ts` so `theme` is self-updatable by the row owner.
- **Provider/route gating:** test that `.dark` is present on `<html>` for a notepad route + dark theme, and absent on a marketing route or in light.
- **Visual QA (Tier 4):** manual against the running app; no automated screenshot gate.

---

## 9. Risks & constraints

- **FOUC:** `.dark` is applied in a layout effect on notepad entry from the synchronous localStorage read; flash is negligible. Watch item, not a blocker.
- **Pre-existing red baseline** (project memory): the repo ships with ~114 lint errors, 4 tsc errors, and 2 failing test files unrelated to this work. Gate on **zero new** lint/tsc/test errors introduced by this change, not on a green repo.
- **next-themes is a no-op today** (only `sonner.tsx` imports `useTheme`, no provider mounted). We build our own `ThemeProvider`; optionally feed sonner from it later — not required for v1.
- **Migrations** apply via `supabase db push`; no edge-function changes involved.
- **No collision** with existing `use-adaptive-dock-theme` / `nav-theme` code — those are nav/dock legibility adapters, not a user theme.

---

## 10. Out of scope (v1)

- Marketing/landing/auth/profile/admin dark theming.
- Per-note or per-folder theme overrides.
- A tri-state UI control (system/light/dark as three explicit buttons) — `'system'` is the default-until-flip; no dedicated "Use system" reset in v1.
- Theming sonner/toasts beyond what the shadcn HSL dark mapping provides for free.
