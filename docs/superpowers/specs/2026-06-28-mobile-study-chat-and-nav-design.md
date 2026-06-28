# Mobile Study Chat polish + Navigation swap — Design

**Date:** 2026-06-28
**Branch:** `feat/study-region-map` (current) — implementation may want its own branch off `main`.
**Status:** Approved design, ready for implementation plan.

## Goal

Five mobile-focused UI improvements, validated via the brainstorming visual companion:

1. Redesign the Study **Chat** tab message UI ("Refined flat" style).
2. Add **live response streaming** to the Study chat.
3. Fix **invisible typed text** in the Study chat input in dark mode.
4. Make the **auth logo light** in dark mode (in-app auth modal).
5. **Swap navigation:** replace the bottom-bar Lamplight tab with a Bible tab; move Lamplight to the top header.

## Scope decisions (locked with user)

- **Chat style:** Option C — "Refined flat" (no bubbles; labels + indigo accent bar). User picked C over chat-bubble options.
- **Streaming:** Full real streaming (backend SSE branch + manual edge-function deploy), NOT a client-side typewriter fake.
- **Bible tab target:** opens the existing **Bible reader + Lamplight-over-scripture** pane (`BibleStudyPane`).
- **Top-header Lamplight:** option A — top-right, left of Search, keeping its **gold color + connection dot**.
- **Bible tab icon:** open book (`BookOpen` from lucide-react).
- **Shared component:** chat redesign / streaming / input fix are applied to the **shared** `LamplightStudyPanel` (desktop Study gets them too) — user explicitly approved applying to the shared component rather than hard-gating to mobile.

## Architecture context (as-found)

- **Dark mode** = `.dark` class toggled on `document.documentElement`, gated by route. `isNotepadRoute()` matches `/notepad/notes*` and `/notepad/u/*` only (`src/notepad/theme/theme-types.ts`). Study lives at `/notepad/notes/study` → dark-eligible. Standalone `/login` is NOT dark-eligible; the in-app auth modal IS (it renders under a notepad route). CSS vars flip under `.dark` in `src/index.css` (`:root` ~line 75, `.dark` ~line 163).
- **Two distinct Lamplight chats** — do not confuse:
  - Study Chat tab → `src/notepad/study/panes/LamplightStudyPanel.tsx` (flat list, **non-streaming**, `invoke('lamplight-study')`).
  - Bible reader chat → `src/notepad/components/lamplight/chat/LamplightChat.tsx` + `ChatMessage.tsx` (bubbles, **streaming** via `lamplight-stream-client.ts`). This is the reference implementation.
- **Streaming backend** is cleanly factored: `supabase/functions/lamplight-chat/bible-chat-stream.ts` exports `streamBibleChat(deps, args)`. `lamplight-chat/index.ts` wires deps and calls it when `accept: text/event-stream` or `body.stream === true`. `lamplight-study/index.ts` currently has NO stream branch (JSON only).

---

## Detailed changes

### 1. Study Chat redesign — "Refined flat" (option C)

**File:** `src/notepad/study/panes/LamplightStudyPanel.tsx` (message map at lines 79–84).

Replace the role-label + content rows with:
- **User** (`m.role === 'user'`): right-aligned block. Small uppercase label "You" (muted, `var(--silica)`, letter-spacing, `text-align:right`), content right-aligned below, `color: var(--deep-umber)`, `whiteSpace: 'pre-wrap'`.
- **Lamplight** (assistant): left-aligned block with a **2px left accent bar** in `var(--lamplight-accent)` (indigo `#43508C` in Study via `[data-mode='study']`) + left padding. Uppercase label "Lamplight"; content below.
- Increase inter-turn spacing (gap) for readability.
- Keep the existing empty-state, notes-offer block, and error rendering as-is.

Style approach: inline `style={{}}` objects + CSS vars (match the file's existing convention; font `Outfit, sans-serif`). No bubbles.

### 2. Live streaming

**Backend — `supabase/functions/lamplight-study/index.ts`:**
- Parse `stream` in the body and compute `wantsStream = req.headers.get('accept')?.includes('text/event-stream') || body.stream === true`. (Mirror `lamplight-chat/index.ts:52,55`. May require adding `stream?: boolean` to `parse-body.ts` / `ParsedStudyBody`, or reading it off the raw body before parse.)
- Add a `wantsStream` branch (mirror `lamplight-chat/index.ts:109-163`) that builds a `BibleChatStreamDeps` using the **study** wiring:
  - `isOptedIn`, `hasChatAccess`, `checkQuota`, `recordUsage` — same as buffered path (study uses `quotaCfg.study`, `artifactKind: 'bible_study'`).
  - `upsertThread` → study thread upsert (`surface: 'study'`, the existing `upsertStudyThread`).
  - `loadHistory`, `persistUserMessage`, `persistAssistant` → study `lamplight_chat_messages` rows.
  - `buildContext` → call `buildStudyContext(...)` (note: returns `{ ctx, offered }`; capture `offered` in a closure — see offered-notes note below).
  - `prompt: mode === 'insight' ? STUDY_INSIGHT_PROMPT : STUDY_CHAT_PROMPT`.
  - Call `streamBibleChat(deps, { userId, mode, message, threadTitle, signal: req.signal })`.
- **Offered-notes preservation (small, backward-compatible extension to the shared streaming module):** extend `BibleChatStreamDeps` with an optional `extraDoneFields?: () => Record<string, unknown>`; in `streamBibleChat`, when emitting the `done` event, spread `...(deps.extraDoneFields?.() ?? {})` into the payload. Study supplies `extraDoneFields: () => ({ offered_notes: capturedOffered })`. Bible chat omits it → its behavior is unchanged. (File: `bible-chat-stream.ts` line ~111.) Add a unit test for the spread.

**Frontend — new `src/notepad/study/study-stream-client.ts` (mirror `src/notepad/bible/lamplight-stream-client.ts`):**
- `streamStudyMessage(args, handlers)` that POSTs to `${SUPABASE_URL}/functions/v1/lamplight-study` with `accept: text/event-stream`, `Authorization: Bearer <session token>`, body `{ book, chapter, message, includeNotes, noteIds, translation, stream: true }`.
- Parse SSE `data:` lines into events: `stage`, `text` (`field`,`delta`), `piece` (`field`,`value`), `refining`, `done` (`payload` incl. `offered_notes`), `error`.

**Frontend — `LamplightStudyPanel.tsx`:**
- In `doSend`, after appending the user message, append an empty assistant placeholder and update its `content` live from `text` deltas (the redesigned Lamplight row shows the blinking caret while streaming).
- On `done`: finalize content + citations, call `notes.setOffered(payload.offered_notes ?? [])`.
- On `error` or any thrown/stream failure: **fall back** to the existing buffered `sendStudyMessage(invoke, ...)` path so behavior degrades gracefully.

**Deploy (manual, not CI):** `supabase functions deploy lamplight-study --use-api`.

### 3. Dark-mode input fix

**File:** `src/notepad/study/panes/LamplightStudyPanel.tsx` input style (lines 107–115).

Match the Bible chat input (`LamplightChat.tsx:369`): add to the input's inline style:
```
background: 'var(--surface-elevated)',
border: '1px solid var(--pale-stone)',
color: 'var(--deep-umber)',
```
Keep the disabled-state treatment. Field + text now both follow the theme (visible in light and dark). This resolves the "typed text invisible in dark mode" report.

### 4. Auth modal logo light in dark mode

**File:** `src/auth/AuthCard.tsx` line 142.

Add the existing `notepad-nav-logo` class to the logo `<img>`:
```jsx
<img src="/logo-icon.png" alt="LivePsalms" className="notepad-nav-logo h-10 w-auto mb-3" />
```
The established rule `.dark .notepad-nav-logo { filter: brightness(0) invert(1); }` (`src/index.css:233`) lightens it in dark mode. The in-app auth modal renders under a dark-eligible notepad route → `.dark` present → logo lightens. Standalone `/login` is never dark → no visual change there.

### 5. Navigation swap

**Files:** `src/components/sections/notepad/mobile/MobileTabBar.tsx`, `MobileNotepadWorkspace.tsx`, `MobileNotesView.tsx`, `MobileEditorView.tsx`, `types.ts`, and `MobileMoreSheet.tsx`.

**Bottom bar (`MobileTabBar.tsx`):**
- Replace the `lamplight` tab def with `bible`: `{ id: 'bible', label: 'Bible', Icon: BookOpen }`. Final order: Notes · Editor · Bible · More.
- The flame `accent`/gold/connection-dot logic in the tab bar is removed (moves to the header). Bible tab uses the standard selected/unselected treatment.

**Types (`types.ts`):** `MobileTab = 'notes' | 'editor' | 'lamplight' | 'bible' | 'more'`. Keep `'lamplight'` as a valid view state (header-triggered), add `'bible'`.

**Workspace (`MobileNotepadWorkspace.tsx`):**
- Add an `effectiveTab === 'bible'` content branch rendering the Bible reader + Lamplight-over-scripture pane (`BibleStudyPane`), passing `lamplightAdapter`, `invoke`, `streamInvoke` (the same props `MobileMoreSheet` receives today, available on `model`).
- Keep the `effectiveTab === 'lamplight'` branch (renders `LamplightMobileView`) — it's now reached via the header button, not the bottom bar.
- `handleSelectTab`: `'more'` opens the sheet; `'bible'` sets the tab; keep existing behavior otherwise.
- Add `'bible'` to the `loadEnum` allow-list (line 41) so Bible persists across refresh.
- Pass `onOpenLamplight={() => setTab('lamplight')}` and `lamplightHasConnections={hasConnections}` down to `MobileNotesView` and `MobileEditorView`.

**Top headers (`MobileNotesView.tsx` header ~lines 34–68; `MobileEditorView.tsx` variant):**
- Add a Lamplight flame button to the right-side cluster, left of Search. Gold (`#b8843a`) flame icon; render the small connection dot (reuse the dot markup/treatment from the old `MobileTabBar`, gold `#b8843a`) when `lamplightHasConnections`. `onClick={onOpenLamplight}`, `aria-label="Lamplight"`.

**More sheet (`MobileMoreSheet.tsx`):** remove the now-redundant **Bible** segment from the `Segmented` control (Backlinks / Info / Graph remain), since Bible is now a first-class tab. (Minor; verify nothing else depends on that segment.)

---

## Testing & verification

- **Pre-existing red baseline:** the repo ships with ~114 lint errors, 4 tsc errors (`force-sphere.test.ts`), and 2 failing test files (`Editor.toolbar-placement`, `garden-scene`) unrelated to this work. **Verify these changes add ZERO new errors** rather than gating on a green repo.
- Typecheck with `tsc -b` (the real build command), NOT bare `tsc --noEmit`.
- Add/adjust unit tests:
  - `streamBibleChat` `extraDoneFields` spread into the `done` payload (and Bible chat unchanged when omitted).
  - Study streaming client SSE parsing (mirror existing `lamplight-stream-client` tests if present).
  - `MobileTabBar` renders Bible (not Lamplight); header renders the Lamplight button + dot.
- Manual smoke (mobile viewport, dark mode):
  - Study Chat: send a message → response streams in with caret; refined-flat layout; typed text visible in the input.
  - Notepad bottom bar shows Bible; tapping opens the Bible reader+chat; Lamplight opens from the top-header flame (dot when connections exist).
  - Auth modal logo is light in dark mode.

## Risks / constraints

- **Manual edge-function deploy** for `lamplight-study` is required and is NOT carried by a frontend/Vercel deploy.
- Streaming touches a **shared** module (`bible-chat-stream.ts`); the extension must stay backward-compatible for Bible chat.
- Offered-notes-in-stream depends on the `extraDoneFields` extension landing; without it, streamed turns would silently drop the notes offer.
