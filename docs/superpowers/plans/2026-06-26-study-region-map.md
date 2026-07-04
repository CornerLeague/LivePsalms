# Study Region Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Map of the region" block to the Study Context pillar that shows a book's region as zoomable/pannable **Biblical times | Today** map pairs, inline and fullscreen.

**Architecture:** A new `src/notepad/study/regionmap/` module holds static in-repo map data (a period-aware region registry + an explicit 66-book→region lookup), a `useRegionMap(book)` resolver, and four React components (`RegionMapBlock` disclosure → `RegionMapView` tabs+map+caption → `ZoomableMap` lazy-wrapping `react-zoom-pan-pinch`, plus a portal-based `RegionMapFullscreen`). A single `<RegionMapBlock>` render inside `ApparatusRail` surfaces it on both desktop and mobile.

**Tech Stack:** React + TypeScript, Vite, Vitest + @testing-library/react (jsdom), lucide-react icons, `react-zoom-pan-pinch` (~5kb, lazy-loaded). Styling via inline styles + existing CSS custom properties (Study palette).

## Global Constraints

Every task's requirements implicitly include these:

- **Static data — NO Supabase migration, no network fetch.** Registry + resolver are in-repo TS.
- **Resolver is an explicit `book → regionKey` lookup**, NOT string-parsing of the free-text `bible_books.region` column.
- **Period-aware keys:** same place, different era → different "then" map (e.g. `judah-monarchy` vs `judea-roman`).
- **`book` is the lowercase OSIS abbrev** (`'jhn'`, `'lam'`, `'1ki'`) — same value `ApparatusRail` already receives. See `src/notepad/bible/bible-books.ts`.
- **Captions stay factual/historical — Lamplight voice, never interpretive or prophetic.**
- **`react-zoom-pan-pinch` is lazy-loaded** (dynamic `import()` inside `ZoomableMap`) so it never enters the initial Study-mode bundle.
- **No fabricated provenance.** Every `attribution`/`license` string must reference a real, verifiable source. Uncertain licensing/accuracy is flagged in `public/maps/ATTRIBUTION.md` and NOT shipped to prod until a human clears it.
- **Typecheck with `tsc -b`** (the real build), never bare `tsc --noEmit`.
- **Zero new errors vs the pre-existing red baseline.** Repo ships ~114 lint errors, 4 tsc errors (`force-sphere.test.ts`), and 2 failing test files (`Editor.toolbar-placement`, `garden-scene`). Do NOT gate on a green repo; gate on *adding none*.
- **Path alias:** `@/` → `src/`. New files live under `src/notepad/study/regionmap/`.
- **Commands:** test a file with `npx vitest run <path>`; typecheck with `npx tsc -b`; lint a file with `npx eslint <path>`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/notepad/study/regionmap/region-maps.ts` | Types (`MapTab`, `RegionMapKey`, `MapImage`, `RegionMap`) + `REGION_MAPS` registry (data). |
| `src/notepad/study/regionmap/book-region-map.ts` | `BOOK_TO_REGION_MAP` explicit abbrev→key lookup (data). |
| `src/notepad/study/regionmap/useRegionMap.ts` | `(book) => RegionMap \| null` resolver. |
| `src/notepad/study/regionmap/ZoomableMap.tsx` | Lazy-wraps `react-zoom-pan-pinch`; ＋/− + pinch + drag-pan + double-tap; reduced-motion aware; graceful image fallback. |
| `src/notepad/study/regionmap/RegionMapView.tsx` | Tabs + `ZoomableMap` + caption/attribution. Reused inline and in fullscreen. |
| `src/notepad/study/regionmap/RegionMapFullscreen.tsx` | Portal overlay; focus-trap, Esc/✕ close, body-scroll lock, focus restore. |
| `src/notepad/study/regionmap/RegionMapBlock.tsx` | Collapsed disclosure; owns `expanded`/`activeTab`/`fullscreen`; renders null when no map. |
| `src/notepad/study/panes/ApparatusRail.tsx` | **(modify)** render `<RegionMapBlock book={book} />` between context and cross-refs. |
| `package.json` | **(modify)** add `react-zoom-pan-pinch`. |
| `public/maps/<key>/{then,now}.jpg` + `public/maps/ATTRIBUTION.md` | Curated assets + provenance manifest. |

**Incremental-coverage design (important):** `RegionMapKey` is a union of the keys that are *actually sourced and shipped*; `REGION_MAPS: Record<RegionMapKey, RegionMap>` stays exhaustive over that union; `BOOK_TO_REGION_MAP` only maps books whose region is in the union. Books not yet covered resolve to `null` and the block simply doesn't render (spec-sanctioned). Tasks 1–7 ship the full code path against a real **seed set** (`judah-monarchy`, `judea-roman`); Task 8 sources binaries and grows coverage toward the 12-key target table in the spec. This keeps the integrity invariant ("every `BOOK_TO_REGION_MAP` value exists in `REGION_MAPS`") true at every step with zero placeholders.

---

### Task 1: Region map data — types + registry + integrity test

**Files:**
- Create: `src/notepad/study/regionmap/region-maps.ts`
- Test: `src/notepad/study/regionmap/region-maps.test.ts`

**Interfaces:**
- Produces: `type MapTab = 'then' | 'now'`; `type RegionMapKey` (union); `interface MapImage { src; alt; caption; attribution; license }`; `interface RegionMap { key; label; then; now }`; `const REGION_MAPS: Record<RegionMapKey, RegionMap>`.

- [ ] **Step 1: Write the failing integrity test**

```ts
// src/notepad/study/regionmap/region-maps.test.ts
import { describe, it, expect } from 'vitest';
import { REGION_MAPS } from './region-maps';

describe('REGION_MAPS registry integrity', () => {
  it('has at least the seed regions', () => {
    expect(REGION_MAPS['judah-monarchy']).toBeDefined();
    expect(REGION_MAPS['judea-roman']).toBeDefined();
  });

  it('every region has complete then/now image metadata and a matching key', () => {
    for (const [key, region] of Object.entries(REGION_MAPS)) {
      expect(region.key).toBe(key);
      expect(region.label.length).toBeGreaterThan(0);
      for (const tab of ['then', 'now'] as const) {
        const img = region[tab];
        expect(img.src, `${key}.${tab}.src`).toMatch(/^\/maps\/[a-z0-9-]+\/(then|now)\.(jpg|png|webp)$/);
        expect(img.alt.length, `${key}.${tab}.alt`).toBeGreaterThan(0);
        expect(img.caption.length, `${key}.${tab}.caption`).toBeGreaterThan(0);
        expect(img.attribution.length, `${key}.${tab}.attribution`).toBeGreaterThan(0);
        expect(img.license.length, `${key}.${tab}.license`).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/regionmap/region-maps.test.ts`
Expected: FAIL — cannot resolve `./region-maps`.

- [ ] **Step 3: Write the registry**

```ts
// src/notepad/study/regionmap/region-maps.ts
// Static, curated, in-repo map data for the Study "Region Map" block.
// No Supabase, no migration, no network fetch. Captions are factual/historical
// only (Lamplight voice — never interpretive or prophetic).

export type MapTab = 'then' | 'now';

// Period-aware region keys. This union holds the keys that are actually sourced
// and shipped; it grows (toward the spec's 12-key target) as art is sourced in
// the asset task. Books whose region is not yet here resolve to null.
export type RegionMapKey = 'judah-monarchy' | 'judea-roman';

export interface MapImage {
  src: string;          // '/maps/judah-monarchy/then.jpg' (served from public/)
  alt: string;          // descriptive alt text
  caption: string;      // factual, non-interpretive
  attribution: string;  // real, verifiable source
  license: string;      // e.g. 'Public Domain', 'CC BY-SA 4.0'
}

export interface RegionMap {
  key: RegionMapKey;
  label: string;        // 'Kingdom of Judah'
  then: MapImage;
  now: MapImage;
}

export const REGION_MAPS: Record<RegionMapKey, RegionMap> = {
  'judah-monarchy': {
    key: 'judah-monarchy',
    label: 'Kingdom of Judah',
    then: {
      src: '/maps/judah-monarchy/then.jpg',
      alt: 'Historical map of the Kingdom of Judah and the route of the Babylonian exile, c. 586 BC.',
      caption: 'The Kingdom of Judah and the route of the exile to Babylon, c. 586 BC.',
      attribution: 'George Adam Smith, Atlas of the Historical Geography of the Holy Land (1915)',
      license: 'Public Domain',
    },
    now: {
      src: '/maps/judah-monarchy/now.jpg',
      alt: 'Modern reference map of the southern Levant: Israel, the West Bank, and western Jordan.',
      caption: 'The same region today — the southern Levant.',
      attribution: 'Wikimedia Commons (modern reference map)',
      license: 'Pending human review',
    },
  },
  'judea-roman': {
    key: 'judea-roman',
    label: 'Roman Judea & Galilee',
    then: {
      src: '/maps/judea-roman/then.jpg',
      alt: 'Historical map of Roman Judea and Galilee in the first century AD.',
      caption: 'Roman Judea and Galilee in the first century AD.',
      attribution: 'George Adam Smith, Atlas of the Historical Geography of the Holy Land (1915)',
      license: 'Public Domain',
    },
    now: {
      src: '/maps/judea-roman/now.jpg',
      alt: 'Modern reference map of Israel, the West Bank, and southern Lebanon.',
      caption: 'The same region today.',
      attribution: 'Wikimedia Commons (modern reference map)',
      license: 'Pending human review',
    },
  },
};
```

> Note: `license: 'Pending human review'` is a real, honest status (not a placeholder for the integrity test — it's a non-empty, truthful value flagging that Task 8 must verify the modern-map license before prod). The "then" entries cite a genuinely public-domain 1915 atlas.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/regionmap/region-maps.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b` (expect no NEW errors beyond the known baseline).

```bash
git add src/notepad/study/regionmap/region-maps.ts src/notepad/study/regionmap/region-maps.test.ts
git commit -m "feat(study): region-map data registry + integrity test"
```

---

### Task 2: Book→region resolver — lookup table + `useRegionMap`

**Files:**
- Create: `src/notepad/study/regionmap/book-region-map.ts`
- Create: `src/notepad/study/regionmap/useRegionMap.ts`
- Test: `src/notepad/study/regionmap/useRegionMap.test.ts`

**Interfaces:**
- Consumes: `RegionMapKey`, `RegionMap`, `REGION_MAPS` from Task 1.
- Produces: `const BOOK_TO_REGION_MAP: Partial<Record<string, RegionMapKey>>`; `function useRegionMap(book: string): RegionMap | null`.

- [ ] **Step 1: Write the failing resolver test**

```ts
// src/notepad/study/regionmap/useRegionMap.test.ts
import { describe, it, expect } from 'vitest';
import { useRegionMap } from './useRegionMap';
import { BOOK_TO_REGION_MAP } from './book-region-map';
import { REGION_MAPS } from './region-maps';

describe('useRegionMap', () => {
  it('resolves a Gospel to Roman Judea', () => {
    expect(useRegionMap('jhn')?.key).toBe('judea-roman');
    expect(useRegionMap('mat')?.key).toBe('judea-roman');
  });

  it('resolves Lamentations and Kings to the Kingdom of Judah', () => {
    expect(useRegionMap('lam')?.key).toBe('judah-monarchy');
    expect(useRegionMap('1ki')?.key).toBe('judah-monarchy');
  });

  it('returns null for an unmapped book or unknown abbrev', () => {
    expect(useRegionMap('jas')).toBeNull();
    expect(useRegionMap('zzz')).toBeNull();
  });
});

describe('BOOK_TO_REGION_MAP integrity', () => {
  it('every mapped value resolves to a registered region', () => {
    for (const [book, key] of Object.entries(BOOK_TO_REGION_MAP)) {
      expect(REGION_MAPS[key as keyof typeof REGION_MAPS], `${book} -> ${key}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/regionmap/useRegionMap.test.ts`
Expected: FAIL — cannot resolve `./useRegionMap`.

- [ ] **Step 3: Write the lookup table**

```ts
// src/notepad/study/regionmap/book-region-map.ts
// Explicit book(abbrev) -> region-key lookup. Deliberately NOT parsed from the
// free-text bible_books.region column. Books absent here resolve to null (no map).
// Keys are OSIS-style abbrevs from src/notepad/bible/bible-books.ts.
// Grows alongside REGION_MAPS as more regions are sourced (see asset task).
import type { RegionMapKey } from './region-maps';

export const BOOK_TO_REGION_MAP: Partial<Record<string, RegionMapKey>> = {
  // Kingdom of Judah (monarchy / exile era)
  '1ki': 'judah-monarchy',
  '2ki': 'judah-monarchy',
  '1ch': 'judah-monarchy',
  '2ch': 'judah-monarchy',
  lam: 'judah-monarchy',

  // Roman Judea & Galilee (Gospels)
  mat: 'judea-roman',
  mrk: 'judea-roman',
  luk: 'judea-roman',
  jhn: 'judea-roman',
};
```

- [ ] **Step 4: Write the resolver**

```ts
// src/notepad/study/regionmap/useRegionMap.ts
// Pure resolver (named use* by convention; calls no hooks). Maps a book abbrev
// to its curated RegionMap, or null when the book has no mapped region.
import { BOOK_TO_REGION_MAP } from './book-region-map';
import { REGION_MAPS, type RegionMap } from './region-maps';

export function useRegionMap(book: string): RegionMap | null {
  const key = BOOK_TO_REGION_MAP[book];
  if (!key) return null;
  return REGION_MAPS[key] ?? null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/regionmap/useRegionMap.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b`

```bash
git add src/notepad/study/regionmap/book-region-map.ts src/notepad/study/regionmap/useRegionMap.ts src/notepad/study/regionmap/useRegionMap.test.ts
git commit -m "feat(study): explicit book->region resolver for region maps"
```

---

### Task 3: `ZoomableMap` — lazy zoom/pan wrapper + dependency

**Files:**
- Create: `src/notepad/study/regionmap/ZoomableMap.tsx`
- Test: `src/notepad/study/regionmap/ZoomableMap.test.tsx`
- Modify: `package.json` (add `react-zoom-pan-pinch`)

**Interfaces:**
- Consumes: `MapImage` from Task 1; `usePrefersReducedMotion` from `@/hooks/use-prefers-reduced-motion`.
- Produces: `function ZoomableMap(props: { image: MapImage; height: number | string; overlayTopRight?: React.ReactNode })`.

- [ ] **Step 1: Install the dependency**

Run: `npm install react-zoom-pan-pinch`
Expected: `package.json` dependencies now include `react-zoom-pan-pinch`; lockfile updated.

- [ ] **Step 2: Write the failing test**

```tsx
// src/notepad/study/regionmap/ZoomableMap.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the lazy-loaded library so the dynamic import resolves deterministically.
vi.mock('react-zoom-pan-pinch', () => ({
  TransformWrapper: ({ children }: { children: unknown }) => (
    <div>{typeof children === 'function' ? (children as (r: { zoomIn: () => void; zoomOut: () => void }) => unknown)({ zoomIn: () => {}, zoomOut: () => {} }) : (children as React.ReactNode)}</div>
  ),
  TransformComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ZoomableMap } from './ZoomableMap';

const image = { src: '/maps/judea-roman/then.jpg', alt: 'A map of Roman Judea', caption: 'c', attribution: 'a', license: 'Public Domain' };

describe('ZoomableMap', () => {
  it('renders the image with its alt text', async () => {
    render(<ZoomableMap image={image} height={210} />);
    expect(await screen.findByAltText('A map of Roman Judea')).toBeTruthy();
  });

  it('shows a fallback when the image fails to load', async () => {
    render(<ZoomableMap image={image} height={210} />);
    fireEvent.error(await screen.findByAltText('A map of Roman Judea'));
    expect(screen.getByText(/unavailable/i)).toBeTruthy();
  });

  it('renders an overlay slot when provided', async () => {
    render(<ZoomableMap image={image} height={210} overlayTopRight={<button>EXPANDO</button>} />);
    expect(await screen.findByText('EXPANDO')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/regionmap/ZoomableMap.test.tsx`
Expected: FAIL — cannot resolve `./ZoomableMap`.

- [ ] **Step 4: Write the component**

```tsx
// src/notepad/study/regionmap/ZoomableMap.tsx
import { useEffect, useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { MapImage } from './region-maps';

// Type-only import is erased at build → does not pull the lib into the bundle.
type RZPPModule = typeof import('react-zoom-pan-pinch');

export interface ZoomableMapProps {
  image: MapImage;
  height: number | string;
  overlayTopRight?: React.ReactNode;
}

const zoomBtn: React.CSSProperties = {
  width: 28, height: 28, background: '#fff', border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--deep-umber)',
};

export function ZoomableMap({ image, height, overlayTopRight }: ZoomableMapProps) {
  const reduced = usePrefersReducedMotion();
  const [rzpp, setRzpp] = useState<RZPPModule | null>(null);
  const [failed, setFailed] = useState(false);

  // Lazy-load react-zoom-pan-pinch only when a map is actually shown.
  useEffect(() => {
    let active = true;
    import('react-zoom-pan-pinch').then((m) => { if (active) setRzpp(m); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const img = (
    <img
      src={image.src}
      alt={image.alt}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );

  return (
    <div style={{ position: 'relative', height, background: 'var(--pale-stone)', overflow: 'hidden' }}>
      {failed ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--silica)', fontStyle: 'italic' }}>
          Map image unavailable.
        </div>
      ) : rzpp ? (
        <rzpp.TransformWrapper
          initialScale={1}
          minScale={1}
          maxScale={5}
          doubleClick={{ animationTime: reduced ? 0 : 200 }}
          wheel={{ step: 0.2 }}
        >
          {({ zoomIn, zoomOut }) => (
            <>
              <rzpp.TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
                {img}
              </rzpp.TransformComponent>
              <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.25)', zIndex: 2 }}>
                <button type="button" aria-label="Zoom in" onClick={() => zoomIn(undefined, reduced ? 0 : 200)} style={zoomBtn}><Plus className="w-4 h-4" /></button>
                <button type="button" aria-label="Zoom out" onClick={() => zoomOut(undefined, reduced ? 0 : 200)} style={{ ...zoomBtn, borderTop: '1px solid #eee' }}><Minus className="w-4 h-4" /></button>
              </div>
            </>
          )}
        </rzpp.TransformWrapper>
      ) : (
        img
      )}
      {overlayTopRight && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>{overlayTopRight}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/regionmap/ZoomableMap.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b` (if `react-zoom-pan-pinch` ships its own types this is clean; if a `Cannot find module` type error appears, confirm `@types` are bundled — v3 ships types).

```bash
git add src/notepad/study/regionmap/ZoomableMap.tsx src/notepad/study/regionmap/ZoomableMap.test.tsx package.json package-lock.json
git commit -m "feat(study): lazy ZoomableMap wrapping react-zoom-pan-pinch"
```

---

### Task 4: `RegionMapView` — tabs + map + caption

**Files:**
- Create: `src/notepad/study/regionmap/RegionMapView.tsx`
- Test: `src/notepad/study/regionmap/RegionMapView.test.tsx`

**Interfaces:**
- Consumes: `RegionMap`, `MapTab` from Task 1; `ZoomableMap` from Task 3.
- Produces: `function RegionMapView(props: { map: RegionMap; activeTab: MapTab; onTabChange: (t: MapTab) => void; onExpand?: () => void; trailing?: React.ReactNode; variant?: 'inline' | 'fullscreen' })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/study/regionmap/RegionMapView.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

vi.mock('./ZoomableMap', () => ({
  ZoomableMap: ({ image, overlayTopRight }: { image: { src: string; alt: string }; overlayTopRight?: React.ReactNode }) => (
    <div><img src={image.src} alt={image.alt} />{overlayTopRight}</div>
  ),
}));

import { RegionMapView } from './RegionMapView';
import type { RegionMap, MapTab } from './region-maps';

const map: RegionMap = {
  key: 'judea-roman',
  label: 'Roman Judea & Galilee',
  then: { src: '/maps/judea-roman/then.jpg', alt: 'Roman Judea, first century', caption: 'Roman Judea and Galilee in the first century AD.', attribution: 'Smith 1915', license: 'Public Domain' },
  now: { src: '/maps/judea-roman/now.jpg', alt: 'Modern Israel reference map', caption: 'The same region today.', attribution: 'Wikimedia', license: 'Pending human review' },
};

function Harness() {
  const [tab, setTab] = useState<MapTab>('then');
  return <RegionMapView map={map} activeTab={tab} onTabChange={setTab} />;
}

describe('RegionMapView', () => {
  it('swaps the image and caption when the Today tab is selected', () => {
    render(<Harness />);
    expect(screen.getByAltText('Roman Judea, first century')).toBeTruthy();
    expect(screen.getByText('Roman Judea and Galilee in the first century AD.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    expect(screen.getByAltText('Modern Israel reference map')).toBeTruthy();
    expect(screen.getByText('The same region today.')).toBeTruthy();
  });

  it('exposes both tabs with correct aria-selected state', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Biblical times' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('false');
  });

  it('fires onExpand from the expand button when provided', () => {
    const onExpand = vi.fn();
    render(<RegionMapView map={map} activeTab="then" onTabChange={() => {}} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button', { name: /expand map/i }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/regionmap/RegionMapView.test.tsx`
Expected: FAIL — cannot resolve `./RegionMapView`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/regionmap/RegionMapView.tsx
import { Maximize2 } from 'lucide-react';
import { ZoomableMap } from './ZoomableMap';
import type { MapTab, RegionMap } from './region-maps';

export interface RegionMapViewProps {
  map: RegionMap;
  activeTab: MapTab;
  onTabChange: (tab: MapTab) => void;
  onExpand?: () => void;          // inline → renders the ⤢ button over the map
  trailing?: React.ReactNode;     // fullscreen → ✕ at the end of the tab row
  variant?: 'inline' | 'fullscreen';
}

const TABS: { id: MapTab; label: string }[] = [
  { id: 'then', label: 'Biblical times' },
  { id: 'now', label: 'Today' },
];

const expandBtn: React.CSSProperties = {
  width: 26, height: 26, background: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--deep-umber)',
  boxShadow: '0 1px 3px rgba(0,0,0,.25)',
};

export function RegionMapView({ map, activeTab, onTabChange, onExpand, trailing, variant = 'inline' }: RegionMapViewProps) {
  const image = map[activeTab];
  const fullscreen = variant === 'fullscreen';

  function onTabKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onTabChange(activeTab === 'then' ? 'now' : 'then');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: fullscreen ? '100%' : 'auto' }}>
      <div role="tablist" aria-label="Map era" style={{ display: 'flex', alignItems: 'stretch' }}>
        {TABS.map((t) => {
          const selected = t.id === activeTab;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(t.id)}
              onKeyDown={onTabKeyDown}
              style={{
                flex: 1, textAlign: 'center', fontSize: 11, padding: 7, cursor: 'pointer', border: 'none',
                fontWeight: selected ? 600 : 400,
                background: selected ? 'var(--lamplight-accent)' : fullscreen ? 'rgba(255,255,255,.15)' : '#efe7d6',
                color: selected ? '#fff' : fullscreen ? '#e8e0d2' : 'var(--silica)',
              }}
            >
              {t.label}
            </button>
          );
        })}
        {trailing}
      </div>

      <div style={{ flex: fullscreen ? 1 : 'none', minHeight: 0 }}>
        <ZoomableMap
          image={image}
          height={fullscreen ? '100%' : 210}
          overlayTopRight={!fullscreen && onExpand ? (
            <button type="button" aria-label="Expand map to fullscreen" onClick={onExpand} style={expandBtn}>
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          ) : undefined}
        />
      </div>

      <div style={{ padding: fullscreen ? '10px 14px' : '8px 10px', background: fullscreen ? 'rgba(0,0,0,.55)' : 'transparent' }}>
        <div style={{ fontSize: 11, fontStyle: 'italic', lineHeight: 1.5, color: fullscreen ? '#f4efe4' : '#5a4f3c' }}>{image.caption}</div>
        {!fullscreen && (
          <div style={{ fontSize: 9, color: '#a89f90', marginTop: 4 }}>{image.attribution} · {image.license}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/regionmap/RegionMapView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b`

```bash
git add src/notepad/study/regionmap/RegionMapView.tsx src/notepad/study/regionmap/RegionMapView.test.tsx
git commit -m "feat(study): RegionMapView tabs + map + caption"
```

---

### Task 5: `RegionMapFullscreen` — portal overlay

**Files:**
- Create: `src/notepad/study/regionmap/RegionMapFullscreen.tsx`
- Test: `src/notepad/study/regionmap/RegionMapFullscreen.test.tsx`

**Interfaces:**
- Consumes: `RegionMap`, `MapTab` from Task 1; `RegionMapView` from Task 4.
- Produces: `function RegionMapFullscreen(props: { map: RegionMap; activeTab: MapTab; onTabChange: (t: MapTab) => void; onClose: () => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/study/regionmap/RegionMapFullscreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./ZoomableMap', () => ({
  ZoomableMap: ({ image }: { image: { src: string; alt: string } }) => <img src={image.src} alt={image.alt} />,
}));

import { RegionMapFullscreen } from './RegionMapFullscreen';
import type { RegionMap } from './region-maps';

const map: RegionMap = {
  key: 'judea-roman',
  label: 'Roman Judea & Galilee',
  then: { src: '/maps/judea-roman/then.jpg', alt: 'Roman Judea, first century', caption: 'Roman Judea.', attribution: 'Smith 1915', license: 'Public Domain' },
  now: { src: '/maps/judea-roman/now.jpg', alt: 'Modern Israel reference map', caption: 'Today.', attribution: 'Wikimedia', license: 'Pending human review' },
};

describe('RegionMapFullscreen', () => {
  it('renders a modal dialog containing the map', () => {
    render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByAltText('Roman Judea, first century')).toBeTruthy();
  });

  it('closes via the ✕ button', () => {
    const onClose = vi.fn();
    render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close fullscreen/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the Escape key', () => {
    const onClose = vi.fn();
    render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks body scroll while open and restores it on close', () => {
    const { unmount } = render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/regionmap/RegionMapFullscreen.test.tsx`
Expected: FAIL — cannot resolve `./RegionMapFullscreen`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/regionmap/RegionMapFullscreen.tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { RegionMapView } from './RegionMapView';
import type { MapTab, RegionMap } from './region-maps';

export interface RegionMapFullscreenProps {
  map: RegionMap;
  activeTab: MapTab;
  onTabChange: (tab: MapTab) => void;
  onClose: () => void;
}

const closeBtn: React.CSSProperties = {
  width: 28, height: 28, marginLeft: 'auto', background: 'rgba(255,255,255,.15)', color: '#fff',
  border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export function RegionMapFullscreen({ map, activeTab, onTabChange, onClose }: RegionMapFullscreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Tab') {
        const nodes = overlayRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Map of ${map.label}`}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#2a2620', display: 'flex', flexDirection: 'column' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <RegionMapView
        map={map}
        activeTab={activeTab}
        onTabChange={onTabChange}
        variant="fullscreen"
        trailing={
          <button ref={closeRef} type="button" aria-label="Close fullscreen map" onClick={onClose} style={closeBtn}>
            <X className="w-4 h-4" />
          </button>
        }
      />
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/regionmap/RegionMapFullscreen.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b`

```bash
git add src/notepad/study/regionmap/RegionMapFullscreen.tsx src/notepad/study/regionmap/RegionMapFullscreen.test.tsx
git commit -m "feat(study): fullscreen region-map portal overlay"
```

---

### Task 6: `RegionMapBlock` — the disclosure

**Files:**
- Create: `src/notepad/study/regionmap/RegionMapBlock.tsx`
- Test: `src/notepad/study/regionmap/RegionMapBlock.test.tsx`

**Interfaces:**
- Consumes: `useRegionMap` (Task 2), `RegionMapView` (Task 4), `RegionMapFullscreen` (Task 5), `MapTab` (Task 1).
- Produces: `function RegionMapBlock(props: { book: string })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/study/regionmap/RegionMapBlock.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useRegionMap = vi.fn();
vi.mock('./useRegionMap', () => ({ useRegionMap: (b: string) => useRegionMap(b) }));
vi.mock('./ZoomableMap', () => ({
  ZoomableMap: ({ image }: { image: { src: string; alt: string } }) => <img src={image.src} alt={image.alt} />,
}));

import { RegionMapBlock } from './RegionMapBlock';
import type { RegionMap } from './region-maps';

const map: RegionMap = {
  key: 'judea-roman',
  label: 'Roman Judea & Galilee',
  then: { src: '/maps/judea-roman/then.jpg', alt: 'Roman Judea, first century', caption: 'Roman Judea.', attribution: 'Smith 1915', license: 'Public Domain' },
  now: { src: '/maps/judea-roman/now.jpg', alt: 'Modern Israel reference map', caption: 'Today.', attribution: 'Wikimedia', license: 'Pending human review' },
};

describe('RegionMapBlock', () => {
  it('renders nothing for an unmapped book', () => {
    useRegionMap.mockReturnValue(null);
    const { container } = render(<RegionMapBlock book="jas" />);
    expect(container.firstChild).toBeNull();
  });

  it('is collapsed by default and expands on click', () => {
    useRegionMap.mockReturnValue(map);
    render(<RegionMapBlock book="jhn" />);
    const toggle = screen.getByRole('button', { name: /map of the region/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('opens fullscreen and restores focus to the expand trigger on close', () => {
    useRegionMap.mockReturnValue(map);
    render(<RegionMapBlock book="jhn" />);
    fireEvent.click(screen.getByRole('button', { name: /map of the region/i }));
    const expand = screen.getByRole('button', { name: /expand map/i });
    expand.focus();
    fireEvent.click(expand);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(expand);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/regionmap/RegionMapBlock.test.tsx`
Expected: FAIL — cannot resolve `./RegionMapBlock`.

- [ ] **Step 3: Write the component**

```tsx
// src/notepad/study/regionmap/RegionMapBlock.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useRegionMap } from './useRegionMap';
import { RegionMapView } from './RegionMapView';
import { RegionMapFullscreen } from './RegionMapFullscreen';
import type { MapTab } from './region-maps';

export interface RegionMapBlockProps {
  book: string;
}

export function RegionMapBlock({ book }: RegionMapBlockProps) {
  const map = useRegionMap(book);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<MapTab>('then');
  const [fullscreen, setFullscreen] = useState(false);

  if (!map) return null;

  return (
    <section style={{ marginBottom: 24, borderTop: '1px solid var(--pale-stone)', paddingTop: 16 }}>
      <button
        type="button"
        onClick={() => setExpanded((o) => !o)}
        aria-expanded={expanded}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />
          : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />}
        <span style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--silica)' }}>Map of the region</span>
      </button>

      {expanded && (
        <div style={{ marginTop: 10, border: '1px solid var(--pale-stone)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <RegionMapView
            map={map}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onExpand={() => setFullscreen(true)}
          />
        </div>
      )}

      {fullscreen && (
        <RegionMapFullscreen
          map={map}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={() => setFullscreen(false)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/regionmap/RegionMapBlock.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b`

```bash
git add src/notepad/study/regionmap/RegionMapBlock.tsx src/notepad/study/regionmap/RegionMapBlock.test.tsx
git commit -m "feat(study): RegionMapBlock disclosure with fullscreen"
```

---

### Task 7: Integrate into `ApparatusRail`

**Files:**
- Modify: `src/notepad/study/panes/ApparatusRail.tsx`
- Modify: `src/notepad/study/panes/ApparatusRail.test.tsx`

**Interfaces:**
- Consumes: `RegionMapBlock` (Task 6).

- [ ] **Step 1: Add the failing integration test**

Add a module mock + a test to `src/notepad/study/panes/ApparatusRail.test.tsx`. Insert the mock alongside the existing mocks (after the `OriginalLanguagePanel` mock, before `import { ApparatusRail }`):

```tsx
const regionMapBlock = vi.fn();
vi.mock('../regionmap/RegionMapBlock', () => ({
  RegionMapBlock: (props: { book: string }) => { regionMapBlock(props); return <div data-testid="region-map-block" />; },
}));
```

Add this test inside the first `describe('ApparatusRail', ...)` block:

```tsx
it('renders the region map block between book context and cross-references', () => {
  regionMapBlock.mockClear();
  useApparatus.mockReturnValue({
    book: { full_name: 'Lamentations', author: 'Jeremiah', author_note: '', date_label: '~586 BC', region: 'Judah', cultural_context: '', genre: 'Lament', summary: 'Grief over fallen Jerusalem.' },
    crossRefs: [{ to_book: 'mat', to_chapter: 1, to_verse_start: 1, to_verse_end: 1, votes: 1, crossesTestament: true, text: 't' }],
    loading: false, error: null,
  });
  render(<ApparatusRail book="lam" chapter={1} />);
  expect(regionMapBlock).toHaveBeenCalledWith({ book: 'lam' });
  const heading = screen.getByRole('heading', { level: 2, name: 'Lamentations' });
  const block = screen.getByTestId('region-map-block');
  const xrefs = screen.getByRole('heading', { level: 3, name: 'CROSS-REFERENCES' });
  // DOM order: context heading → region map block → cross-references heading
  expect(heading.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(block.compareDocumentPosition(xrefs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/panes/ApparatusRail.test.tsx`
Expected: FAIL — `region-map-block` testid not found (RegionMapBlock not yet rendered).

- [ ] **Step 3: Wire `RegionMapBlock` into `ApparatusRail`**

Add the import near the top of `src/notepad/study/panes/ApparatusRail.tsx` (after the `OriginalLanguagePanel` import):

```tsx
import { RegionMapBlock } from '../regionmap/RegionMapBlock';
```

Insert `<RegionMapBlock book={book} />` between the book-context `</section>` and the cross-references `<section>`. The edit — the closing of the context block (currently lines 47-48) followed by the cross-refs block — becomes:

```tsx
        </section>
      )}

      <RegionMapBlock book={book} />

      {!loading && !error && crossRefs.length > 0 && (
        <section>
          <h3 style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)', margin: '0 0 8px' }}>CROSS-REFERENCES</h3>
```

(`RegionMapBlock` returns `null` when the book has no mapped region, so it is safe to render unconditionally and independent of `loading`/`ctx`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/panes/ApparatusRail.test.tsx`
Expected: PASS (all existing tests + the new ordering test).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b`

```bash
git add src/notepad/study/panes/ApparatusRail.tsx src/notepad/study/panes/ApparatusRail.test.tsx
git commit -m "feat(study): surface region map in the Context pillar"
```

---

### Task 8: Source assets + provenance manifest + expand coverage

> This is the one task with an external/manual component and a **human review gate**. It produces the actual image binaries and finalizes provenance; the code already degrades gracefully (`ZoomableMap` shows "Map image unavailable." until binaries exist), so Tasks 1–7 are demoable before this completes.

**Files:**
- Create: `public/maps/judah-monarchy/then.jpg`, `public/maps/judah-monarchy/now.jpg`
- Create: `public/maps/judea-roman/then.jpg`, `public/maps/judea-roman/now.jpg`
- Create: `public/maps/ATTRIBUTION.md`
- Modify (coverage expansion): `src/notepad/study/regionmap/region-maps.ts`, `src/notepad/study/regionmap/book-region-map.ts`

- [ ] **Step 1: Source the seed "then" maps (public domain).** Locate the relevant plates from a verified public-domain Bible atlas (George Adam Smith, *Atlas of the Historical Geography of the Holy Land*, 1915, or an equivalent pre-1929 US-PD work) via Wikimedia Commons. Download the Kingdom-of-Judah / exile plate → `public/maps/judah-monarchy/then.jpg`, and the Roman-Judea/Galilee plate → `public/maps/judea-roman/then.jpg`. Confirm publication date establishes public domain.

- [ ] **Step 2: Source the seed "now" maps (openly licensed).** Obtain modern reference maps of the southern Levant from an openly-licensed source (Wikimedia Commons CC0/CC-BY, or an OpenStreetMap-derived export with attribution). Save as `now.jpg` per region. Record the exact license; if it cannot be confirmed, leave the registry's `license: 'Pending human review'` and flag the image in the manifest.

- [ ] **Step 3: Write `public/maps/ATTRIBUTION.md`.** One entry per image: region key, tab, source URL, author/work, license, and a ✅/⚠️ review flag. Example row:

```markdown
## judah-monarchy
- **then** — `public/maps/judah-monarchy/then.jpg`
  - Source: <Wikimedia Commons URL>
  - Work: George Adam Smith, *Atlas of the Historical Geography of the Holy Land* (1915)
  - License: Public Domain (published 1915) ✅
- **now** — `public/maps/judah-monarchy/now.jpg`
  - Source: <URL>
  - License: <CC0 / CC BY 4.0 / Pending human review ⚠️>
```

- [ ] **Step 4: Reconcile registry metadata with the sourced files.** Update any `attribution`/`license`/`alt`/`caption` strings in `region-maps.ts` to match the actual files. Keep captions factual/historical (Lamplight voice).

- [ ] **Step 5: (Optional, repeat per region) Expand coverage** toward the spec's 12-key target table. For each new region: add its key to the `RegionMapKey` union, add a complete `REGION_MAPS` entry, source its two images + manifest rows, and add its books to `BOOK_TO_REGION_MAP`. The integrity tests (Tasks 1–2) automatically validate each addition — run them after each region.

- [ ] **Step 6: Run the data tests + typecheck.**

Run: `npx vitest run src/notepad/study/regionmap/region-maps.test.ts src/notepad/study/regionmap/useRegionMap.test.ts`
Run: `npx tsc -b`
Expected: PASS; no new errors.

- [ ] **Step 7: Commit.**

```bash
git add public/maps src/notepad/study/regionmap/region-maps.ts src/notepad/study/regionmap/book-region-map.ts
git commit -m "feat(study): region-map assets + provenance manifest (seed regions)"
```

- [ ] **Step 8: HUMAN REVIEW GATE.** Before prod: a human verifies every image's license and geographic accuracy against `ATTRIBUTION.md`. Any ⚠️-flagged image is removed from `REGION_MAPS`/`BOOK_TO_REGION_MAP` (those books fall back to no-map) until cleared.

---

## Final Verification (before requesting review / PR)

- [ ] **Run the full region-map suite:** `npx vitest run src/notepad/study/regionmap src/notepad/study/panes/ApparatusRail.test.tsx` → all green.
- [ ] **Typecheck the build:** `npx tsc -b` → confirm the only errors are the known baseline (`force-sphere.test.ts`); zero new.
- [ ] **Lint the new files:** `npx eslint src/notepad/study/regionmap src/notepad/study/panes/ApparatusRail.tsx` → zero new errors.
- [ ] **Manual smoke (desktop + mobile):** open Study mode on Lamentations (or John) → confirm the collapsed "Map of the region" row appears under book context and above cross-references; expands; tabs swap; zoom/pan works; ⤢ opens fullscreen; Esc/✕ close and restore focus. Confirm an unmapped book (e.g. James) shows no block.
- [ ] **Verify lazy-load:** confirm `react-zoom-pan-pinch` is in a separate chunk (not the initial Study bundle) via the build output.
- [ ] Use **superpowers:verification-before-completion** then **superpowers:requesting-code-review** before opening the PR.

## Self-Review (completed against the spec)

- **Placement / appears on desktop + mobile via single edit** → Task 7. ✅
- **Collapsed default; renders null when unmapped** → Task 6 (tests). ✅
- **Two tabs swap image + caption; persists while mounted** → Task 4 (test) + Task 6 (state owner). ✅
- **ZoomableMap: ＋/− + pinch + drag-pan + double-tap, lazy-loaded, reduced-motion** → Task 3. ✅
- **Fullscreen: portal, focus-trap, Esc/✕, body-scroll lock, focus restore, aria-modal** → Task 5 + Task 6 (restore test). ✅
- **Static data, no migration; explicit resolver, not column-parsing; period-aware keys** → Tasks 1–2 + Global Constraints. ✅
- **Registry integrity + resolver unit tests** → Tasks 1–2. ✅
- **Asset sourcing (B2) + ATTRIBUTION.md + human gate** → Task 8. ✅
- **Zero new errors vs baseline; `tsc -b`** → every task's verify step + Final Verification. ✅
- **Known deviations from spec (intentional, minor):** (1) `REGION_MAPS`/`RegionMapKey` ship as an incrementally-growing seed set rather than all 12 keys at once — preserves the integrity invariant with zero placeholders and lets the code ship before all art is sourced. (2) Fullscreen caption renders as a solid bottom bar rather than the mockup's gradient overlay — a polish detail the optional `frontend-design` pass can refine against `layout-v2.html`.
