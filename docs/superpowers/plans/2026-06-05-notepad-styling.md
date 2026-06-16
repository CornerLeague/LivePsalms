# Notepad Styling — Highlights & Decorations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let notepad users highlight text with painterly swatches and place free-floating decorations (shapes, arrows, bubbles, squiggles, lines) onto a note to build personalized layouts.

**Architecture:** Two independent layers. **Highlights** are a TipTap mark (`styleHighlight`) carrying a `swatchId`, so they live inside the note's existing `content` JSON and persist/reflow/export for free. **Decorations** are a normalized data array (`Note.decorations`) rendered by an absolutely-positioned overlay inside the editor scroll container, persisted through the existing debounced `updateNote` path (localStorage spreads it for free; Supabase needs a `decorations jsonb` column + mapper edits). All visual assets are pre-optimized to WebP by a build script that also emits a typed `manifest.ts` catalog the app imports.

**Tech Stack:** React + Vite + TypeScript, TipTap (`@tiptap/core`, `@tiptap/react`), Supabase (Postgres + RLS), `sharp` (build-time image optimization, new devDependency), `uuid` (already present), vitest + `@testing-library/react`.

---

## File Structure

**New files:**
- `scripts/style-assets-lib.mjs` — pure helpers for the asset pipeline (categorize source folder → category, slugify filename → id, build manifest entries). No I/O. Unit-tested.
- `scripts/style-assets-lib.test.ts` — tests for the pure helpers.
- `scripts/build-style-assets.mjs` — CLI: walks the source `Notes Styles/` folder, optimizes each in-scope image to display + thumb WebP via `sharp`, writes `public/styles/<category>/<id>.webp` + `<id>.thumb.webp`, and generates `src/notepad/styles/manifest.ts`. Idempotent.
- `src/notepad/styles/asset-helpers.ts` — pure catalog helpers operating on injected arrays (`findAsset`, `filterAssets`). Unit-tested. Imported by the generated manifest and by UI.
- `src/notepad/styles/asset-helpers.test.ts` — tests for the catalog helpers.
- `src/notepad/styles/manifest.ts` — **generated** by the build script. Exports `StyleCategory`, `StyleAsset`, `STYLE_ASSETS`, `ASSETS_BY_CATEGORY`, `getStyleAsset`. Committed.
- `src/notepad/extensions/style-highlight.ts` — TipTap mark + pure `highlightBackgroundStyle(asset)` helper.
- `src/notepad/extensions/style-highlight.test.ts` — tests for the pure style helper.
- `src/notepad/components/HighlightSwatchPopover.tsx` — selection-anchored swatch grid + search + remove.
- `src/notepad/decorations/decoration-ops.ts` — pure reducer over `NoteDecoration[]` (add/update/remove/duplicate/bringToFront/sendToBack/nextZ). Unit-tested.
- `src/notepad/decorations/decoration-ops.test.ts` — tests for the reducer.
- `src/notepad/decorations/decoration-geometry.ts` — pure geometry (resize, rotation, clamp). Unit-tested.
- `src/notepad/decorations/decoration-geometry.test.ts` — tests for geometry.
- `src/notepad/decorations/useDecorations.ts` — state hook bridging the reducer to debounced `updateNote`.
- `src/notepad/decorations/DecorationLayer.tsx` — overlay container; maps normalized coords → CSS transforms; click-empty-to-deselect; measures content width.
- `src/notepad/decorations/DecorationItem.tsx` — one placed decoration with drag/resize/rotate handles + action bar (front/back/duplicate/delete) + mobile pinch.
- `src/notepad/decorations/DecorationTray.tsx` — bottom drawer picker: category pills, search, swipeable thumbnail grid; tap/drag to place.
- `supabase/migrations/023_notes_decorations.sql` — adds `decorations jsonb not null default '[]'`.

**Modified files:**
- `src/notepad/types.ts` — add `NoteDecoration` interface + `decorations?: NoteDecoration[]` on `Note`.
- `src/notepad/storage/supabase-adapter.ts` — map/insert/update `decorations`.
- `src/notepad/components/Editor.tsx` — mount `DecorationLayer`, `DecorationTray`, and `HighlightSwatchPopover`; register the `styleHighlight` extension via `useNoteEditor`.
- `src/notepad/editor/use-note-editor.ts` — add `StyleHighlight` to the extensions array.
- `package.json` — add `sharp` devDependency + `build:styles` script.

Note: `src/notepad/storage/local-storage.ts` needs **no change** — its `updateNote` spreads `...updates` and `createNote`/`importNote` spread `...note`, so `decorations` round-trips for free.

---

## Phase 1 — Asset pipeline + manifest

Produces the optimized WebP assets and the typed catalog every later phase imports.

**Category mapping (source folder → `StyleCategory`):**

| Source folder | Category | Count |
|---|---|---|
| `1. Large Shapes` | `shape` | 30 |
| `2. Highlights & Boxes` | `highlight` | 125 |
| `3. Squiggles & Lines/Squiggles ` | `squiggle` | 85 |
| `3. Squiggles & Lines/Lines & Dividers` | `line` | 65 |
| `4. Arrows` | `arrow` | 60 |
| `5. Speech Bubbles` | `bubble` | 48 |
| `6. Backgrounds`, `7. Papers` | — (skipped, out of scope) | — |

### Task 1.1: Add `sharp` devDependency + build script entry

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install sharp as a devDependency**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm install --save-dev sharp`
Expected: `sharp` appears under `devDependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Add the build script**

In `package.json` `"scripts"`, add (keep alphabetical-ish near other build scripts):

```json
"build:styles": "node scripts/build-style-assets.mjs --src \"../Notes Styles\" --out public/styles --manifest src/notepad/styles/manifest.ts"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add sharp devDependency and build:styles script"
```

### Task 1.2: Pure pipeline helpers (categorize + slugify)

**Files:**
- Create: `scripts/style-assets-lib.mjs`
- Test: `scripts/style-assets-lib.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/style-assets-lib.test.ts
import { describe, it, expect } from 'vitest';
import { categorize, slugify, IN_SCOPE_CATEGORIES } from './style-assets-lib.mjs';

describe('categorize', () => {
  it('maps each in-scope source folder to its category', () => {
    expect(categorize('1. Large Shapes')).toBe('shape');
    expect(categorize('2. Highlights & Boxes')).toBe('highlight');
    expect(categorize('3. Squiggles & Lines/Squiggles ')).toBe('squiggle');
    expect(categorize('3. Squiggles & Lines/Lines & Dividers')).toBe('line');
    expect(categorize('4. Arrows')).toBe('arrow');
    expect(categorize('5. Speech Bubbles')).toBe('bubble');
  });

  it('returns null for out-of-scope folders', () => {
    expect(categorize('6. Backgrounds')).toBeNull();
    expect(categorize('7. Papers/PNG Files')).toBeNull();
  });

  it('is tolerant of a trailing slash and trailing spaces', () => {
    expect(categorize('3. Squiggles & Lines/Squiggles /')).toBe('squiggle');
  });
});

describe('slugify', () => {
  it('lowercases, strips extension, and hyphenates', () => {
    expect(slugify('Arrow 12.png')).toBe('arrow-12');
    expect(slugify('Speech_Bubble (3).PNG')).toBe('speech-bubble-3');
  });

  it('prefixes the category so ids are globally unique', () => {
    expect(slugify('01.png', 'shape')).toBe('shape-01');
  });
});

describe('IN_SCOPE_CATEGORIES', () => {
  it('lists the six in-scope categories', () => {
    expect(IN_SCOPE_CATEGORIES).toEqual([
      'highlight', 'shape', 'arrow', 'bubble', 'squiggle', 'line',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/style-assets-lib.test.ts`
Expected: FAIL — cannot resolve `./style-assets-lib.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/style-assets-lib.mjs

export const IN_SCOPE_CATEGORIES = [
  'highlight', 'shape', 'arrow', 'bubble', 'squiggle', 'line',
];

// Map a source-folder path (relative to the Notes Styles root, forward-slashed)
// to a StyleCategory, or null if the folder is out of scope.
export function categorize(folderPath) {
  const p = folderPath.replace(/\/+$/, '').trim();
  if (p.startsWith('1. Large Shapes')) return 'shape';
  if (p.startsWith('2. Highlights & Boxes')) return 'highlight';
  if (p.startsWith('3. Squiggles & Lines/Squiggles')) return 'squiggle';
  if (p.startsWith('3. Squiggles & Lines/Lines & Dividers')) return 'line';
  if (p.startsWith('4. Arrows')) return 'arrow';
  if (p.startsWith('5. Speech Bubbles')) return 'bubble';
  return null;
}

// Build a filesystem-safe, unique id from a filename (and optional category prefix).
export function slugify(filename, category) {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return category ? `${category}-${base}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/style-assets-lib.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/style-assets-lib.mjs scripts/style-assets-lib.test.ts
git commit -m "feat: add pure helpers for style-asset pipeline"
```

### Task 1.3: Manifest-entry builder

**Files:**
- Modify: `scripts/style-assets-lib.mjs`
- Modify: `scripts/style-assets-lib.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing test file)**

```ts
import { buildManifestEntry, renderManifestModule } from './style-assets-lib.mjs';

describe('buildManifestEntry', () => {
  it('builds a StyleAsset with public URLs and aspect ratio', () => {
    const entry = buildManifestEntry({
      id: 'arrow-12',
      category: 'arrow',
      width: 800,
      height: 400,
    });
    expect(entry).toEqual({
      id: 'arrow-12',
      category: 'arrow',
      thumbUrl: '/styles/arrow/arrow-12.thumb.webp',
      displayUrl: '/styles/arrow/arrow-12.webp',
      aspectRatio: 2,
    });
  });
});

describe('renderManifestModule', () => {
  it('emits a typed module exporting STYLE_ASSETS', () => {
    const src = renderManifestModule([
      { id: 'shape-01', category: 'shape', thumbUrl: '/styles/shape/shape-01.thumb.webp', displayUrl: '/styles/shape/shape-01.webp', aspectRatio: 1 },
    ]);
    expect(src).toContain('export type StyleCategory =');
    expect(src).toContain('export const STYLE_ASSETS: StyleAsset[] =');
    expect(src).toContain('"id": "shape-01"');
    expect(src).toContain("export function getStyleAsset(id: string)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/style-assets-lib.test.ts`
Expected: FAIL — `buildManifestEntry` / `renderManifestModule` not exported.

- [ ] **Step 3: Write minimal implementation (append to `style-assets-lib.mjs`)**

```js
export function buildManifestEntry({ id, category, width, height }) {
  return {
    id,
    category,
    thumbUrl: `/styles/${category}/${id}.thumb.webp`,
    displayUrl: `/styles/${category}/${id}.webp`,
    aspectRatio: Number((width / height).toFixed(4)),
  };
}

export function renderManifestModule(assets) {
  const sorted = [...assets].sort((a, b) => a.id.localeCompare(b.id));
  const json = JSON.stringify(sorted, null, 2);
  return `// AUTO-GENERATED by scripts/build-style-assets.mjs — do not edit by hand.
import { findAsset, filterAssets } from './asset-helpers';

export type StyleCategory =
  | 'highlight' | 'shape' | 'arrow' | 'bubble' | 'squiggle' | 'line';

export interface StyleAsset {
  id: string;
  category: StyleCategory;
  thumbUrl: string;
  displayUrl: string;
  aspectRatio: number;
}

export const STYLE_ASSETS: StyleAsset[] = ${json};

export const ASSETS_BY_CATEGORY: Record<StyleCategory, StyleAsset[]> =
  STYLE_ASSETS.reduce((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {} as Record<StyleCategory, StyleAsset[]>);

export function getStyleAsset(id: string): StyleAsset | undefined {
  return findAsset(STYLE_ASSETS, id);
}

export { findAsset, filterAssets };
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/style-assets-lib.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/style-assets-lib.mjs scripts/style-assets-lib.test.ts
git commit -m "feat: add manifest-entry builder and module renderer"
```

### Task 1.4: Catalog helpers consumed by the app

**Files:**
- Create: `src/notepad/styles/asset-helpers.ts`
- Test: `src/notepad/styles/asset-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/styles/asset-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { findAsset, filterAssets } from './asset-helpers';
import type { StyleAsset } from './manifest';

const A: StyleAsset[] = [
  { id: 'arrow-01', category: 'arrow', thumbUrl: 't1', displayUrl: 'd1', aspectRatio: 1 },
  { id: 'arrow-02', category: 'arrow', thumbUrl: 't2', displayUrl: 'd2', aspectRatio: 1 },
  { id: 'shape-01', category: 'shape', thumbUrl: 't3', displayUrl: 'd3', aspectRatio: 1 },
];

describe('findAsset', () => {
  it('returns the matching asset', () => {
    expect(findAsset(A, 'shape-01')?.id).toBe('shape-01');
  });
  it('returns undefined when missing', () => {
    expect(findAsset(A, 'nope')).toBeUndefined();
  });
});

describe('filterAssets', () => {
  it('filters by category', () => {
    expect(filterAssets(A, 'arrow', '').map((a) => a.id)).toEqual(['arrow-01', 'arrow-02']);
  });
  it("category 'all' returns everything", () => {
    expect(filterAssets(A, 'all', '')).toHaveLength(3);
  });
  it('search matches the id substring, case-insensitively', () => {
    expect(filterAssets(A, 'all', 'SHAPE').map((a) => a.id)).toEqual(['shape-01']);
  });
  it('combines category and search', () => {
    expect(filterAssets(A, 'arrow', '02').map((a) => a.id)).toEqual(['arrow-02']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/styles/asset-helpers.test.ts`
Expected: FAIL — `./asset-helpers` not found (and `./manifest` not found yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/styles/asset-helpers.ts
import type { StyleAsset, StyleCategory } from './manifest';

export function findAsset(
  assets: StyleAsset[],
  id: string,
): StyleAsset | undefined {
  return assets.find((a) => a.id === id);
}

export function filterAssets(
  assets: StyleAsset[],
  category: StyleCategory | 'all',
  query: string,
): StyleAsset[] {
  const q = query.trim().toLowerCase();
  return assets.filter(
    (a) =>
      (category === 'all' || a.category === category) &&
      (q === '' || a.id.toLowerCase().includes(q)),
  );
}
```

Note: this file imports types from the not-yet-generated `manifest.ts`. Create a **temporary stub** so the test (and typecheck) compile until Task 1.5 generates the real one:

```ts
// src/notepad/styles/manifest.ts  (TEMPORARY STUB — overwritten by build:styles)
export type StyleCategory =
  | 'highlight' | 'shape' | 'arrow' | 'bubble' | 'squiggle' | 'line';
export interface StyleAsset {
  id: string;
  category: StyleCategory;
  thumbUrl: string;
  displayUrl: string;
  aspectRatio: number;
}
export const STYLE_ASSETS: StyleAsset[] = [];
export const ASSETS_BY_CATEGORY = {} as Record<StyleCategory, StyleAsset[]>;
export function getStyleAsset(_id: string): StyleAsset | undefined { return undefined; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/styles/asset-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/styles/asset-helpers.ts src/notepad/styles/asset-helpers.test.ts src/notepad/styles/manifest.ts
git commit -m "feat: add style-asset catalog helpers with stub manifest"
```

### Task 1.5: The build script + generated manifest

**Files:**
- Create: `scripts/build-style-assets.mjs`
- Overwrite (generated): `src/notepad/styles/manifest.ts`

- [ ] **Step 1: Write the build script**

```js
// scripts/build-style-assets.mjs
import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import {
  categorize,
  slugify,
  buildManifestEntry,
  renderManifestModule,
} from './style-assets-lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = arg('src', '../Notes Styles');
const OUT = arg('out', 'public/styles');
const MANIFEST = arg('manifest', 'src/notepad/styles/manifest.ts');

const DISPLAY_EDGE = 800;
const THUMB_EDGE = 120;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function run() {
  const entries = [];
  const seen = new Set();

  for await (const file of walk(SRC)) {
    if (!/\.(png|jpe?g)$/i.test(file)) continue;
    const rel = relative(SRC, file).split('\\').join('/');
    const folder = rel.slice(0, rel.lastIndexOf('/'));
    const category = categorize(folder);
    if (!category) continue;

    const filename = rel.slice(rel.lastIndexOf('/') + 1);
    let id = slugify(filename, category);
    // Guarantee uniqueness if two source files slug-collide.
    let n = 2;
    while (seen.has(id)) id = `${slugify(filename, category)}-${n++}`;
    seen.add(id);

    const dir = join(OUT, category);
    await mkdir(dir, { recursive: true });

    const img = sharp(file);
    const meta = await img.metadata();

    await sharp(file)
      .resize({ width: DISPLAY_EDGE, height: DISPLAY_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(dir, `${id}.webp`));

    await sharp(file)
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(join(dir, `${id}.thumb.webp`));

    entries.push(
      buildManifestEntry({
        id,
        category,
        width: meta.width ?? 1,
        height: meta.height ?? 1,
      }),
    );
  }

  await writeFile(MANIFEST, renderManifestModule(entries), 'utf8');
  console.log(`Wrote ${entries.length} assets and ${MANIFEST}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the build script against the real source folder**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm run build:styles`
Expected: `Wrote 413 assets and src/notepad/styles/manifest.ts` (125 highlight + 30 shape + 60 arrow + 48 bubble + 85 squiggle + 65 line). Files appear under `public/styles/<category>/`.

- [ ] **Step 3: Verify the generated manifest typechecks and helper tests still pass**

Run: `npx tsc --noEmit && npx vitest run src/notepad/styles/asset-helpers.test.ts`
Expected: tsc clean; tests PASS against the now-populated `STYLE_ASSETS`.

- [ ] **Step 4: Sanity-check counts and total size**

Run: `find public/styles -name '*.thumb.webp' | wc -l && du -sh public/styles`
Expected: 413 thumbnails; total well under ~30 MB.

- [ ] **Step 5: Commit (assets + generated manifest + script)**

```bash
git add scripts/build-style-assets.mjs src/notepad/styles/manifest.ts public/styles
git commit -m "feat: generate optimized style assets and manifest catalog"
```

---

## Phase 2 — Highlights (text-bound)

A TipTap mark that paints a swatch band behind a text selection. Delivers the headline "highlight" ask. Independent of Phases 3–5.

### Task 2.1: Pure highlight-style helper

**Files:**
- Create: `src/notepad/extensions/style-highlight.ts`
- Test: `src/notepad/extensions/style-highlight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/extensions/style-highlight.test.ts
import { describe, it, expect } from 'vitest';
import { highlightBackgroundStyle } from './style-highlight';

describe('highlightBackgroundStyle', () => {
  it('stretches the swatch display image behind the text', () => {
    const style = highlightBackgroundStyle('/styles/highlight/highlight-60.webp');
    expect(style).toContain('background-image:url(/styles/highlight/highlight-60.webp)');
    expect(style).toContain('background-size:100% 100%');
    expect(style).toContain('background-repeat:no-repeat');
  });

  it('returns an empty string for a missing url', () => {
    expect(highlightBackgroundStyle(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/extensions/style-highlight.test.ts`
Expected: FAIL — `highlightBackgroundStyle` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/extensions/style-highlight.ts
import { Mark, mergeAttributes } from '@tiptap/core';
import { getStyleAsset } from '../styles/manifest';

export function highlightBackgroundStyle(displayUrl: string | undefined): string {
  if (!displayUrl) return '';
  return (
    `background-image:url(${displayUrl});` +
    'background-size:100% 100%;' +
    'background-repeat:no-repeat;' +
    'border-radius:3px;' +
    'padding:0 2px;' +
    '-webkit-box-decoration-break:clone;' +
    'box-decoration-break:clone;'
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    styleHighlight: {
      setStyleHighlight: (swatchId: string) => ReturnType;
      unsetStyleHighlight: () => ReturnType;
      toggleStyleHighlight: (swatchId: string) => ReturnType;
    };
  }
}

export const StyleHighlight = Mark.create({
  name: 'styleHighlight',

  addAttributes() {
    return {
      swatchId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-style-highlight'),
        renderHTML: (attrs) => ({ 'data-style-highlight': attrs.swatchId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-style-highlight]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const swatchId = HTMLAttributes['data-style-highlight'] as string | undefined;
    const asset = swatchId ? getStyleAsset(swatchId) : undefined;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        style: highlightBackgroundStyle(asset?.displayUrl),
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setStyleHighlight:
        (swatchId) =>
        ({ commands }) =>
          commands.setMark(this.name, { swatchId }),
      unsetStyleHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleStyleHighlight:
        (swatchId) =>
        ({ commands }) =>
          commands.toggleMark(this.name, { swatchId }),
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/extensions/style-highlight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/style-highlight.ts src/notepad/extensions/style-highlight.test.ts
git commit -m "feat: add styleHighlight TipTap mark"
```

### Task 2.2: Register the mark in the editor

**Files:**
- Modify: `src/notepad/editor/use-note-editor.ts:7` (imports) and `:52-58` (extensions array)

- [ ] **Step 1: Add the import**

After line 7 (`import { TagMark } from '../extensions/tag-mark';`), add:

```ts
import { StyleHighlight } from '../extensions/style-highlight';
```

- [ ] **Step 2: Add it to the extensions array**

In the `extensions: [...]` array, add `StyleHighlight,` after `TagMark,`:

```ts
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing...' }),
      BibleVerse,
      NoteLink,
      TagMark,
      StyleHighlight,
    ],
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/notepad/editor/use-note-editor.ts
git commit -m "feat: register styleHighlight in the note editor"
```

### Task 2.3: Swatch popover component

**Files:**
- Create: `src/notepad/components/HighlightSwatchPopover.tsx`
- Test: `src/notepad/components/HighlightSwatchPopover.test.tsx`

The popover is presentational: it receives the highlight assets, a search string + setter, and `onPick` / `onRemove` callbacks. The host (Editor) decides when to render it (non-empty selection) and where (anchored to the selection rect).

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/components/HighlightSwatchPopover.test.tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighlightSwatchPopover } from './HighlightSwatchPopover';
import type { StyleAsset } from '../styles/manifest';

const assets: StyleAsset[] = [
  { id: 'highlight-60', category: 'highlight', thumbUrl: 't60', displayUrl: 'd60', aspectRatio: 4 },
  { id: 'highlight-90', category: 'highlight', thumbUrl: 't90', displayUrl: 'd90', aspectRatio: 4 },
];

afterEach(cleanup);

describe('HighlightSwatchPopover', () => {
  it('calls onPick with the swatch id when a swatch is clicked', () => {
    const onPick = vi.fn();
    const { getByLabelText } = render(
      <HighlightSwatchPopover
        assets={assets} query="" onQueryChange={() => {}}
        onPick={onPick} onRemove={() => {}} anchor={{ top: 0, left: 0 }}
      />,
    );
    fireEvent.click(getByLabelText('Highlight highlight-60'));
    expect(onPick).toHaveBeenCalledWith('highlight-60');
  });

  it('filters swatches by the query', () => {
    const { queryByLabelText } = render(
      <HighlightSwatchPopover
        assets={assets} query="90" onQueryChange={() => {}}
        onPick={() => {}} onRemove={() => {}} anchor={{ top: 0, left: 0 }}
      />,
    );
    expect(queryByLabelText('Highlight highlight-60')).toBeNull();
    expect(queryByLabelText('Highlight highlight-90')).not.toBeNull();
  });

  it('calls onRemove when the remove affordance is clicked', () => {
    const onRemove = vi.fn();
    const { getByLabelText } = render(
      <HighlightSwatchPopover
        assets={assets} query="" onQueryChange={() => {}}
        onPick={() => {}} onRemove={onRemove} anchor={{ top: 0, left: 0 }}
      />,
    );
    fireEvent.click(getByLabelText('Remove highlight'));
    expect(onRemove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/components/HighlightSwatchPopover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/notepad/components/HighlightSwatchPopover.tsx
import { filterAssets, type StyleAsset } from '../styles/manifest';

interface Anchor { top: number; left: number; }

interface Props {
  assets: StyleAsset[];
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (swatchId: string) => void;
  onRemove: () => void;
  anchor: Anchor;
}

export function HighlightSwatchPopover({
  assets, query, onQueryChange, onPick, onRemove, anchor,
}: Props) {
  const shown = filterAssets(assets, 'highlight', query);
  return (
    <div
      role="dialog"
      aria-label="Highlight swatches"
      style={{
        position: 'fixed',
        top: anchor.top,
        left: anchor.left,
        zIndex: 60,
        width: 200,
        background: '#fff',
        border: '1px solid var(--pale-stone)',
        borderRadius: 9,
        boxShadow: '0 8px 22px rgba(0,0,0,.16)',
        padding: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search…"
          aria-label="Search highlights"
          style={{ flex: 1, fontSize: 12, padding: '3px 6px', border: '1px solid var(--pale-stone)', borderRadius: 6 }}
        />
        <button aria-label="Remove highlight" onClick={onRemove}
          style={{ fontSize: 11, border: '1px solid var(--pale-stone)', borderRadius: 6, padding: '0 8px', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
        {shown.map((a) => (
          <button
            key={a.id}
            aria-label={`Highlight ${a.id}`}
            onClick={() => onPick(a.id)}
            style={{ height: 26, border: '1px solid var(--pale-stone)', borderRadius: 5, overflow: 'hidden', background: '#fff', cursor: 'pointer', padding: 0 }}
          >
            <img src={a.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/components/HighlightSwatchPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/components/HighlightSwatchPopover.tsx src/notepad/components/HighlightSwatchPopover.test.tsx
git commit -m "feat: add HighlightSwatchPopover component"
```

### Task 2.4: Wire the popover into the editor

**Files:**
- Modify: `src/notepad/components/Editor.tsx` (add selection tracking + render the popover)

- [ ] **Step 1: Add selection state and a query state near the top of the component (after `const { editor } = useNoteEditor(...)` at line 67)**

```tsx
  const [swatchAnchor, setSwatchAnchor] = useState<{ top: number; left: number } | null>(null);
  const [swatchQuery, setSwatchQuery] = useState('');
```

(Ensure `useState` is imported from `react`.)

- [ ] **Step 2: Track selection to show/hide the popover. Add this effect after the editor is created:**

```tsx
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to) { setSwatchAnchor(null); return; }
      const start = editor.view.coordsAtPos(from);
      setSwatchAnchor({ top: start.bottom + 6, left: start.left });
    };
    editor.on('selectionUpdate', update);
    return () => { editor.off('selectionUpdate', update); };
  }, [editor]);
```

- [ ] **Step 3: Render the popover. Just before the closing fragment/root return, add:**

```tsx
      {editor && swatchAnchor && (
        <HighlightSwatchPopover
          assets={STYLE_ASSETS}
          query={swatchQuery}
          onQueryChange={setSwatchQuery}
          anchor={swatchAnchor}
          onPick={(id) => editor.chain().focus().setStyleHighlight(id).run()}
          onRemove={() => editor.chain().focus().unsetStyleHighlight().run()}
        />
      )}
```

Add imports at the top of `Editor.tsx`:

```tsx
import { HighlightSwatchPopover } from './HighlightSwatchPopover';
import { STYLE_ASSETS } from '../styles/manifest';
```

- [ ] **Step 4: Verify in the browser**

Run the dev server (`preview_start` if needed), open a note, type a line, select a word, click a swatch in the popover, and confirm a painted band renders behind the selected text and persists after reload. Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/components/Editor.tsx
git commit -m "feat: wire highlight swatch popover into the editor"
```

---

## Phase 3 — Decoration data model + overlay

Adds the `decorations` array to `Note`, the Supabase column + mapper edits, a pure reducer, the persistence hook, and a read-only overlay that renders placed decorations. (Manipulation handles come in Phase 5.)

### Task 3.1: NoteDecoration type

**Files:**
- Modify: `src/notepad/types.ts`

- [ ] **Step 1: Add the interface and the optional Note field**

After the `NoteType` line, before `Note`, add:

```ts
export interface NoteDecoration {
  id: string;        // local uuid
  assetId: string;   // manifest id
  xPct: number;      // 0..1, left position normalized to content width
  yPx: number;       // vertical position in px from top of content
  widthPct: number;  // 0..1, width normalized to content width
  rotation: number;  // degrees
  z: number;         // stacking order
}
```

Then add `decorations?: NoteDecoration[];` to the `Note` interface after `tags`:

```ts
export interface Note {
  id: string;
  title: string;
  content: string;
  folderId: string;
  type: NoteType;
  tags: string[];
  decorations?: NoteDecoration[];
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (field is optional, so existing call sites compile).

- [ ] **Step 3: Commit**

```bash
git add src/notepad/types.ts
git commit -m "feat: add NoteDecoration type and Note.decorations field"
```

### Task 3.2: Supabase migration + adapter mapping

**Files:**
- Create: `supabase/migrations/023_notes_decorations.sql`
- Modify: `src/notepad/storage/supabase-adapter.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 023_notes_decorations.sql
--
-- Free-canvas decorations placed on a note (Layer 3 of notepad styling).
-- Stored as a JSON array of NoteDecoration objects. Existing notes default
-- to an empty array.

alter table public.notes
  add column if not exists decorations jsonb not null default '[]'::jsonb;
```

- [ ] **Step 2: Add `decorations` to the mapper.** In `mapNote` (line ~211), add after the `tags` line:

```ts
    decorations: (row.decorations as Note['decorations']) ?? [],
```

- [ ] **Step 3: Add `decorations` to `createNote` and `importNote` inserts.** In each `.insert({...})` object (lines ~47 and ~68), add after `tags`:

```ts
        decorations: note.decorations ?? [],
```

- [ ] **Step 4: Add `decorations` to `updateNote`'s `mapped` builder.** After the `tags` block (line ~98), add:

```ts
    if (updates.decorations !== undefined) mapped.decorations = updates.decorations;
```

- [ ] **Step 5: Carry decorations through `duplicateNote`.** In the `createNote({...})` call (line ~119), add after `tags`:

```ts
      decorations: original.decorations ?? [],
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/023_notes_decorations.sql src/notepad/storage/supabase-adapter.ts
git commit -m "feat: persist note decorations in Supabase"
```

### Task 3.3: Pure decoration reducer

**Files:**
- Create: `src/notepad/decorations/decoration-ops.ts`
- Test: `src/notepad/decorations/decoration-ops.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/decorations/decoration-ops.test.ts
import { describe, it, expect } from 'vitest';
import {
  addDecoration, updateDecoration, removeDecoration,
  duplicateDecoration, bringToFront, sendToBack, nextZ,
} from './decoration-ops';
import type { NoteDecoration } from '../types';

const base: NoteDecoration = {
  id: 'a', assetId: 'arrow-01', xPct: 0.5, yPx: 100, widthPct: 0.2, rotation: 0, z: 1,
};

let counter = 0;
const idGen = () => `id-${++counter}`;

describe('decoration-ops', () => {
  it('addDecoration appends with a generated id and next z', () => {
    counter = 0;
    const out = addDecoration([base], { assetId: 'shape-01', xPct: 0.1, yPx: 10, widthPct: 0.3, rotation: 0 }, idGen);
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe('id-1');
    expect(out[1].z).toBe(2); // max z (1) + 1
  });

  it('updateDecoration patches only the matching item', () => {
    const out = updateDecoration([base], 'a', { rotation: 45 });
    expect(out[0].rotation).toBe(45);
    expect(out[0].xPct).toBe(0.5);
  });

  it('removeDecoration drops the matching item', () => {
    expect(removeDecoration([base], 'a')).toEqual([]);
  });

  it('duplicateDecoration clones with a new id, nudged position, and next z', () => {
    counter = 0;
    const out = duplicateDecoration([base], 'a', idGen);
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe('id-1');
    expect(out[1].assetId).toBe('arrow-01');
    expect(out[1].xPct).toBeCloseTo(0.52);
    expect(out[1].yPx).toBe(120);
    expect(out[1].z).toBe(2);
  });

  it('bringToFront / sendToBack reassign z relative to the set', () => {
    const two = [base, { ...base, id: 'b', z: 2 }];
    expect(bringToFront(two, 'a').find((d) => d.id === 'a')!.z).toBe(3);
    expect(sendToBack(two, 'b').find((d) => d.id === 'b')!.z).toBe(0);
  });

  it('nextZ returns max z + 1, or 1 for an empty set', () => {
    expect(nextZ([])).toBe(1);
    expect(nextZ([base])).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/decorations/decoration-ops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/decorations/decoration-ops.ts
import type { NoteDecoration } from '../types';

type NewDecoration = Omit<NoteDecoration, 'id' | 'z'>;

export function nextZ(list: NoteDecoration[]): number {
  return list.reduce((max, d) => Math.max(max, d.z), 0) + 1;
}

export function addDecoration(
  list: NoteDecoration[],
  init: NewDecoration,
  idGen: () => string,
): NoteDecoration[] {
  return [...list, { ...init, id: idGen(), z: nextZ(list) }];
}

export function updateDecoration(
  list: NoteDecoration[],
  id: string,
  patch: Partial<Omit<NoteDecoration, 'id'>>,
): NoteDecoration[] {
  return list.map((d) => (d.id === id ? { ...d, ...patch } : d));
}

export function removeDecoration(
  list: NoteDecoration[],
  id: string,
): NoteDecoration[] {
  return list.filter((d) => d.id !== id);
}

export function duplicateDecoration(
  list: NoteDecoration[],
  id: string,
  idGen: () => string,
): NoteDecoration[] {
  const src = list.find((d) => d.id === id);
  if (!src) return list;
  return [
    ...list,
    { ...src, id: idGen(), xPct: src.xPct + 0.02, yPx: src.yPx + 20, z: nextZ(list) },
  ];
}

export function bringToFront(
  list: NoteDecoration[],
  id: string,
): NoteDecoration[] {
  const top = nextZ(list);
  return list.map((d) => (d.id === id ? { ...d, z: top } : d));
}

export function sendToBack(
  list: NoteDecoration[],
  id: string,
): NoteDecoration[] {
  return list.map((d) => (d.id === id ? { ...d, z: 0 } : d));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/decorations/decoration-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/decorations/decoration-ops.ts src/notepad/decorations/decoration-ops.test.ts
git commit -m "feat: add pure decoration reducer"
```

### Task 3.4: useDecorations persistence hook

**Files:**
- Create: `src/notepad/decorations/useDecorations.ts`
- Test: `src/notepad/decorations/useDecorations.test.ts`

The hook owns the active note's decorations array in local state for snappy UI and flushes to `updateNote` on every change (the existing `updateNote` path is already debounced at the editor level; here we write immediately — placement/drag-end are discrete user actions, not keystrokes).

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/decorations/useDecorations.test.ts
// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useDecorations } from './useDecorations';
import type { Note } from '../types';

const note = (decorations: Note['decorations'] = []): Note => ({
  id: 'n1', title: 'T', content: '', folderId: 'root', type: 'devotion',
  tags: [], decorations, wordCount: 0, createdAt: '', updatedAt: '',
});

describe('useDecorations', () => {
  it('adds a decoration and persists via updateNote', () => {
    const updateNote = vi.fn();
    const { result } = renderHook(() => useDecorations(note(), updateNote));
    act(() => {
      result.current.add({ assetId: 'arrow-01', xPct: 0.5, yPx: 100, widthPct: 0.2, rotation: 0 });
    });
    expect(result.current.decorations).toHaveLength(1);
    expect(updateNote).toHaveBeenCalledWith('n1', {
      decorations: expect.arrayContaining([expect.objectContaining({ assetId: 'arrow-01' })]),
    });
  });

  it('reflects the active note when it changes', () => {
    const updateNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ n }) => useDecorations(n, updateNote),
      { initialProps: { n: note([]) } },
    );
    rerender({ n: note([{ id: 'x', assetId: 'shape-01', xPct: 0, yPx: 0, widthPct: 0.1, rotation: 0, z: 1 }]) });
    expect(result.current.decorations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/decorations/useDecorations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/notepad/decorations/useDecorations.ts
import { useEffect, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Note, NoteDecoration } from '../types';
import {
  addDecoration, updateDecoration, removeDecoration,
  duplicateDecoration, bringToFront, sendToBack,
} from './decoration-ops';

type NewDecoration = Omit<NoteDecoration, 'id' | 'z'>;

export function useDecorations(
  activeNote: Note | null,
  updateNote: (id: string, updates: Partial<Pick<Note, 'decorations'>>) => unknown,
) {
  const [decorations, setDecorations] = useState<NoteDecoration[]>(
    activeNote?.decorations ?? [],
  );

  // Reload when the active note changes (by id).
  useEffect(() => {
    setDecorations(activeNote?.decorations ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id]);

  const commit = useCallback(
    (next: NoteDecoration[]) => {
      setDecorations(next);
      if (activeNote) updateNote(activeNote.id, { decorations: next });
    },
    [activeNote, updateNote],
  );

  return {
    decorations,
    add: (init: NewDecoration) => commit(addDecoration(decorations, init, uuidv4)),
    update: (id: string, patch: Partial<Omit<NoteDecoration, 'id'>>) =>
      commit(updateDecoration(decorations, id, patch)),
    remove: (id: string) => commit(removeDecoration(decorations, id)),
    duplicate: (id: string) => commit(duplicateDecoration(decorations, id, uuidv4)),
    bringToFront: (id: string) => commit(bringToFront(decorations, id)),
    sendToBack: (id: string) => commit(sendToBack(decorations, id)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/decorations/useDecorations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/decorations/useDecorations.ts src/notepad/decorations/useDecorations.test.ts
git commit -m "feat: add useDecorations persistence hook"
```

### Task 3.5: Read-only DecorationLayer overlay

**Files:**
- Create: `src/notepad/decorations/DecorationLayer.tsx`
- Test: `src/notepad/decorations/DecorationLayer.test.tsx`

This task renders decorations only (no handles). It maps `xPct/yPx/widthPct/rotation/z` to CSS, measures content width via a ref, and calls `onSelect`/`onDeselect`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/decorations/DecorationLayer.test.tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecorationLayer } from './DecorationLayer';
import type { NoteDecoration } from '../types';

vi.mock('../styles/manifest', () => ({
  getStyleAsset: (id: string) => ({
    id, category: 'arrow', thumbUrl: 't', displayUrl: `/d/${id}.webp`, aspectRatio: 2,
  }),
}));

const deco: NoteDecoration = {
  id: 'a', assetId: 'arrow-01', xPct: 0.5, yPx: 100, widthPct: 0.2, rotation: 10, z: 3,
};

afterEach(cleanup);

describe('DecorationLayer', () => {
  it('renders an image per decoration with the display url', () => {
    const { getByTestId } = render(
      <DecorationLayer decorations={[deco]} selectedId={null} onSelect={() => {}} onDeselect={() => {}} />,
    );
    const img = getByTestId('decoration-a').querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/d/arrow-01.webp');
  });

  it('calls onSelect when a decoration is clicked', () => {
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <DecorationLayer decorations={[deco]} selectedId={null} onSelect={onSelect} onDeselect={() => {}} />,
    );
    fireEvent.mouseDown(getByTestId('decoration-a'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('calls onDeselect when the empty canvas is clicked', () => {
    const onDeselect = vi.fn();
    const { getByTestId } = render(
      <DecorationLayer decorations={[deco]} selectedId="a" onSelect={() => {}} onDeselect={onDeselect} />,
    );
    fireEvent.mouseDown(getByTestId('decoration-canvas'));
    expect(onDeselect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/decorations/DecorationLayer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/notepad/decorations/DecorationLayer.tsx
import { getStyleAsset } from '../styles/manifest';
import type { NoteDecoration } from '../types';

interface Props {
  decorations: NoteDecoration[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

export function DecorationLayer({ decorations, selectedId, onSelect, onDeselect }: Props) {
  return (
    <div
      data-testid="decoration-canvas"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDeselect();
      }}
      style={{
        position: 'absolute',
        inset: 0,
        // Let text under empty areas stay interactive; items re-enable pointers.
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {decorations.map((d) => {
        const asset = getStyleAsset(d.assetId);
        if (!asset) return null;
        return (
          <div
            key={d.id}
            data-testid={`decoration-${d.id}`}
            onMouseDown={(e) => { e.stopPropagation(); onSelect(d.id); }}
            style={{
              position: 'absolute',
              left: `${d.xPct * 100}%`,
              top: d.yPx,
              width: `${d.widthPct * 100}%`,
              transform: `rotate(${d.rotation}deg)`,
              transformOrigin: 'center center',
              zIndex: d.z,
              pointerEvents: 'auto',
              cursor: 'move',
              outline: selectedId === d.id ? '2px solid var(--deep-umber)' : 'none',
            }}
          >
            <img
              src={asset.displayUrl}
              alt=""
              draggable={false}
              style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none' }}
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/decorations/DecorationLayer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/decorations/DecorationLayer.tsx src/notepad/decorations/DecorationLayer.test.tsx
git commit -m "feat: add read-only DecorationLayer overlay"
```

### Task 3.6: Mount the overlay in the editor

**Files:**
- Modify: `src/notepad/components/Editor.tsx`

- [ ] **Step 1: Instantiate the hook + selection state after the editor is created (near line 67):**

```tsx
  const decorationsApi = useDecorations(activeNote, updateNote);
  const [selectedDecoration, setSelectedDecoration] = useState<string | null>(null);
```

- [ ] **Step 2: Render the overlay inside the inner content wrapper.** The scrollable content area is the `<div>` at `Editor.tsx:281` (it already has `position: relative`). Inside its child wrapper `<div>` at line 289 (which spans the content column), add the overlay as the **last child**, after the `{/* Editor content */}` block (after line 374):

```tsx
          <DecorationLayer
            decorations={decorationsApi.decorations}
            selectedId={selectedDecoration}
            onSelect={setSelectedDecoration}
            onDeselect={() => setSelectedDecoration(null)}
          />
```

- [ ] **Step 3: Add imports at the top of `Editor.tsx`:**

```tsx
import { useDecorations } from '../decorations/useDecorations';
import { DecorationLayer } from '../decorations/DecorationLayer';
```

- [ ] **Step 4: Verify in the browser.** Temporarily seed a decoration (e.g. via the React devtools or a throwaway button calling `decorationsApi.add({ assetId: STYLE_ASSETS.find(a=>a.category==='arrow')!.id, xPct:0.4, yPx:80, widthPct:0.2, rotation:0 })`), confirm it renders over the text, scrolls with the page, and survives reload. Remove the throwaway seed. Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/components/Editor.tsx
git commit -m "feat: mount decoration overlay in the editor"
```

---

## Phase 4 — Tray picker

A bottom drawer to browse all 288 decorations by category + search and place them. Tap places at a default position; drag drops at the pointer.

### Task 4.1: DecorationTray component

**Files:**
- Create: `src/notepad/decorations/DecorationTray.tsx`
- Test: `src/notepad/decorations/DecorationTray.test.tsx`

`filterAssets` (Task 1.4) already provides category + search filtering, so the tray is presentational. Categories shown are the five decoration categories (highlights are excluded — they live in the popover).

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/decorations/DecorationTray.test.tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecorationTray } from './DecorationTray';
import type { StyleAsset } from '../styles/manifest';

const assets: StyleAsset[] = [
  { id: 'arrow-01', category: 'arrow', thumbUrl: 'ta', displayUrl: 'da', aspectRatio: 2 },
  { id: 'shape-01', category: 'shape', thumbUrl: 'ts', displayUrl: 'ds', aspectRatio: 1 },
];

afterEach(cleanup);

describe('DecorationTray', () => {
  it('lists thumbnails for the active category', () => {
    const { getByLabelText, queryByLabelText } = render(
      <DecorationTray assets={assets} onPlace={() => {}} onClose={() => {}} />,
    );
    // Default category 'all' shows both.
    expect(getByLabelText('Place arrow-01')).toBeTruthy();
    expect(queryByLabelText('Place shape-01')).toBeTruthy();
  });

  it('filters by category pill', () => {
    const { getByText, queryByLabelText } = render(
      <DecorationTray assets={assets} onPlace={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(getByText('Arrows'));
    expect(queryByLabelText('Place arrow-01')).toBeTruthy();
    expect(queryByLabelText('Place shape-01')).toBeNull();
  });

  it('filters by search text', () => {
    const { getByLabelText, queryByLabelText } = render(
      <DecorationTray assets={assets} onPlace={() => {}} onClose={() => {}} />,
    );
    fireEvent.change(getByLabelText('Search decorations'), { target: { value: 'shape' } });
    expect(queryByLabelText('Place arrow-01')).toBeNull();
    expect(queryByLabelText('Place shape-01')).toBeTruthy();
  });

  it('calls onPlace with the asset id on tap', () => {
    const onPlace = vi.fn();
    const { getByLabelText } = render(
      <DecorationTray assets={assets} onPlace={onPlace} onClose={() => {}} />,
    );
    fireEvent.click(getByLabelText('Place arrow-01'));
    expect(onPlace).toHaveBeenCalledWith('arrow-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/decorations/DecorationTray.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/notepad/decorations/DecorationTray.tsx
import { useState } from 'react';
import { filterAssets, type StyleAsset, type StyleCategory } from '../styles/manifest';

interface Props {
  assets: StyleAsset[];
  onPlace: (assetId: string) => void;
  onClose: () => void;
}

const PILLS: { label: string; value: StyleCategory | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Shapes', value: 'shape' },
  { label: 'Arrows', value: 'arrow' },
  { label: 'Bubbles', value: 'bubble' },
  { label: 'Squiggles', value: 'squiggle' },
  { label: 'Lines', value: 'line' },
];

export function DecorationTray({ assets, onPlace, onClose }: Props) {
  const [category, setCategory] = useState<StyleCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  // Highlights live in the selection popover, not the tray.
  const decorationAssets = assets.filter((a) => a.category !== 'highlight');
  const shown = filterAssets(decorationAssets, category, query);

  return (
    <div
      role="dialog"
      aria-label="Decorations"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: 'var(--cream)', borderTop: '1px solid var(--pale-stone)',
        boxShadow: '0 -8px 22px rgba(0,0,0,.12)', padding: '8px 10px', zIndex: 70,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <input
          aria-label="Search decorations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid var(--pale-stone)', borderRadius: 6 }}
        />
        <button aria-label="Close decorations" onClick={onClose}
          style={{ fontSize: 12, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--silica)' }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, overflowX: 'auto' }}>
        {PILLS.map((p) => (
          <button
            key={p.value}
            onClick={() => setCategory(p.value)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', cursor: 'pointer',
              border: 'none',
              background: category === p.value ? 'var(--deep-umber)' : 'transparent',
              color: category === p.value ? '#fff' : 'var(--silica)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {shown.map((a) => (
          <button
            key={a.id}
            aria-label={`Place ${a.id}`}
            onClick={() => onPlace(a.id)}
            style={{ flex: '0 0 auto', width: 56, height: 56, border: '1px solid var(--pale-stone)', borderRadius: 8, background: '#fff', cursor: 'pointer', padding: 4 }}
          >
            <img src={a.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/decorations/DecorationTray.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/decorations/DecorationTray.tsx src/notepad/decorations/DecorationTray.test.tsx
git commit -m "feat: add DecorationTray bottom picker"
```

### Task 4.2: Wire the tray + a toggle button into the editor

**Files:**
- Modify: `src/notepad/components/Editor.tsx`

- [ ] **Step 1: Add tray open state (near the other decoration state, ~line 67):**

```tsx
  const [trayOpen, setTrayOpen] = useState(false);
```

- [ ] **Step 2: Add a toolbar button that toggles the tray.** In the formatting toolbar (alongside the other `ToolbarButton`s, e.g. after the underline button near line 276), add:

```tsx
          <ToolbarButton onClick={() => setTrayOpen((v) => !v)} active={trayOpen} title="Decorate">
            <Sparkles size={15} />
          </ToolbarButton>
```

Import `Sparkles` from `lucide-react` at the top (the file already imports icons from `lucide-react`).

- [ ] **Step 3: Render the tray.** Inside the scrollable content area's parent (the editor root, so the tray pins to the editor bottom), render after the content area block:

```tsx
      {trayOpen && (
        <DecorationTray
          assets={STYLE_ASSETS}
          onClose={() => setTrayOpen(false)}
          onPlace={(assetId) =>
            decorationsApi.add({ assetId, xPct: 0.4, yPx: 80, widthPct: 0.25, rotation: 0 })
          }
        />
      )}
```

- [ ] **Step 4: Add the import:**

```tsx
import { DecorationTray } from '../decorations/DecorationTray';
```

- [ ] **Step 5: Verify in the browser.** Open the tray, switch categories, search, tap a thumbnail, and confirm a decoration appears on the page and persists after reload. Capture a screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/components/Editor.tsx
git commit -m "feat: wire decoration tray into the editor"
```

---

## Phase 5 — Full manipulation

Adds drag-to-move, corner-resize, rotate, an action bar (front/back/duplicate/delete), and mobile pinch to each placed decoration. Geometry math is extracted into a pure, tested module so the interactive component stays thin.

### Task 5.1: Pure geometry helpers

**Files:**
- Create: `src/notepad/decorations/decoration-geometry.ts`
- Test: `src/notepad/decorations/decoration-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/decorations/decoration-geometry.test.ts
import { describe, it, expect } from 'vitest';
import {
  moveTo, resizeWidthPct, rotationDeg, clampDecoration,
} from './decoration-geometry';
import type { NoteDecoration } from '../types';

const d: NoteDecoration = {
  id: 'a', assetId: 'arrow-01', xPct: 0.5, yPx: 100, widthPct: 0.2, rotation: 0, z: 1,
};

describe('moveTo', () => {
  it('converts a pixel delta to a normalized x and absolute y', () => {
    // content width 1000px: +100px x → +0.1 xPct; +30px y.
    expect(moveTo(d, { dxPx: 100, dyPx: 30, contentWidth: 1000 }))
      .toMatchObject({ xPct: 0.6, yPx: 130 });
  });
});

describe('resizeWidthPct', () => {
  it('grows width from a pixel delta and clamps to [0.03, 1]', () => {
    expect(resizeWidthPct(d, { dxPx: 100, contentWidth: 1000 }).widthPct).toBeCloseTo(0.3);
    expect(resizeWidthPct({ ...d, widthPct: 0.98 }, { dxPx: 1000, contentWidth: 1000 }).widthPct).toBe(1);
    expect(resizeWidthPct({ ...d, widthPct: 0.05 }, { dxPx: -1000, contentWidth: 1000 }).widthPct).toBe(0.03);
  });
});

describe('rotationDeg', () => {
  it('normalizes an angle into [0, 360)', () => {
    expect(rotationDeg(370)).toBe(10);
    expect(rotationDeg(-10)).toBe(350);
  });
});

describe('clampDecoration', () => {
  it('keeps xPct within [0, 1] and yPx non-negative', () => {
    expect(clampDecoration({ ...d, xPct: 1.5, yPx: -20 })).toMatchObject({ xPct: 1, yPx: 0 });
    expect(clampDecoration({ ...d, xPct: -0.2 }).xPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/decorations/decoration-geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/notepad/decorations/decoration-geometry.ts
import type { NoteDecoration } from '../types';

const MIN_WIDTH_PCT = 0.03;
const MAX_WIDTH_PCT = 1;

export function moveTo(
  d: NoteDecoration,
  { dxPx, dyPx, contentWidth }: { dxPx: number; dyPx: number; contentWidth: number },
): NoteDecoration {
  return clampDecoration({
    ...d,
    xPct: d.xPct + dxPx / contentWidth,
    yPx: d.yPx + dyPx,
  });
}

export function resizeWidthPct(
  d: NoteDecoration,
  { dxPx, contentWidth }: { dxPx: number; contentWidth: number },
): NoteDecoration {
  const raw = d.widthPct + dxPx / contentWidth;
  return { ...d, widthPct: Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, raw)) };
}

export function rotationDeg(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function clampDecoration(d: NoteDecoration): NoteDecoration {
  return {
    ...d,
    xPct: Math.min(1, Math.max(0, d.xPct)),
    yPx: Math.max(0, d.yPx),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/decorations/decoration-geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/decorations/decoration-geometry.ts src/notepad/decorations/decoration-geometry.test.ts
git commit -m "feat: add pure decoration geometry helpers"
```

### Task 5.2: DecorationItem with handles + action bar

**Files:**
- Create: `src/notepad/decorations/DecorationItem.tsx`
- Test: `src/notepad/decorations/DecorationItem.test.tsx`
- Modify: `src/notepad/decorations/DecorationLayer.tsx` (render `DecorationItem` for the selected one)

`DecorationItem` owns pointer interactions. Drag/resize/rotate use the Pointer Events API (works for mouse + touch); two-pointer pinch maps to resize+rotate. Each gesture's math goes through the Task 5.1 helpers, and the resulting decoration is pushed up via `onChange` (which the host routes to `decorationsApi.update`). The action bar calls `onBringToFront`/`onSendToBack`/`onDuplicate`/`onDelete`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/decorations/DecorationItem.test.tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecorationItem } from './DecorationItem';
import type { NoteDecoration } from '../types';

vi.mock('../styles/manifest', () => ({
  getStyleAsset: (id: string) => ({
    id, category: 'arrow', thumbUrl: 't', displayUrl: `/d/${id}.webp`, aspectRatio: 2,
  }),
}));

const d: NoteDecoration = {
  id: 'a', assetId: 'arrow-01', xPct: 0.5, yPx: 100, widthPct: 0.2, rotation: 0, z: 3,
};

const handlers = () => ({
  onChange: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(),
  onDuplicate: vi.fn(), onBringToFront: vi.fn(), onSendToBack: vi.fn(),
  contentWidth: 1000,
});

afterEach(cleanup);

describe('DecorationItem', () => {
  it('shows the action bar only when selected', () => {
    const h = handlers();
    const { rerender, queryByLabelText } = render(
      <DecorationItem decoration={d} selected={false} {...h} />,
    );
    expect(queryByLabelText('Delete decoration')).toBeNull();
    rerender(<DecorationItem decoration={d} selected={true} {...h} />);
    expect(queryByLabelText('Delete decoration')).not.toBeNull();
  });

  it('fires the action-bar callbacks', () => {
    const h = handlers();
    const { getByLabelText } = render(<DecorationItem decoration={d} selected {...h} />);
    fireEvent.click(getByLabelText('Delete decoration'));
    fireEvent.click(getByLabelText('Duplicate decoration'));
    fireEvent.click(getByLabelText('Bring to front'));
    fireEvent.click(getByLabelText('Send to back'));
    expect(h.onDelete).toHaveBeenCalledWith('a');
    expect(h.onDuplicate).toHaveBeenCalledWith('a');
    expect(h.onBringToFront).toHaveBeenCalledWith('a');
    expect(h.onSendToBack).toHaveBeenCalledWith('a');
  });

  it('emits a moved decoration on body drag', () => {
    const h = handlers();
    const { getByTestId } = render(<DecorationItem decoration={d} selected {...h} />);
    const body = getByTestId('decoration-body-a');
    fireEvent.pointerDown(body, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(body, { clientX: 100, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(body, { pointerId: 1 });
    expect(h.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', xPct: expect.closeTo(0.6, 5), yPx: 130 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/decorations/DecorationItem.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/notepad/decorations/DecorationItem.tsx
import { useRef } from 'react';
import { getStyleAsset } from '../styles/manifest';
import { moveTo, resizeWidthPct, rotationDeg } from './decoration-geometry';
import type { NoteDecoration } from '../types';

interface Props {
  decoration: NoteDecoration;
  selected: boolean;
  contentWidth: number;
  onChange: (next: NoteDecoration) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
}

type Gesture = { kind: 'move' | 'resize'; startX: number; startY: number; base: NoteDecoration };

export function DecorationItem({
  decoration: d, selected, contentWidth,
  onChange, onSelect, onDelete, onDuplicate, onBringToFront, onSendToBack,
}: Props) {
  const asset = getStyleAsset(d.assetId);
  const gesture = useRef<Gesture | null>(null);

  if (!asset) return null;

  const start = (kind: Gesture['kind']) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, base: d };
    if (kind === 'move') onSelect(d.id);
  };

  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dxPx = e.clientX - g.startX;
    const dyPx = e.clientY - g.startY;
    if (g.kind === 'move') {
      onChange(moveTo(g.base, { dxPx, dyPx, contentWidth }));
    } else {
      onChange(resizeWidthPct(g.base, { dxPx, contentWidth }));
    }
  };

  const end = (e: React.PointerEvent) => {
    if ((e.target as Element).hasPointerCapture?.(e.pointerId)) {
      (e.target as Element).releasePointerCapture(e.pointerId);
    }
    gesture.current = null;
  };

  const rotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    onChange({ ...d, rotation: rotationDeg(d.rotation + 15) });
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${d.xPct * 100}%`,
        top: d.yPx,
        width: `${d.widthPct * 100}%`,
        transform: `rotate(${d.rotation}deg)`,
        transformOrigin: 'center center',
        zIndex: d.z,
        pointerEvents: 'auto',
        outline: selected ? '2px solid var(--deep-umber)' : 'none',
      }}
    >
      <div
        data-testid={`decoration-body-${d.id}`}
        onPointerDown={start('move')}
        onPointerMove={move}
        onPointerUp={end}
        style={{ cursor: 'move' }}
      >
        <img src={asset.displayUrl} alt="" draggable={false}
          style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none' }} />
      </div>

      {selected && (
        <>
          <div
            aria-label="Resize decoration"
            onPointerDown={start('resize')}
            onPointerMove={move}
            onPointerUp={end}
            style={handleStyle('-6px', '-6px', 'nwse-resize', 'bottom-right')}
          />
          <div
            aria-label="Rotate decoration"
            onPointerDown={rotate}
            style={handleStyle('-22px', 'calc(50% - 6px)', 'grab', 'top')}
          />
          <div style={{
            position: 'absolute', top: -34, left: 0, display: 'flex', gap: 4,
            background: '#fff', border: '1px solid var(--pale-stone)', borderRadius: 6,
            padding: '2px 4px', boxShadow: '0 2px 8px rgba(0,0,0,.14)',
          }}>
            <button aria-label="Bring to front" onClick={() => onBringToFront(d.id)} style={barBtn}>⤒</button>
            <button aria-label="Send to back" onClick={() => onSendToBack(d.id)} style={barBtn}>⤓</button>
            <button aria-label="Duplicate decoration" onClick={() => onDuplicate(d.id)} style={barBtn}>⎘</button>
            <button aria-label="Delete decoration" onClick={() => onDelete(d.id)} style={barBtn}>✕</button>
          </div>
        </>
      )}
    </div>
  );
}

const barBtn: React.CSSProperties = {
  fontSize: 12, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 3px', color: 'var(--charred)',
};

function handleStyle(
  top: string, right: string, cursor: string, kind: 'bottom-right' | 'top',
): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute', width: 12, height: 12, borderRadius: '50%',
    background: '#fff', border: '2px solid var(--deep-umber)', cursor,
  };
  if (kind === 'bottom-right') return { ...base, bottom: top, right };
  return { ...base, top, left: right };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/decorations/DecorationItem.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render DecorationItem for every decoration in `DecorationLayer.tsx`.** Replace the inline `<div data-testid={...}>` mapping body (Task 3.5 Step 3) so each decoration renders a `DecorationItem`, passing through the manipulation callbacks and `contentWidth`. Update `DecorationLayer`'s props to accept `onChange`, `onDelete`, `onDuplicate`, `onBringToFront`, `onSendToBack`, and `contentWidth`:

```tsx
// src/notepad/decorations/DecorationLayer.tsx
import { useRef, useEffect, useState } from 'react';
import { DecorationItem } from './DecorationItem';
import type { NoteDecoration } from '../types';

interface Props {
  decorations: NoteDecoration[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onChange: (next: NoteDecoration) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
}

export function DecorationLayer({
  decorations, selectedId, onSelect, onDeselect,
  onChange, onDelete, onDuplicate, onBringToFront, onSendToBack,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(1);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setContentWidth(entry.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-testid="decoration-canvas"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onDeselect(); }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
    >
      <div style={{ pointerEvents: 'none', position: 'absolute', inset: 0 }}>
        {decorations.map((d) => (
          <div key={d.id} style={{ pointerEvents: 'auto' }}>
            <DecorationItem
              decoration={d}
              selected={selectedId === d.id}
              contentWidth={contentWidth}
              onChange={onChange}
              onSelect={onSelect}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onBringToFront={onBringToFront}
              onSendToBack={onSendToBack}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

Update the existing `DecorationLayer.test.tsx` (Task 3.5) to pass the new no-op callback props so it still compiles. The original `getByTestId('decoration-a')` assertions become `decoration-body-a` (from `DecorationItem`); adjust those two selectors. Re-run:

Run: `npx vitest run src/notepad/decorations/DecorationLayer.test.tsx src/notepad/decorations/DecorationItem.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/decorations/DecorationItem.tsx src/notepad/decorations/DecorationItem.test.tsx src/notepad/decorations/DecorationLayer.tsx src/notepad/decorations/DecorationLayer.test.tsx
git commit -m "feat: add decoration manipulation handles and action bar"
```

### Task 5.3: Pass manipulation callbacks from the editor

**Files:**
- Modify: `src/notepad/components/Editor.tsx`

- [ ] **Step 1: Extend the `DecorationLayer` render (Task 3.6 Step 2) with the new callbacks:**

```tsx
          <DecorationLayer
            decorations={decorationsApi.decorations}
            selectedId={selectedDecoration}
            onSelect={setSelectedDecoration}
            onDeselect={() => setSelectedDecoration(null)}
            onChange={(next) => decorationsApi.update(next.id, next)}
            onDelete={(id) => { decorationsApi.remove(id); setSelectedDecoration(null); }}
            onDuplicate={(id) => decorationsApi.duplicate(id)}
            onBringToFront={(id) => decorationsApi.bringToFront(id)}
            onSendToBack={(id) => decorationsApi.sendToBack(id)}
          />
```

- [ ] **Step 2: Verify the full flow in the browser.** Place a decoration from the tray, drag it, resize via the corner handle, rotate, bring-to-front over text, duplicate, and delete. Reload and confirm the final layout persisted. On a narrow viewport (`preview_resize` to ~414px), confirm drag works via touch and the item stays positioned correctly relative to content width. Capture before/after screenshots.

- [ ] **Step 3: Run the full test suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/notepad/components/Editor.tsx
git commit -m "feat: wire decoration manipulation callbacks in the editor"
```

### Task 5.4: Mobile pinch-to-resize/rotate

Locked decision #6 specifies pinch on mobile. The single-finger drag (Task 5.2) already works on touch via Pointer Events; this task adds the two-pointer pinch that scales width and rotates simultaneously. The gesture math is a pure helper so the component stays thin.

**Files:**
- Modify: `src/notepad/decorations/decoration-geometry.ts`
- Modify: `src/notepad/decorations/decoration-geometry.test.ts`
- Modify: `src/notepad/decorations/DecorationItem.tsx`

- [ ] **Step 1: Write the failing test (append to `decoration-geometry.test.ts`)**

```ts
import { pinchTransform } from './decoration-geometry';

describe('pinchTransform', () => {
  const base: NoteDecoration = {
    id: 'a', assetId: 'arrow-01', xPct: 0.5, yPx: 100, widthPct: 0.2, rotation: 0, z: 1,
  };

  it('scales width by the distance ratio and clamps', () => {
    const out = pinchTransform(base, { startDist: 100, dist: 200, startAngle: 0, angle: 0 });
    expect(out.widthPct).toBeCloseTo(0.4); // 0.2 * 2
  });

  it('adds the angle delta to rotation, normalized', () => {
    const out = pinchTransform(base, { startDist: 100, dist: 100, startAngle: 350, angle: 20 });
    expect(out.rotation).toBe(30); // 0 + (20 - 350) = -330 → 30
  });

  it('ignores a zero start distance (no NaN)', () => {
    const out = pinchTransform(base, { startDist: 0, dist: 50, startAngle: 0, angle: 0 });
    expect(out.widthPct).toBe(base.widthPct);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/decorations/decoration-geometry.test.ts`
Expected: FAIL — `pinchTransform` not exported.

- [ ] **Step 3: Add the helper (append to `decoration-geometry.ts`)**

```ts
export function pinchTransform(
  d: NoteDecoration,
  { startDist, dist, startAngle, angle }:
    { startDist: number; dist: number; startAngle: number; angle: number },
): NoteDecoration {
  const factor = startDist > 0 ? dist / startDist : 1;
  const raw = d.widthPct * factor;
  return {
    ...d,
    widthPct: Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, raw)),
    rotation: rotationDeg(d.rotation + (angle - startAngle)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/decorations/decoration-geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire two-pointer tracking into `DecorationItem.tsx`.** Track active pointers on the body element; when a second pointer goes down, switch from drag to pinch mode capturing `startDist`/`startAngle` and the base decoration; on move with two pointers, emit `pinchTransform(...)`.

Add a pinch ref and helpers near the top of the component (after `const gesture = useRef...`):

```tsx
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ startDist: number; startAngle: number; base: NoteDecoration } | null>(null);

  const twoPointerMetrics = () => {
    const pts = [...pointers.current.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return { dist: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  };
```

Replace the body's pointer handlers so they maintain the pointer map and branch into pinch when two are active:

```tsx
      <div
        data-testid={`decoration-body-${d.id}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const m = twoPointerMetrics();
            pinch.current = { startDist: m.dist, startAngle: m.angle, base: d };
            gesture.current = null;
          } else {
            gesture.current = { kind: 'move', startX: e.clientX, startY: e.clientY, base: d };
            onSelect(d.id);
          }
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          }
          if (pinch.current && pointers.current.size >= 2) {
            const m = twoPointerMetrics();
            onChange(pinchTransform(pinch.current.base, {
              startDist: pinch.current.startDist, dist: m.dist,
              startAngle: pinch.current.startAngle, angle: m.angle,
            }));
            return;
          }
          move(e);
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          end(e);
        }}
        style={{ cursor: 'move', touchAction: 'none' }}
      >
```

Import `pinchTransform` from `./decoration-geometry` alongside the existing imports.

- [ ] **Step 6: Run the item + geometry tests**

Run: `npx vitest run src/notepad/decorations/decoration-geometry.test.ts src/notepad/decorations/DecorationItem.test.tsx`
Expected: PASS (single-finger drag test from Task 5.2 still green — one pointer never enters pinch mode).

- [ ] **Step 7: Verify on a touch viewport.** With `preview_resize` to ~414px and touch emulation, two-finger pinch on a selected decoration resizes and rotates it; release leaves the final transform persisted after reload. Capture a screenshot.

- [ ] **Step 8: Commit**

```bash
git add src/notepad/decorations/decoration-geometry.ts src/notepad/decorations/decoration-geometry.test.ts src/notepad/decorations/DecorationItem.tsx
git commit -m "feat: add mobile pinch-to-resize/rotate for decorations"
```

---

## Done criteria

- `npm run build:styles` regenerates `public/styles/**` + `src/notepad/styles/manifest.ts` deterministically.
- Selecting text shows the swatch popover; applying a swatch paints a band that reflows and persists.
- The decoration tray browses all 288 decorations by category + search; tap/drag places them.
- Placed decorations move/resize/rotate/reorder/duplicate/delete, scroll with the page, and persist across reloads on both localStorage and Supabase backends.
- `npx tsc --noEmit` and `npx vitest run` are green.
