# Global Bible Version + Persistent Verse Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bible version and verse-layout single, app-wide, per-user-persistent preferences — controlled from both the reader toolbar and Profile settings — so the reader, notepad Scripture refs, and all Lamplight AI output follow one selected version, and re-flow live when it changes.

**Architecture:** Promote the existing `useBibleTranslation` / `useBibleVerseLayout` hooks into a single shared `BiblePrefsProvider` (mirroring `ThemeProvider`), mounted once under `AuthProvider`. Every consumer reads `useBiblePrefs()`. Profile gains a "Bible & Reading" section. Embedded Scripture refs re-resolve their *displayed* text for the active version at render time (stored node attrs stay as the as-captured snapshot). `lamplight-study` becomes version-aware by copying `lamplight-generate`'s body→profile resolution.

**Tech Stack:** React 18 + TypeScript, TipTap (ProseMirror), Supabase (Postgres + Deno edge functions), Vitest + React Testing Library.

## Global Constraints

- **No new migration.** Columns `profiles.bible_translation` (CHECK `in ('BSB','KJV','WEB')`, default `'BSB'`) and `profiles.bible_verse_layout` (CHECK `in ('inline','lines','spaced')`, default `'inline'`) already exist (migrations 037/038/040).
- **Single provider instance.** `useBibleTranslation(` / `useBibleVerseLayout(` must be called ONLY inside `BiblePrefsProvider` (and their own tests). No other call sites may remain.
- **Do not rewrite stored note content** on version change. Re-flow is display-time only (local component state), never `updateAttributes` on an already-captured node.
- **Pre-existing red baseline:** repo ships ~114 lint errors, 4 tsc errors (`force-sphere.test.ts`), and 2 failing test files (`Editor.toolbar-placement`, `garden-scene`) unrelated to this work. Verify **zero new** errors; do not gate on a green repo-wide baseline.
- **Build/type check is `tsc -b`** (the real build), NOT bare `tsc --noEmit` (root tsconfig has `files: []`).
- **Edge functions deploy manually**, not in CI: `supabase functions deploy <name> --use-api`.
- Branch: `feat/bible-version-global-prefs` (already created off `origin/main`).

---

### Task 1: `BiblePrefsContext` + `BiblePrefsProvider`

**Files:**
- Create: `src/notepad/bible/prefs/bible-prefs-context.ts`
- Create: `src/notepad/bible/prefs/BiblePrefsProvider.tsx`
- Test: `src/notepad/bible/prefs/BiblePrefsProvider.test.tsx`

**Interfaces:**
- Consumes: `useBibleTranslation({ userId })` → `{ translation, setTranslation }`; `useBibleVerseLayout({ userId })` → `{ verseLayout, setVerseLayout }`; `useAuthSession()` → `{ user }`.
- Produces:
  - `BiblePrefsContext` (a `React.Context<BiblePrefsContextValue | null>`)
  - `interface BiblePrefsContextValue { translation: BibleTranslation; setTranslation: (t: BibleTranslation) => void; verseLayout: VerseLayout; setVerseLayout: (l: VerseLayout) => void; }`
  - `useBiblePrefs(): BiblePrefsContextValue` (throws outside provider)
  - `BiblePrefsProvider({ children }: { children: ReactNode }): JSX.Element`

- [ ] **Step 1: Write the context module**

Create `src/notepad/bible/prefs/bible-prefs-context.ts`:

```ts
import { createContext, useContext } from 'react';
import type { BibleTranslation } from '../translations';
import type { VerseLayout } from '../bible-layout-types';

export interface BiblePrefsContextValue {
  translation: BibleTranslation;
  setTranslation: (t: BibleTranslation) => void;
  verseLayout: VerseLayout;
  setVerseLayout: (l: VerseLayout) => void;
}

export const BiblePrefsContext = createContext<BiblePrefsContextValue | null>(null);

export function useBiblePrefs(): BiblePrefsContextValue {
  const ctx = useContext(BiblePrefsContext);
  if (!ctx) throw new Error('useBiblePrefs must be used within a BiblePrefsProvider');
  return ctx;
}
```

- [ ] **Step 2: Write the failing provider test**

Create `src/notepad/bible/prefs/BiblePrefsProvider.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BiblePrefsProvider } from './BiblePrefsProvider';
import { useBiblePrefs } from './bible-prefs-context';

// Auth session: provider sources userId from here.
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' } }),
}));
// Stub supabase so the hooks' profile read/write are inert in this unit test.
vi.mock('@/lib/supabase', () => ({ supabase: null }));

function Probe() {
  const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();
  return (
    <div>
      <span data-testid="t">{translation}</span>
      <span data-testid="l">{verseLayout}</span>
      <button onClick={() => setTranslation('KJV')}>set-kjv</button>
      <button onClick={() => setVerseLayout('spaced')}>set-spaced</button>
    </div>
  );
}

describe('BiblePrefsProvider', () => {
  it('provides defaults and propagates setters', () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    expect(screen.getByTestId('t').textContent).toBe('BSB');
    expect(screen.getByTestId('l').textContent).toBe('inline');
    fireEvent.click(screen.getByText('set-kjv'));
    fireEvent.click(screen.getByText('set-spaced'));
    expect(screen.getByTestId('t').textContent).toBe('KJV');
    expect(screen.getByTestId('l').textContent).toBe('spaced');
  });

  it('useBiblePrefs throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/BiblePrefsProvider/);
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/notepad/bible/prefs/BiblePrefsProvider.test.tsx`
Expected: FAIL — `Cannot find module './BiblePrefsProvider'`.

- [ ] **Step 4: Write the provider**

Create `src/notepad/bible/prefs/BiblePrefsProvider.tsx`:

```tsx
import { useMemo, type ReactNode } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useBibleTranslation } from '../useBibleTranslation';
import { useBibleVerseLayout } from '../useBibleVerseLayout';
import { BiblePrefsContext } from './bible-prefs-context';

/**
 * Single source of truth for Bible version + verse layout. Mirrors ThemeProvider:
 * calls each preference hook ONCE with the signed-in userId, so every consumer
 * (reader toolbar, Profile settings, notepad Scripture refs, Lamplight) reads and
 * writes the same persisted value. localStorage is the instant device default;
 * profiles.bible_translation / profiles.bible_verse_layout are the durable,
 * cross-device source of truth (handled inside the hooks).
 */
export function BiblePrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { translation, setTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setVerseLayout } = useBibleVerseLayout({ userId });

  const value = useMemo(
    () => ({ translation, setTranslation, verseLayout, setVerseLayout }),
    [translation, setTranslation, verseLayout, setVerseLayout],
  );

  return <BiblePrefsContext.Provider value={value}>{children}</BiblePrefsContext.Provider>;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/notepad/bible/prefs/BiblePrefsProvider.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/bible/prefs/
git commit -m "feat(bible): BiblePrefsProvider shared version + layout state"
```

---

### Task 2: Mount provider + migrate the four consumers

Wires the provider into the app and replaces every direct hook call with `useBiblePrefs()`. This also fixes the two call sites (`StudyReader`, `Editor`) that passed no `userId` and therefore never persisted.

**Files:**
- Modify: `src/App.tsx:206-208` (mount provider)
- Modify: `src/notepad/bible/BibleStudyPane.tsx:13-14,56-57`
- Modify: `src/notepad/study/panes/StudyReader.tsx:3-4,13-14`
- Modify: `src/notepad/components/Editor.tsx:81`
- Modify: `src/notepad/components/lamplight/chat/LamplightChat.tsx:5,24`
- Test: `src/notepad/bible/prefs/single-instance.test.ts`

**Interfaces:**
- Consumes: `BiblePrefsProvider`, `useBiblePrefs` from Task 1.
- Produces: no new exports; `Editor.tsx` still passes `translation` into `useNoteEditor({ translation })` but now sourced from `useBiblePrefs()`.

- [ ] **Step 1: Write the failing single-instance guard test**

This locks the Global Constraint that the hooks are called only inside the provider. Create `src/notepad/bible/prefs/single-instance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Walk src/ and assert no file outside prefs/ or *.test.* calls the raw hooks.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('Bible prefs single-instance invariant', () => {
  it('useBibleTranslation/useBibleVerseLayout are called only inside prefs/ (and their hook files)', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      if (file.includes('/bible/prefs/')) continue;
      if (file.endsWith('useBibleTranslation.ts')) continue;
      if (file.endsWith('useBibleVerseLayout.ts')) continue;
      if (/\.test\.(ts|tsx)$/.test(file)) continue;
      const src = readFileSync(file, 'utf8');
      if (/useBibleTranslation\s*\(/.test(src) || /useBibleVerseLayout\s*\(/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/notepad/bible/prefs/single-instance.test.ts`
Expected: FAIL — offenders lists `BibleStudyPane.tsx`, `StudyReader.tsx`, `Editor.tsx`, `LamplightChat.tsx`.

- [ ] **Step 3: Mount the provider in `App.tsx`**

At `src/App.tsx`, add the import near the other notepad providers:

```tsx
import { BiblePrefsProvider } from '@/notepad/bible/prefs/BiblePrefsProvider';
```

Then wrap, just inside `ThemeProvider` (it needs `AuthProvider` for `useAuthSession`). Change:

```tsx
    <AuthProvider>
      <ThemeProvider>
      <RouteTransitionProvider value={routeTransitionValue}>
```

to:

```tsx
    <AuthProvider>
      <ThemeProvider>
      <BiblePrefsProvider>
      <RouteTransitionProvider value={routeTransitionValue}>
```

Find the matching close (the `</ThemeProvider>` that pairs with line 207) and insert `</BiblePrefsProvider>` immediately before it:

```tsx
      </RouteTransitionProvider>
      </BiblePrefsProvider>
      </ThemeProvider>
    </AuthProvider>
```

(Match the existing indentation of the sibling close tags exactly.)

- [ ] **Step 4: Migrate `BibleStudyPane.tsx`**

Remove the two hook imports (lines 13-14) and add the context hook import:

```tsx
import { useBiblePrefs } from './prefs/bible-prefs-context';
```

Replace lines 56-57:

```tsx
  const { translation, setTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setVerseLayout } = useBibleVerseLayout({ userId });
```

with:

```tsx
  const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();
```

(`userId` is still used elsewhere in the file — leave the `useAuthSession()` line.)

- [ ] **Step 5: Migrate `StudyReader.tsx`**

Replace lines 2-4:

```tsx
import { BibleReader } from '@/notepad/bible/BibleReader';
import { useBibleTranslation } from '@/notepad/bible/useBibleTranslation';
import { useBibleVerseLayout } from '@/notepad/bible/useBibleVerseLayout';
```

with:

```tsx
import { BibleReader } from '@/notepad/bible/BibleReader';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
```

Replace lines 13-14:

```tsx
  const { translation, setTranslation } = useBibleTranslation();
  const { verseLayout, setVerseLayout } = useBibleVerseLayout();
```

with:

```tsx
  const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();
```

- [ ] **Step 6: Migrate `Editor.tsx`**

Replace the import of `useBibleTranslation` with the context hook, and replace line 81:

```tsx
  const { translation } = useBibleTranslation();
```

with:

```tsx
  const { translation } = useBiblePrefs();
```

Add `import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';` and remove the now-unused `useBibleTranslation` import. (Keep the existing comment block at lines 78-81 but update its wording to "Active Bible translation from the shared BiblePrefsProvider"; the mount-time freeze note in `useNoteEditor` still applies to the editor's search deps.)

- [ ] **Step 7: Migrate `LamplightChat.tsx`**

Replace line 5:

```tsx
import { useBibleTranslation } from '@/notepad/bible/useBibleTranslation';
```

with:

```tsx
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
```

Replace line 24:

```tsx
  const { translation } = useBibleTranslation({ userId });
```

with:

```tsx
  const { translation } = useBiblePrefs();
```

- [ ] **Step 8: Run the guard test to verify it passes**

Run: `npx vitest run src/notepad/bible/prefs/single-instance.test.ts`
Expected: PASS — offenders is empty.

- [ ] **Step 9: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors (the 4 pre-existing `force-sphere.test.ts` errors may remain; nothing referencing the files above).

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/notepad/bible/BibleStudyPane.tsx src/notepad/study/panes/StudyReader.tsx src/notepad/components/Editor.tsx src/notepad/components/lamplight/chat/LamplightChat.tsx src/notepad/bible/prefs/single-instance.test.ts
git commit -m "feat(bible): unify version + layout via BiblePrefsProvider; fix dropped persistence in StudyReader/Editor"
```

---

### Task 3: "Bible & Reading" section in Profile settings

Adds the canonical home for the two preferences. Controls write through `useBiblePrefs()` setters, so they stay in sync with the reader toolbar.

**Files:**
- Create: `src/auth/settings/BibleReadingSettingsSection.tsx`
- Modify: `src/auth/ProfilePage.tsx` (render the section near `LamplightSettingsSection`, ~line 334)
- Test: `src/auth/settings/BibleReadingSettingsSection.test.tsx`

**Interfaces:**
- Consumes: `useBiblePrefs()`; `TRANSLATIONS`, `translationInfo` from `@/notepad/bible/translations`; `VERSE_LAYOUTS`, `VERSE_LAYOUT_LABEL` from `@/notepad/bible/bible-layout-types`.
- Produces: `BibleReadingSettingsSection({ sectionStyle, labelStyle }: { sectionStyle?: CSSProperties; labelStyle?: CSSProperties }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `src/auth/settings/BibleReadingSettingsSection.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BibleReadingSettingsSection } from './BibleReadingSettingsSection';
import { BiblePrefsContext } from '@/notepad/bible/prefs/bible-prefs-context';

function renderWithPrefs(value: Parameters<typeof BiblePrefsContext.Provider>[0]['value']) {
  return render(
    <BiblePrefsContext.Provider value={value}>
      <BibleReadingSettingsSection />
    </BiblePrefsContext.Provider>,
  );
}

describe('BibleReadingSettingsSection', () => {
  it('reflects current version and calls setTranslation on change', () => {
    const setTranslation = vi.fn();
    renderWithPrefs({ translation: 'BSB', setTranslation, verseLayout: 'inline', setVerseLayout: vi.fn() });
    const select = screen.getByLabelText('Bible version') as HTMLSelectElement;
    expect(select.value).toBe('BSB');
    fireEvent.change(select, { target: { value: 'KJV' } });
    expect(setTranslation).toHaveBeenCalledWith('KJV');
  });

  it('calls setVerseLayout when a layout option is chosen', () => {
    const setVerseLayout = vi.fn();
    renderWithPrefs({ translation: 'BSB', setTranslation: vi.fn(), verseLayout: 'inline', setVerseLayout });
    fireEvent.click(screen.getByRole('button', { name: /Spaced/i }));
    expect(setVerseLayout).toHaveBeenCalledWith('spaced');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/auth/settings/BibleReadingSettingsSection.test.tsx`
Expected: FAIL — `Cannot find module './BibleReadingSettingsSection'`.

- [ ] **Step 3: Write the section component**

Create `src/auth/settings/BibleReadingSettingsSection.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { TRANSLATIONS, translationInfo, type BibleTranslation } from '@/notepad/bible/translations';
import { VERSE_LAYOUTS, VERSE_LAYOUT_LABEL } from '@/notepad/bible/bible-layout-types';

export function BibleReadingSettingsSection({
  sectionStyle,
  labelStyle,
}: { sectionStyle?: CSSProperties; labelStyle?: CSSProperties } = {}) {
  const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();

  return (
    <div style={sectionStyle}>
      <p style={labelStyle}>BIBLE &amp; READING</p>

      <label
        htmlFor="settings-bible-version"
        className="block text-xs mb-1"
        style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
      >
        Bible version
      </label>
      <select
        id="settings-bible-version"
        aria-label="Bible version"
        value={translation}
        onChange={(e) => setTranslation(e.target.value as BibleTranslation)}
        className="text-xs rounded px-2 py-1 outline-none"
        style={{ color: 'var(--deep-umber)', background: 'transparent', border: '1px solid var(--pale-stone)' }}
      >
        {TRANSLATIONS.map((t) => (
          <option key={t.id} value={t.id}>{t.fullName} ({t.label})</option>
        ))}
      </select>
      <p className="text-[10px] mt-1" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
        {translationInfo(translation).attribution}
      </p>

      <p className="block text-xs mt-4 mb-1" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
        Verse layout
      </p>
      <div className="flex gap-2">
        {VERSE_LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={verseLayout === l}
            onClick={() => setVerseLayout(l)}
            className="text-[11px] rounded-full px-3 py-1"
            style={{
              fontFamily: 'Outfit, sans-serif',
              border: '1px solid var(--pale-stone)',
              background: verseLayout === l ? 'var(--deep-umber)' : 'transparent',
              color: verseLayout === l ? '#fff' : 'var(--deep-umber)',
            }}
          >
            {VERSE_LAYOUT_LABEL[l]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/auth/settings/BibleReadingSettingsSection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Render it in `ProfilePage.tsx`**

Add the import at the top of `src/auth/ProfilePage.tsx`:

```tsx
import { BibleReadingSettingsSection } from './settings/BibleReadingSettingsSection';
```

Insert the section just before the `{/* Lamplight */}` block (~line 334), passing the page's existing style objects:

```tsx
        {/* Bible & Reading */}
        <BibleReadingSettingsSection sectionStyle={sectionStyle} labelStyle={labelStyle} />

        {/* Lamplight */}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/auth/settings/BibleReadingSettingsSection.tsx src/auth/settings/BibleReadingSettingsSection.test.tsx src/auth/ProfilePage.tsx
git commit -m "feat(profile): Bible & Reading settings section (version + verse layout)"
```

---

### Task 4: Stamp inserted Scripture refs with the live active version

Fixes the hardcoded `translation: 'BSB'` in the `/verse` book-picker insert and routes all insert paths through a live active-translation value carried on `editor.storage`, so a mid-session version change applies to new inserts.

**Files:**
- Modify: `src/notepad/extensions/scripture-ref.ts` (addStorage; read storage at insert; thread translation into `applyVerseSelection`)
- Modify: `src/notepad/extensions/verse-picker-commands.ts` (accept translation; use `scriptureRefAttrsFromCandidate`)
- Modify: `src/notepad/components/Editor.tsx` (effect: write active translation into `editor.storage.scriptureRef.translation`)
- Test: `src/notepad/extensions/verse-picker-commands.test.ts`

**Interfaces:**
- Consumes: `scriptureRefAttrsFromCandidate(c, translation)`, `ScriptureRefAttrs` from `scripture-ref.ts`; `BookOrVerseItem` from `book-matcher.ts`.
- Produces:
  - `applyVerseSelection(editor, range, item, translation: BibleTranslation)` — new 4th param.
  - `ScriptureRef` node gains `addStorage(): { translation: BibleTranslation }` and reads `this.editor.storage.scriptureRef.translation` (falling back to `this.options.translation`) at insert time.

- [ ] **Step 1: Write the failing test for the insert helper**

Create `src/notepad/extensions/verse-picker-commands.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyVerseSelection } from './verse-picker-commands';
import type { BookOrVerseItem } from './book-matcher';

function fakeEditor() {
  const calls: { insertScriptureRef?: unknown } = {};
  const chain: any = {
    focus: () => chain,
    deleteRange: () => chain,
    insertContentAt: () => chain,
    insertScriptureRef: (attrs: unknown) => { calls.insertScriptureRef = attrs; return chain; },
    run: () => true,
  };
  return { editor: { chain: () => chain } as any, calls };
}

describe('applyVerseSelection', () => {
  it('stamps the ACTIVE translation (not hardcoded BSB) on a verse insert', () => {
    const { editor, calls } = fakeEditor();
    const item: BookOrVerseItem = {
      kind: 'verse',
      candidate: { osis: 'jhn.3.16', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: null, translation: 'BSB', text: 'For God so loved…' },
    } as BookOrVerseItem;
    applyVerseSelection(editor, { from: 1, to: 5 }, item, 'KJV');
    expect(calls.insertScriptureRef).toMatchObject({ osis: 'jhn.3.16', translation: 'KJV' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/notepad/extensions/verse-picker-commands.test.ts`
Expected: FAIL — `applyVerseSelection` takes 3 args / stamps `'BSB'`.

- [ ] **Step 3: Update `verse-picker-commands.ts`**

Replace the file body's verse-insert branch. New full file:

```ts
import type { Editor } from '@tiptap/core';
import type { BookOrVerseItem } from './book-matcher';
import { scriptureRefAttrsFromCandidate } from './scripture-ref';
import type { BibleTranslation } from '../bible/translations';

/**
 * Applies a /verse picker selection.
 * - A book item AUTOCOMPLETES the trigger text to "/verse <Book> ".
 * - A verse item INSERTS the scriptureRef node, stamping the ACTIVE translation
 *   (freeze-at-insert) — never a hardcoded value.
 */
export function applyVerseSelection(
  editor: Editor,
  range: { from: number; to: number },
  item: BookOrVerseItem,
  translation: BibleTranslation,
): void {
  if (item.kind === 'book') {
    editor.chain().focus().insertContentAt(range, `/verse ${item.book} `).run();
    return;
  }
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertScriptureRef(scriptureRefAttrsFromCandidate(item.candidate, translation))
    .run();
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npx vitest run src/notepad/extensions/verse-picker-commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Add storage + live-translation read in `scripture-ref.ts`**

Add `addStorage` to the node (after `addOptions`, before `addAttributes`):

```ts
  addStorage() {
    return { translation: this.options.translation as BibleTranslation };
  },
```

In `addProseMirrorPlugins`, replace the frozen capture:

```ts
    const translation = this.options.translation;
```

with a live getter that prefers storage (updated by the editor host), falling back to the mount option:

```ts
    const editorRef = this.editor;
    const storage = this.storage as { translation: BibleTranslation };
    const activeTranslation = (): BibleTranslation => storage.translation ?? this.options.translation;
```

Update `insertFromCandidate` to call `activeTranslation()`:

```ts
        .insertScriptureRef(scriptureRefAttrsFromCandidate(c, activeTranslation()))
```

Update the picker (C) command to pass the active translation into `applyVerseSelection`:

```ts
    const verseCommand = ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: BookOrVerseItem }) =>
      applyVerseSelection(editor, range, props, activeTranslation());
```

(`editorRef` is unused if the storage object is reachable via `this.storage`; if `this.storage` is not in scope inside the plugin closures, capture it as shown via `const storage = this.storage` at the top of `addProseMirrorPlugins`. Keep `activeTranslation` defined before `insertFromCandidate`.)

- [ ] **Step 6: Bridge the live value from React in `Editor.tsx`**

In `src/notepad/components/Editor.tsx`, after `const { editor } = useNoteEditor(...)` (line 84), add an effect that pushes the active translation into editor storage whenever it changes:

```tsx
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.scriptureRef as { translation: typeof translation } | undefined;
    if (storage) storage.translation = translation;
  }, [editor, translation]);
```

Ensure `useEffect` is imported in `Editor.tsx` (it already imports React hooks; add `useEffect` to the import if absent).

- [ ] **Step 7: Run the broader scripture-ref test suite + typecheck**

Run: `npx vitest run src/notepad/extensions/` and `npx tsc -b`
Expected: existing scripture-ref tests pass; no new type errors. (If a pre-existing test asserted the `/verse` insert stamped `'BSB'`, update it to assert the active translation — this is a correctness fix, note it in the commit.)

- [ ] **Step 8: Commit**

```bash
git add src/notepad/extensions/scripture-ref.ts src/notepad/extensions/verse-picker-commands.ts src/notepad/extensions/verse-picker-commands.test.ts src/notepad/components/Editor.tsx
git commit -m "fix(scripture-ref): stamp active Bible version on insert via editor storage bridge"
```

---

### Task 5: Live re-flow of embedded Scripture refs

When the active version changes, every rendered `ScriptureRef` card re-resolves its *displayed* text for that version (local state only). Stored attrs remain the as-captured snapshot and the offline fallback.

**Files:**
- Modify: `src/notepad/bible/verse-search-client.ts:87` (let a per-call translation override the baked default)
- Modify: `src/notepad/extensions/ScriptureRefView.tsx` (card reads `activeTranslation`; NodeView supplies it from `BiblePrefsContext`)
- Test: `src/notepad/extensions/ScriptureRefView.test.tsx`

**Interfaces:**
- Consumes: `BiblePrefsContext` from Task 1; `fetchVerseText` deps from `ScriptureRefOptions.search`.
- Produces:
  - `FetchVerseText` opts gain `translation?: BibleTranslation`.
  - `ScriptureRefCard` props gain `activeTranslation: BibleTranslation`.

- [ ] **Step 1: Make the deps' `fetchVerseText` honor a per-call translation**

In `src/notepad/bible/verse-search-client.ts`, change line 87 from:

```ts
    fetchVerseText: (ref, o) => fetchVerseText(ref, { ...o, translation }),
```

to (caller-supplied translation wins; baked translation is the default):

```ts
    fetchVerseText: (ref, o) => fetchVerseText(ref, { translation, ...o }),
```

- [ ] **Step 2: Write the failing card test**

Create `src/notepad/extensions/ScriptureRefView.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ScriptureRefCard } from './ScriptureRefView';
import type { ScriptureRefAttrs } from './scripture-ref';

const attrs: ScriptureRefAttrs = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  translation: 'BSB', text: 'For God so loved the world (BSB)',
};

describe('ScriptureRefCard live re-flow', () => {
  it('re-resolves displayed text when the active version differs from the captured one', async () => {
    const fetchVerseText = vi.fn(async (_ref: string, opts?: { translation?: string }) =>
      ({ text: `KJV text (${opts?.translation})`, translation: opts?.translation ?? 'BSB', reference: 'John 3:16' }));
    render(
      <ScriptureRefCard
        attrs={attrs}
        online={true}
        activeTranslation="KJV"
        updateText={vi.fn()}
        fetchVerseText={fetchVerseText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /John 3:16/ }));   // expand
    await waitFor(() => expect(screen.getByText(/KJV text \(KJV\)/)).toBeTruthy());
    expect(fetchVerseText).toHaveBeenCalledWith('John 3:16', expect.objectContaining({ translation: 'KJV' }));
  });

  it('shows the captured snapshot (no fetch) when active version equals the captured one', async () => {
    const fetchVerseText = vi.fn();
    render(
      <ScriptureRefCard
        attrs={attrs}
        online={true}
        activeTranslation="BSB"
        updateText={vi.fn()}
        fetchVerseText={fetchVerseText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /John 3:16/ }));
    expect(screen.getByText('For God so loved the world (BSB)')).toBeTruthy();
    expect(fetchVerseText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/notepad/extensions/ScriptureRefView.test.tsx`
Expected: FAIL — `ScriptureRefCard` has no `activeTranslation` prop / does not re-resolve.

- [ ] **Step 4: Rewrite `ScriptureRefView.tsx`**

Replace the file with the version below. Key changes: `FetchVerseText` opts include `translation`; the card holds local `display` state seeded from attrs; an effect re-resolves when `activeTranslation` differs (local-only, no `updateAttributes`); the empty-attrs case still fills via `updateText` for the captured version; the NodeView reads the active version from `BiblePrefsContext` (falling back to `options.translation`).

```tsx
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { ScriptureRefAttrs, ScriptureRefOptions } from './scripture-ref';
import type { BibleTranslation } from '../bible/translations';
import { BiblePrefsContext } from '../bible/prefs/bible-prefs-context';
import './scripture-ref.css';

type FetchVerseText = (
  ref: string,
  opts?: { signal?: AbortSignal; translation?: BibleTranslation },
) => Promise<{ text: string; translation: string; reference: string } | null>;

export interface ScriptureRefCardProps {
  attrs: ScriptureRefAttrs;
  online: boolean;
  activeTranslation: BibleTranslation;
  updateText: (text: string) => void;
  fetchVerseText: FetchVerseText;
}

function refLabel(a: ScriptureRefAttrs): string {
  const range = a.verseEnd ? `${a.verseStart}–${a.verseEnd}` : `${a.verseStart}`;
  return `${a.book} ${a.chapter}:${range}`;
}

// Presentational + behavior, independent of Tiptap for unit testing.
export function ScriptureRefCard({ attrs, online, activeTranslation, updateText, fetchVerseText }: ScriptureRefCardProps) {
  const [collapsed, setCollapsed] = useState(true);
  const verseId = useId();
  // Display state: starts as the captured snapshot; re-flows for the active version.
  const [display, setDisplay] = useState<{ text: string; translation: string }>(
    { text: attrs.text, translation: attrs.translation },
  );
  const filledRef = useRef(false);

  useEffect(() => {
    if (!online) {
      // Offline: fall back to the captured snapshot.
      setDisplay({ text: attrs.text, translation: attrs.translation });
      return;
    }
    const ctrl = new AbortController();

    if (activeTranslation === attrs.translation) {
      // Active version matches the capture. Use the snapshot; lazily fill if empty
      // (legacy/predictive inserts) and persist that fill back to the node once.
      if (attrs.text.trim().length > 0) {
        setDisplay({ text: attrs.text, translation: attrs.translation });
      } else if (!filledRef.current) {
        filledRef.current = true;
        fetchVerseText(refLabel(attrs), { signal: ctrl.signal, translation: activeTranslation })
          .then((r) => { if (r?.text) { updateText(r.text); setDisplay({ text: r.text, translation: r.translation }); } })
          .catch(() => { /* offline/abort — retries on remount */ });
      }
    } else {
      // Active version differs from the capture: re-resolve for DISPLAY only — never
      // write back to node attrs (preserves stored snapshot + undo history).
      fetchVerseText(refLabel(attrs), { signal: ctrl.signal, translation: activeTranslation })
        .then((r) => { if (r?.text) setDisplay({ text: r.text, translation: r.translation }); })
        .catch(() => { setDisplay({ text: attrs.text, translation: attrs.translation }); });
    }
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.osis, attrs.text, attrs.translation, activeTranslation, online]);

  return (
    <span className={`scripture-ref-inline${collapsed ? '' : ' is-expanded'}`}>
      <button
        type="button"
        className="scripture-ref-link"
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : verseId}
        onClick={() => setCollapsed((c) => !c)}
      >
        {'📖 '}{refLabel(attrs)}
      </button>
      {!collapsed && (
        <span id={verseId} className="scripture-ref-verse">
          <span className="scripture-ref-verse__text">{display.text || refLabel(attrs)}</span>
          <span className="scripture-ref-verse__meta">{refLabel(attrs)}{' · '}{display.translation}</span>
        </span>
      )}
    </span>
  );
}

// Tiptap NodeView wrapper: bridges node attrs + options + active version to the card.
export function ScriptureRefNodeView(props: NodeViewProps) {
  const attrs = props.node.attrs as ScriptureRefAttrs;
  const options = props.extension.options as ScriptureRefOptions;
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const fetchVerseText: FetchVerseText =
    options.search?.fetchVerseText ?? (async () => null);
  // Reactive active version. Outside a provider (tests / read-only render) fall back
  // to the mount-frozen option so behavior is unchanged.
  const prefs = useContext(BiblePrefsContext);
  const activeTranslation = prefs?.translation ?? options.translation;

  return (
    <NodeViewWrapper as="span" className="scripture-ref">
      <ScriptureRefCard
        attrs={attrs}
        online={online}
        activeTranslation={activeTranslation}
        fetchVerseText={fetchVerseText}
        updateText={(text) => props.updateAttributes({ text })}
      />
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 5: Run the card test to verify it passes**

Run: `npx vitest run src/notepad/extensions/ScriptureRefView.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + full extension suite**

Run: `npx tsc -b` and `npx vitest run src/notepad/extensions/`
Expected: no new type errors; extension tests green (update any test that constructed `ScriptureRefCard` without `activeTranslation` to pass `attrs.translation`).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/bible/verse-search-client.ts src/notepad/extensions/ScriptureRefView.tsx src/notepad/extensions/ScriptureRefView.test.tsx
git commit -m "feat(scripture-ref): live re-flow of embedded verses to the active version (display-time)"
```

---

### Task 6: Make `lamplight-study` version-aware

The study AI must ground in the user's selected version. Resolve the translation (request body → `profiles.bible_translation` → `'BSB'`), thread it into `buildStudyContext`, and filter `bible_passages` reads by it. The client passes the active version in the body.

**Files:**
- Modify: `supabase/functions/lamplight-study/parse-body.ts` (accept `translation`)
- Modify: `supabase/functions/lamplight-study/index.ts` (resolve translation; pass to context)
- Modify: `supabase/functions/lamplight-study/study-context.ts` (filter passages by translation)
- Modify: `src/notepad/study/study-chat-client.ts` (send `translation`)
- Modify: `src/notepad/study/panes/LamplightStudyPanel.tsx` (source `translation` from `useBiblePrefs()`)
- Test: `src/notepad/study/study-chat-client.test.ts`

**Interfaces:**
- Consumes: `useBiblePrefs().translation`; the `lamplight-generate` resolution pattern (`index.ts:100-119`).
- Produces:
  - `SendStudyArgs` / `RequestStudyInsightArgs` gain `translation?: BibleTranslation`; both `invoke` bodies include `translation`.
  - `buildStudyContext(..., { translation })` — new field on its args object.
  - `parseStudyBody` returns a validated `translation: 'BSB' | 'KJV' | 'WEB' | undefined`.

- [ ] **Step 1: Write the failing client test**

Create `src/notepad/study/study-chat-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { sendStudyMessage, requestStudyInsight } from './study-chat-client';

function captureInvoke() {
  const bodies: any[] = [];
  const invoke = vi.fn(async (_fn: string, opts: { body: any }) => {
    bodies.push(opts.body);
    return { data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null };
  });
  return { invoke: invoke as any, bodies };
}

describe('study-chat-client passes translation', () => {
  it('sendStudyMessage forwards the active translation in the body', async () => {
    const { invoke, bodies } = captureInvoke();
    await sendStudyMessage(invoke, { book: 'jhn', chapter: 3, message: 'hi', translation: 'KJV' });
    expect(bodies[0]).toMatchObject({ book: 'jhn', chapter: 3, message: 'hi', translation: 'KJV' });
  });

  it('requestStudyInsight forwards the active translation in the body', async () => {
    const { invoke, bodies } = captureInvoke();
    await requestStudyInsight(invoke, { book: 'jhn', chapter: 3, translation: 'WEB' });
    expect(bodies[0]).toMatchObject({ book: 'jhn', chapter: 3, mode: 'insight', translation: 'WEB' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/notepad/study/study-chat-client.test.ts`
Expected: FAIL — `translation` not on args / not in body.

- [ ] **Step 3: Update `study-chat-client.ts`**

Add the import and extend both arg types + bodies:

```ts
import type { ChatCitation, InvokeFn } from '../bible/lamplight-chat-client';
import type { BibleTranslation } from '../bible/translations';
```

```ts
export interface SendStudyArgs {
  book: string; chapter: number; message: string;
  includeNotes?: boolean; noteIds?: string[];
  translation?: BibleTranslation;
}
```

In `sendStudyMessage`, add `translation` to the body:

```ts
    body: {
      book: args.book, chapter: args.chapter, message: args.message,
      include_notes: args.includeNotes ?? false,
      note_ids: args.noteIds ?? [],
      translation: args.translation,
    },
```

```ts
export interface RequestStudyInsightArgs { book: string; chapter: number; translation?: BibleTranslation }
```

In `requestStudyInsight`:

```ts
  const { data, error } = await invoke('lamplight-study', { body: { book: args.book, chapter: args.chapter, mode: 'insight', translation: args.translation } });
```

- [ ] **Step 4: Run the client test to verify it passes**

Run: `npx vitest run src/notepad/study/study-chat-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Source the active version in `LamplightStudyPanel.tsx`**

Open `src/notepad/study/panes/LamplightStudyPanel.tsx`. Add:

```tsx
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
```

Inside the component, read `const { translation } = useBiblePrefs();` and pass `translation` into every `sendStudyMessage(...)` / `requestStudyInsight(...)` args object (add `translation` to the existing args). (Match the existing call sites in that file.)

- [ ] **Step 6: Accept `translation` in `parse-body.ts`**

In `supabase/functions/lamplight-study/parse-body.ts`, add a validated optional `translation` to the parsed result. Add the constant and field:

```ts
const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB'] as const;
type Translation = (typeof VALID_TRANSLATIONS)[number];
```

In the parse function, read `raw.translation` and include `translation: (typeof raw.translation === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(raw.translation)) ? raw.translation as Translation : undefined` on the returned `ParsedStudyBody` (add `translation?: Translation` to the `ParsedStudyBody` interface). Keep all existing fields/validation unchanged.

- [ ] **Step 7: Resolve + thread translation in `index.ts`**

In `supabase/functions/lamplight-study/index.ts`, after `const { book, chapter, message, mode, includeNotes, noteIds } = parsed;` and after `userId` is derived (line ~63), resolve the translation exactly like `lamplight-generate` (body wins, else profile, else BSB):

```ts
  const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB'] as const;
  type Translation = (typeof VALID_TRANSLATIONS)[number];
  let translation: Translation = parsed.translation ?? 'BSB';
  if (!parsed.translation) {
    try {
      const { data: profilePref } = await supabase
        .from('profiles').select('bible_translation').eq('id', userId).maybeSingle();
      const pref = (profilePref as { bible_translation?: unknown } | null)?.bible_translation;
      if (typeof pref === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(pref)) {
        translation = pref as Translation;
      }
    } catch { /* non-fatal: fall through with BSB */ }
  }
```

Pass `translation` into `buildStudyContext({ ... , translation })` (add it to the args object at the `buildStudyContext` call, ~line 119).

- [ ] **Step 8: Filter passages by translation in `study-context.ts`**

In `supabase/functions/lamplight-study/study-context.ts`:

1. Add `translation: string;` to the `args` object type (the inline type at the function signature, after `crossRefK: number; noteK: number;`).
2. Open-chapter fetch (~line 44-48) — add the filter:

```ts
  const { data: chapterRows, error: cErr } = await supabase
    .from('bible_passages')
    .select('book, chapter, verse_start, verse_end, text')
    .like('id', `${args.book}.${args.chapter}.%`)
    .eq('translation', args.translation)
    .order('verse_start', { ascending: true });
```

3. Cross-ref target resolution (~line 84-85) — add the filter:

```ts
    const { data: tgt } = await supabase
      .from('bible_passages').select('book, chapter, verse_start, verse_end, text')
      .eq('id', id).eq('translation', args.translation).maybeSingle();
```

(The `mode === 'insight'` retrieval-query fetch in `index.ts:113-116` builds a semantic search string only — embeddings are BSB by design — so leave it unfiltered.)

- [ ] **Step 9: Typecheck the frontend**

Run: `npx tsc -b`
Expected: no new errors. (Deno edge-function files are not part of `tsc -b`; they are validated at deploy.)

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/lamplight-study/ src/notepad/study/study-chat-client.ts src/notepad/study/study-chat-client.test.ts src/notepad/study/panes/LamplightStudyPanel.tsx
git commit -m "feat(lamplight-study): honor the user's Bible version (body -> profile -> BSB)"
```

---

### Task 7: Full verification + deploy

**Files:** none (verification + deploy only).

- [ ] **Step 1: Run the full affected test set**

Run:
```bash
npx vitest run src/notepad/bible/prefs src/auth/settings src/notepad/extensions src/notepad/study
```
Expected: all green. The two known pre-existing failing files (`Editor.toolbar-placement`, `garden-scene`) are out of this set; if either is pulled in transitively, confirm it fails identically on `origin/main` (pre-existing baseline) and is unrelated.

- [ ] **Step 2: Typecheck the real build**

Run: `npx tsc -b`
Expected: only the 4 pre-existing `force-sphere.test.ts` errors, nothing from files touched here.

- [ ] **Step 3: Lint the touched files**

Run: `npx eslint src/notepad/bible/prefs src/auth/settings/BibleReadingSettingsSection.tsx src/notepad/extensions/ScriptureRefView.tsx src/notepad/extensions/verse-picker-commands.ts src/notepad/extensions/scripture-ref.ts src/notepad/study/study-chat-client.ts`
Expected: zero NEW errors on these files.

- [ ] **Step 4: Manual smoke (local dev), signed in**

Use the `run` skill (or `npm run dev`). Verify:
1. Profile → "Bible & Reading": change version + verse layout. Open the Bible reader — toolbar selector + layout mirror the settings (and vice-versa).
2. Reload the page, and sign out / sign back in — both choices persist (sourced from `profiles`).
3. Open a note containing inline Scripture refs. Switch version (toolbar or settings) — the expanded verse text re-flows to the new version; collapse/expand still shows the new version.
4. Insert a new `/verse` ref after switching to KJV — it is stamped KJV (expand → meta shows KJV).
5. Lamplight **Chat** and Lamplight **Study**: citations/verses render in the selected version.

- [ ] **Step 5: Merge to main**

Open a PR from `feat/bible-version-global-prefs` → `main`, or fast-forward per repo convention. (Follow the repo's normal merge flow; do not force-push `main`.)

- [ ] **Step 6: Deploy the edge function (manual — not in CI)**

Run: `supabase functions deploy lamplight-study --use-api`
Then re-run the Study smoke (Step 4.5) against the deployed function to confirm version-aware grounding in production.

---

## Self-Review

**Spec coverage:**
- §1 shared global state → Task 1 + Task 2 (mount + migrate). ✓
- §2 persistence (no migration) → satisfied by Task 2 routing all consumers through the userId-aware provider; Global Constraints note no migration. ✓
- §3 Profile settings UI (toolbar stays) → Task 3; toolbar untouched and now reads the same context via `BibleStudyPane`/`StudyReader` props. ✓
- §4 Lamplight version-awareness: chat/generate already done; study fixed → Task 6; verse-search edge fn needs no change (covered by Task 4 insert fix + Task 5 display re-resolution). ✓
- §5 live re-flow (display-time, no stored rewrite) → Task 5; insert stamping → Task 4. ✓
- §6 testing & rollout → Tasks 1–7 TDD + Task 7 verification/deploy. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases". Two spots intentionally reference existing call sites to match (`LamplightStudyPanel.tsx` Step 5, `parse-body.ts` Step 6) — these are real files the implementer edits in place; the exact shape to add is given.

**Type consistency:** `BiblePrefsContextValue` fields (`translation/setTranslation/verseLayout/setVerseLayout`) are used identically in Tasks 1–3, 5, 6. `applyVerseSelection(editor, range, item, translation)` 4-arg signature is defined in Task 4 Step 3 and called in Task 4 Step 5. `scriptureRefAttrsFromCandidate(c, translation)` matches the existing export in `scripture-ref.ts`. `FetchVerseText` opts gain `translation?` in both `verse-search-client.ts` (Task 5 Step 1) and `ScriptureRefView.tsx` (Task 5 Step 4), consistent with `fetchVerseText` in `reference-parser.ts` which already accepts `{ translation }`.

**One open implementation detail (flagged, not blocking):** Task 6 Step 8 adds `.eq('translation', …)` to the cross-ref `.maybeSingle()` read — this also resolves any latent multi-row risk if `bible_passages.id` is not unique across translations. Correct either way.
