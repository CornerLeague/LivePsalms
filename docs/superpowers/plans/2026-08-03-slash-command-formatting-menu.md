# Unified `/` Command Launcher Implementation Plan

> **Status: IMPLEMENTED (2026-08-03).** All 7 tasks shipped on branch `feat/note-creation-folder-graph`. New module: `src/notepad/extensions/slash-menu/` (registry, matcher, extension, renderer, list, `+` plugin, CSS) + wiring in `src/notepad/editor/use-note-editor.ts`. 45 new tests across 6 files, all green; full suite 3321 passing, 0 regressions; `tsc -b` + eslint clean on new files. Verified in-browser (desktop popover + mobile bottom sheet): open, filter, apply (heading/quote/list), style stored-mark, scripture handoff to the shipped book picker, empty-line `+`, and theme-aware dark (graphite) rendering. Note: the menu is theme-variable-driven (adapts to all 10 `data-theme` palettes); the older `/verse` dropdown still uses dead `.dark` selectors and stays light in graphite — flagged as a separate follow-up.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Notion/circle.so-style `/` slash launcher to the notepad editor — one menu that inserts/applies block formatting, inline marks, the hand-drawn Notes Styles, and scripture — so writing-heavy users format in flow without reaching for the toolbar.

**Architecture:** A **new `SlashMenu` TipTap Extension** (not a Node) registers a single `@tiptap/suggestion` plugin on `char: '/'`. Its items come from a pure, unit-tested **command registry** (`slash-commands.ts`) filtered by the typed query. Selecting a command runs an `action(editor, range)`. Non-scripture commands run directly (block toggles, `setMark`, `setStyleHighlight`). The two scripture entries **bridge** to the existing shipped pickers by writing their trigger text (`/verse ` / `/lookup `) and letting `ScriptureRef`'s current matchers take over — so the rich book-typeahead + FTS/semantic search is reused verbatim, not rebuilt. On mobile, a `+` affordance on empty paragraphs opens the same menu (same registry, same list component) presented as a bottom sheet.

**Tech Stack:** TypeScript, React 19, TipTap 3 (`@tiptap/core`, `@tiptap/suggestion`, `@tiptap/react`, `@tiptap/pm`), Vitest (+ jsdom for editor tests).

## Design decisions (from brainstorm — 2026-08-03)

1. **One unified menu.** A bare `/` opens a single launcher listing everything. Chosen over keeping formatting and scripture on separate triggers.
2. **Full scope:** text formatting + Notes Styles + scripture, all in one menu.
3. **Reuse, don't rebuild scripture.** `/verse` and `/lookup` keep their existing dedicated pickers ([scripture-ref.ts](../../../src/notepad/extensions/scripture-ref.ts)); the launcher is a front door that hands off to them. The `SlashMenu` plugin **stands down** while a scripture query is active, mirroring the existing `allow`-gate pattern between the predictive and picker plugins.
4. **Styles apply forward.** Picking a Notes Style with no selection sets a **stored mark** (`styleHighlight`) so the next typed text is styled; with a selection, it applies to the selection. `StyleHighlight` is a Mark ([style-highlight.ts:59](../../../src/notepad/extensions/style-highlight.ts)), so this is native.
5. **Mobile-forward.** A `+` button on empty lines opens the same menu (bottom-sheet presentation), not just a tappable desktop popover.
6. **Out of scope:** the free-floating placed decorations (drag/flip/duplicate images, [DecorationToolbar.tsx](../../../src/notepad/decorations/DecorationToolbar.tsx)) — those are placement-based, not insert-at-cursor, and stay on their current flow.

## Global Constraints

- Typecheck with `npx tsc -b` (NOT bare `tsc --noEmit` — root tsconfig has `files:[]`).
- Keep these green: `scripture-ref.suggestion.test.ts`, `scripture-ref.editor.test.ts`, `style-highlight.editor.test.ts`, and the `Editor.*.test.tsx` suite.
- **Do NOT modify** the shipped scripture pickers' behavior. `SlashMenu` coordinates *around* them via `allow`/matcher gating; `matchVersePickerBeforeCursor` and `matchLookupPickerBeforeCursor` stay untouched.
- **Do NOT re-create the editor per keystroke** — `SlashMenu` is added to the existing `extensions` array in [use-note-editor.ts](../../../src/notepad/editor/use-note-editor.ts) once, like the others.
- Bare `/` today does nothing; only literal `/verse`/`/lookup` trigger. That is the seam we extend.
- The launcher fires at **start of a block OR after whitespace** — same anchoring as the scripture matchers (`(?:^|\s)`), so it never fires mid-word.
- Reuse the existing renderer pattern ([verse-suggest-renderer.tsx](../../../src/notepad/extensions/verse-suggest-renderer.tsx)) for popup lifecycle; do not hand-roll a new positioning layer.
- Match the warm editor aesthetic (Outfit font; `--deep-umber`, `--warm-sand`, `--plaster`, `--pale-stone`, `--silica`) and support dark mode (the app uses `next-themes`).
- No deploy/push — branch work stays local until the user asks.
- Run a single Vitest file with `npx vitest run <path>`.

---

### Task 1: The command registry (pure, framework-free)

The heart of the launcher: a list of commands with metadata + a pure filter. No TipTap, no React — trivially unit-testable.

**Files:**
- Create: `src/notepad/extensions/slash-menu/slash-commands.ts`
- Test: `src/notepad/extensions/slash-menu/slash-commands.test.ts`

**Interfaces:**
```ts
export type SlashGroup = 'basic' | 'style' | 'scripture';

export interface SlashCommand {
  id: string;                 // stable, e.g. 'heading-1'
  title: string;              // 'Heading 1'
  hint: string;               // 'Large section title'
  group: SlashGroup;
  icon: string;               // lucide icon name (mapped in the list component)
  keywords: string[];         // extra match terms: ['h1','title','#']
  run: (ctx: SlashRunContext) => void;   // filled by Task 3–5; registry holds refs
}

export interface SlashRunContext {
  editor: Editor;
  range: { from: number; to: number };   // the "/query" span to delete
}

// Pure filter: query is the text AFTER the "/". Empty query → all, in group order.
export function filterSlashCommands(all: SlashCommand[], query: string): SlashCommand[];
```

- [ ] **Step 1: Write the failing test** — cover: empty query returns all in `basic → style → scripture` order; `'h1'` matches Heading 1 via keyword; `'quote'` matches by title substring; case-insensitivity; whitespace-only query treated as empty; a query with no matches returns `[]`; ranking puts title-prefix hits above keyword-only hits.
- [ ] **Step 2:** Implement `filterSlashCommands` (lowercase-normalize, match title/keywords, stable group-then-prefix ordering). Define the command list with placeholder `run: () => {}` (wired in later tasks).
- [ ] **Step 3:** `npx vitest run src/notepad/extensions/slash-menu/slash-commands.test.ts` green; `npx tsc -b` clean.

**Command set (v1):**
- `basic`: Heading 1/2/3, Bullet list, Numbered list, Quote, Divider (horizontal rule), and marks Bold / Italic / Underline.
- `style`: Highlight (default swatch), and "More styles…" (opens the existing swatch picker). Keep the inline style entries few — do not list every swatch.
- `scripture`: Insert verse (bridges to `/verse`), Look up verse (bridges to `/lookup`).

---

### Task 2: The matcher — when does `/` open the launcher?

A pure text matcher mirroring `matchVersePickerBeforeCursor`, but it must **stand down** for scripture queries so the existing pickers win.

**Files:**
- Create: `src/notepad/extensions/slash-menu/slash-menu-matchers.ts`
- Test: `src/notepad/extensions/slash-menu/slash-menu-matchers.test.ts`

**Interface:** `matchSlashBeforeCursor(textBeforeCursor: string): { from: number; to: number; query: string } | null`

- [ ] **Step 1: Failing test** — fires on `'/'` at start; fires on `'notes /'` (after whitespace); `query` is the run after `/`; returns `null` for `'word/'` (no boundary, mid-word); returns `null` when the run starts with `verse`/`lookup` (case-insensitive) so `/verse …` and `/lookup …` are ceded to `ScriptureRef`; allows spaces in the query (e.g. `/bul` then more) but ends at the cursor.
- [ ] **Step 2:** Implement with `/(?:^|\s)\/([^/]*)$/`, then `null` out when `/^(verse|lookup)\b/i.test(query)`.
- [ ] **Step 3:** Green + `tsc -b` clean.

> Rationale: this keyword gate is the coordination seam. Combined with the plugin ordering in Task 3, typing `/verse` routes to the shipped picker while every other `/…` routes to the launcher — one mental model, zero rebuild.

---

### Task 3: The `SlashMenu` extension + suggestion plugin (block + mark commands)

Wire the registry and matcher into a real `@tiptap/suggestion` plugin and make block/mark commands run.

**Files:**
- Create: `src/notepad/extensions/slash-menu/slash-menu.ts` (the Extension)
- Create: `src/notepad/extensions/slash-menu/slash-menu-renderer.tsx` (popup lifecycle — adapt `verse-suggest-renderer.tsx`)
- Create: `src/notepad/extensions/slash-menu/SlashMenuList.tsx` (the list UI + keyboard nav)
- Test: `src/notepad/extensions/slash-menu/slash-menu.editor.test.ts`

**Key wiring:**
```ts
export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: SLASH_MENU_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      findSuggestionMatch: ({ $position }) => {
        const before = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchSlashBeforeCursor(before);
        if (!m) return null;
        const start = $position.start();
        return { range: { from: start + m.from, to: start + m.to }, query: m.query, text: m.query };
      },
      items: ({ query }) => filterSlashCommands(SLASH_COMMANDS, query),
      command: ({ editor, range, props }) => props.run({ editor, range }),
      render: renderSlashMenu,
    })];
  },
});
```

- Block/mark `run` implementations delete the `/query` range then chain the toggle, e.g. Heading 1:
  ```ts
  run: ({ editor, range }) =>
    editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run();
  ```
- `SlashMenuList.tsx`: grouped rows (icon tile + title + hint), `↑/↓` move, `Enter` apply, `Esc` close, mouse hover/click. Must expose the `onKeyDown` ref contract the renderer forwards (same shape `VerseSuggestList` uses).

- [ ] **Step 1: Failing editor test** (jsdom + TipTap) — typing `/` then `h1` and pressing Enter turns the line into an H1; `/quote`→blockquote; `/bul`→bullet list; typing `/` then `xyzzy` (no match) shows empty state and Enter is a no-op; `Esc` dismisses and leaves the literal text intact then removed. Assert the `/query` text is deleted (no stray `/h1` left in the doc).
- [ ] **Step 2:** Implement extension + renderer + list; register `SlashMenu` in [use-note-editor.ts](../../../src/notepad/editor/use-note-editor.ts) `extensions` array (after `StyleHighlight`).
- [ ] **Step 3:** Green; `tsc -b` clean; existing `scripture-ref.*` suites still green (proves no `/` collision regressions).

---

### Task 4: Notes Styles commands — stored-mark-forward

Make the `style` group apply the `styleHighlight` mark with the agreed semantics.

**Files:** Modify `slash-commands.ts`; Test: `src/notepad/extensions/slash-menu/slash-menu.style.editor.test.ts`

- Highlight `run`:
  ```ts
  run: ({ editor, range }) => {
    const chain = editor.chain().focus().deleteRange(range);
    // setMark on a collapsed selection updates stored marks → next typed text is styled.
    chain.setMark('styleHighlight', { swatchId: defaultSwatchId }).run();
  }
  ```
  Pull `defaultSwatchId` the same way the editor does today: `filterAssets(STYLE_ASSETS, 'highlight', '')[0]?.id`.
- "More styles…" `run`: delete the range, then open the existing swatch picker UI (reuse whatever the toolbar uses to pick a swatch — surface it anchored at the cursor). If that picker isn't yet extractable, this entry may set a lightweight "pending style" state the Editor reads; keep the extraction minimal.

- [ ] **Step 1: Failing test** — with a text selection, `/high`+Enter marks the selection (`editor.isActive('styleHighlight')` true over the range). With **no** selection, after `/high`+Enter, typing "grace" yields a `styleHighlight` span wrapping "grace" (assert stored-mark path). Reuse the swatch/default helpers so the test mirrors production wiring.
- [ ] **Step 2:** Implement; confirm `emitOnboardingEvent('highlight-created')` still fires (it lives in `setStyleHighlight`; if we call `setMark` directly, either call `setStyleHighlight`'s command instead or emit the event to preserve onboarding analytics).
- [ ] **Step 3:** Green; `style-highlight.editor.test.ts` still green.

> Note: prefer routing through the existing `setStyleHighlight` command (not a raw `setMark`) so `lastSwatchId` storage + the onboarding event stay consistent. Verify `setStyleHighlight` behaves as a stored mark on a collapsed selection; if not, add a collapsed-selection branch to the command.

---

### Task 5: Scripture bridge — Insert verse / Look up verse

The two scripture entries drop the user into the existing pickers.

**Files:** Modify `slash-commands.ts`; Test: extend `slash-menu.editor.test.ts`

- Insert verse `run`:
  ```ts
  run: ({ editor, range }) =>
    editor.chain().focus().deleteRange(range).insertContent('/verse ').run();
  ```
  Inserting `/verse ` at a whitespace/line boundary makes `matchVersePickerBeforeCursor` fire on the next tick → the shipped book typeahead appears. Look up verse inserts `/lookup ` identically.

- [ ] **Step 1: Failing test** — `/ins`+Enter (Insert verse) leaves the document with `/verse ` and the `scriptureRefPicker` suggestion state active (or at minimum the literal trigger present at cursor). `/look`+Enter → `/lookup ` present. Assert the `SlashMenu` state has closed (no double dropdown).
- [ ] **Step 2:** Implement; confirm the `SlashMenu` matcher's `verse|lookup` stand-down (Task 2) prevents the launcher from re-opening on the freshly inserted `/verse`.
- [ ] **Step 3:** Green; manual check in-browser that selecting Insert verse shows the real book picker and resolves a reference end-to-end.

---

### Task 6: Mobile `+` trigger + bottom-sheet presentation

Mobile-forward: an on-line `+` opens the same menu; the renderer presents a bottom sheet on small screens.

**Files:**
- Create: `src/notepad/extensions/slash-menu/EmptyLinePlus.tsx` (or a ProseMirror decoration in `slash-menu.ts`)
- Modify: `slash-menu-renderer.tsx` (responsive presentation)
- Test: `src/notepad/extensions/slash-menu/slash-menu.mobile.test.tsx`

- The `+` appears on **empty** top-level paragraphs (ProseMirror decoration keyed on empty textblocks), styled to the warm palette, `aria-label="Insert (formatting, styles, scripture)"`.
- Tapping `+` inserts `/` at the cursor programmatically → the existing suggestion flow opens the menu (one code path, no parallel opener).
- The renderer branches on a mobile breakpoint (match how the editor detects mobile elsewhere — reuse the existing hook/util rather than a new `matchMedia`): desktop = floating popover near the cursor; mobile = bottom sheet with larger tap targets.

- [ ] **Step 1: Failing test** — empty paragraph renders the `+` affordance; non-empty paragraph does not; activating `+` opens the menu (suggestion state active). Mobile viewport → list container carries the bottom-sheet class/role.
- [ ] **Step 2:** Implement decoration + responsive renderer.
- [ ] **Step 3:** Green; verify on a mobile viewport in the browser preview that the sheet is reachable and tappable, and that it doesn't fight the mobile editor toolbar.

---

### Task 7: Discoverability + polish

- [ ] Update the empty-editor placeholder to hint the launcher, e.g. `Placeholder.configure({ placeholder: "Start writing, or press / for commands" })` in [use-note-editor.ts](../../../src/notepad/editor/use-note-editor.ts) — keep the mobile copy sensible (mention `+`).
- [ ] Consider one onboarding-tour beat pointing at `/` (the app has a tour system, `data-tour="…"`); wire only if cheap.
- [ ] Dark-mode pass on the menu + `+` affordance.
- [ ] `npx tsc -b` clean, `npx vitest run` whole suite green, `npx eslint .` clean on new files.

---

## Self-Review

- **Does it honor "one unified menu"?** Yes — a single `/` launcher lists basic/style/scripture; the `+` opens the same list. Scripture reuses shipped pickers via a text-bridge, so it's one door without a rewrite.
- **Biggest risk:** `/` collision between `SlashMenu` and the two `ScriptureRef` pickers. Mitigated by (a) the matcher's `verse|lookup` stand-down and (b) plugin registration order. Task 3's acceptance explicitly re-runs the scripture suites.
- **Second risk:** stored-mark semantics for `styleHighlight` on a collapsed selection. Task 4 tests it directly and falls back to a collapsed-selection branch in `setStyleHighlight` if TipTap doesn't store the mark as hoped.
- **Mobile:** chosen "mobile-forward" — the `+` reuses the exact same registry + list, so desktop and mobile can't drift.
- **Out of scope (intentional):** free-floating placed decorations; multi-swatch inline pickers beyond a default + "More styles…".
- **Reversibility:** entirely additive — a new extension + files; removing `SlashMenu` from the `extensions` array fully disables it with zero effect on existing behavior.
