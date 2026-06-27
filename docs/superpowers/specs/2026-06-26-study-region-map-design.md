# Study Region Map — "Then vs. Now" maps in the Context pillar

**Date:** 2026-06-26
**Status:** Approved (design)
**Area:** `src/notepad/study` — Context pillar (`ApparatusRail`)

## Summary

Add a collapsible map block to the Study **Context** pillar, beneath the book-context
text and above cross-references. When expanded it shows the book's region with two tabs —
**Biblical times** and **Today** — over a large, zoomable/pannable map image with a factual
caption and an attribution line. An expand control opens the map fullscreen.

Because the block lives in `ApparatusRail`, it appears in both the desktop left context
pane (`DesktopStudyWorkspace`) and the mobile **Context** tab (`MobileStudyWorkspace`)
with no extra wiring.

## Goals

- Give readers a vivid "what this region was then / what it is today" geographic anchor
  for the book they're studying.
- Keep it editorial and on-brand: curated illustrated maps, factual captions, the
  warm Study palette — not a heavyweight interactive GIS.
- Let readers see the **full** map: large inline view, zoom/pan, and a fullscreen mode.
- Ship without a DB migration or a network tile dependency.

## Non-goals (future enhancements)

- Interactive vector/tile maps (MapLibre/Leaflet).
- A multi-region picker for books that span regions (Exodus, Acts) — v1 uses one
  period-appropriate region per book.
- Per-chapter or per-verse maps; verse-pinned locations.

## UX & behavior

1. **Placement.** Rendered by `ApparatusRail`, immediately after the book-context
   `<section>` (author/date/region/genre/cultural context/summary) and before the
   CROSS-REFERENCES `<section>`.
2. **Collapsed (default).** A single row: a real `<button aria-expanded="false">`
   reading `▸ Map of the region` in the pane's uppercase label style. If the active
   book has no mapped region, the block does not render at all.
3. **Expanded.** Disclosure opens to:
   - A `role="tablist"` with two tabs: **Biblical times** (default active) and **Today**.
   - A large map image (`ZoomableMap`) — full pane width, ~210px tall inline — with
     overlaid **＋ / −** zoom buttons (bottom-right) and an **⤢ expand** button
     (top-right). Supports button zoom, pinch-zoom, double-tap-to-zoom, and drag-to-pan
     when zoomed in.
   - A factual italic **caption** and a small **attribution** line below the image.
4. **Fullscreen.** The ⤢ button opens `RegionMapFullscreen` — a portal overlay over a
   dimmed backdrop: the same two tabs, the map filling the viewport with zoom/pan, the
   caption along the bottom, and a ✕ (and Esc) to close. Focus is trapped while open and
   restored to the ⤢ trigger on close; body scroll is locked.
5. **Tab switch** swaps both the image and the caption/attribution; the active tab
   persists while the block stays mounted.

## Architecture

New directory `src/notepad/study/regionmap/`:

| File | Responsibility |
|------|----------------|
| `RegionMapBlock.tsx` | The disclosure. Collapsed by default; owns `expanded` + `activeTab` + `fullscreen` state. Renders nothing when `useRegionMap(book)` is `null`. |
| `RegionMapView.tsx` | Tabs + `ZoomableMap` + caption/attribution. Reused inline and inside fullscreen. Props: `map`, `activeTab`, `onTabChange`, `onExpand?`. |
| `ZoomableMap.tsx` | Wraps `react-zoom-pan-pinch`. ＋/− controls, pinch, drag-pan, double-tap. Lazy-loaded. Honors `prefers-reduced-motion` (disables zoom spring). |
| `RegionMapFullscreen.tsx` | Fullscreen portal overlay: focus-trap, Esc/✕ close, body-scroll lock, restores focus on close. |
| `useRegionMap.ts` | `(book: string) => RegionMap | null` — resolves via `BOOK_TO_REGION_MAP` → `REGION_MAPS`. |
| `region-maps.ts` | `REGION_MAPS` registry (data). |
| `book-region-map.ts` | `BOOK_TO_REGION_MAP` resolver table (data). |

**Integration:** `ApparatusRail` renders `<RegionMapBlock book={book} />` between the
book-context section and the cross-references section. No prop-drilling changes elsewhere;
both workspaces already pass `book` to `ApparatusRail`.

## Data model

Static, curated, in-repo — no Supabase table, no migration, no network fetch.

```ts
type MapTab = 'then' | 'now';

interface MapImage {
  src: string;          // '/maps/judah-monarchy/then.jpg'
  alt: string;          // descriptive alt text
  caption: string;      // factual, non-interpretive
  attribution: string;  // e.g. 'George Adam Smith, Atlas of the Historical Geography of the Holy Land (1915)'
  license: string;      // e.g. 'Public Domain', 'CC BY-SA 4.0'
}

interface RegionMap {
  key: RegionMapKey;
  label: string;        // 'Kingdom of Judah'
  then: MapImage;
  now: MapImage;
}

const REGION_MAPS: Record<RegionMapKey, RegionMap> = { /* ~10–14 entries */ };
const BOOK_TO_REGION_MAP: Record<BookAbbrev, RegionMapKey> = { /* 66 entries; omit = no map */ };
```

- The resolver is an **explicit 66-book lookup**, deliberately not parsing the free-text
  `bible_books.region` column (values like `'Rome or Ephesus (prison)'`, `'Judah / Babylon'`
  are not machine keys). Books intentionally without a map are simply absent from the table
  and resolve to `null`.
- Keys are **period-aware** so books set in the same place but different eras get the right
  "then" map: e.g. `judah-monarchy` (Lamentations, Kings) vs `judea-roman` (Gospels, Acts).

### Canonical region keys (v1)

Final count is settled during sourcing, but the planned coverage of all 66 books:

| Key | Label | Example books |
|-----|-------|---------------|
| `canaan-patriarchs` | Canaan (patriarchal age) | Genesis |
| `egypt-sinai` | Egypt & Sinai | Exodus, Leviticus, Numbers |
| `israel-conquest-judges` | Canaan (conquest & judges) | Joshua, Judges, Ruth |
| `israel-united-monarchy` | United Kingdom of Israel | 1–2 Samuel, parts of Kings/Chronicles |
| `judah-monarchy` | Kingdom of Judah | Kings, Chronicles, Lamentations, many prophets |
| `mesopotamia-babylon` | Babylon & Mesopotamia | Daniel, parts of Jeremiah/Ezekiel |
| `persia-exile-return` | Persian Empire / Return | Ezra, Nehemiah, Esther, Haggai, Zechariah, Malachi |
| `judea-roman` | Roman Judea & Galilee | Matthew, Mark, Luke, John |
| `roman-near-east` | Paul's Mediterranean world | Acts |
| `asia-minor` | Asia Minor | Galatians, Ephesians, Colossians, Revelation, 1 Peter |
| `greece-macedonia` | Greece & Macedonia | 1–2 Corinthians, Philippians, 1–2 Thessalonians |
| `rome-italy` | Rome & Italy | Romans |

Short general epistles without a strong geographic anchor (e.g. James, Jude, 2–3 John)
may resolve to `null` or to the writer's likely region — decided during sourcing.

### Asset layout

```
public/maps/
  <region-key>/
    then.jpg
    now.jpg
  ATTRIBUTION.md      # generated manifest: every image's caption, attribution, license, source URL
```

## Asset sourcing plan (B2)

For each region key, source one historical ("then") and one modern ("now") map:

- **Then:** prioritize **public-domain** historical maps — out-of-copyright Bible atlases
  (e.g. early-1900s works now in PD) and Wikimedia Commons PD/CC0 scans.
- **Now:** modern reference maps from openly-licensed sources (Wikimedia Commons CC0/CC-BY,
  OpenStreetMap-derived exports with proper attribution).
- For every image, record `caption` + `attribution` + `license` + source URL in
  `public/maps/ATTRIBUTION.md`.
- **Human review required:** licensing and geographic accuracy get a final human pass before
  prod. Any image whose license or accuracy is uncertain is flagged in the manifest and not
  shipped until cleared.

## Dependency

- `react-zoom-pan-pinch` (~5kb). Lazy-loaded via dynamic import inside `ZoomableMap` so it
  does not affect initial Study-mode load.

## Accessibility & polish

- Disclosure: `<button aria-expanded>`; chevron rotates.
- Tabs: `role="tablist"` / `role="tab"` / `aria-selected`; arrow-key navigation.
- Fullscreen: focus trap, Esc to close, focus restored to trigger, `aria-modal`, body-scroll
  lock.
- `prefers-reduced-motion`: disable zoom/pan spring animation and disclosure transition.
- Images: descriptive `alt`; captions factual/historical only (Lamplight voice — never
  interpretive or prophetic).

## Testing

- **Unit — `useRegionMap`:** known book → expected key; unmapped book → `null`.
- **Unit — registry integrity:** every `RegionMapKey` in `REGION_MAPS` has `then` and `now`
  with non-empty `src`, `alt`, `caption`, `attribution`, `license`; every value in
  `BOOK_TO_REGION_MAP` exists in `REGION_MAPS`.
- **Component — `RegionMapBlock`:** collapsed by default; toggles open; renders nothing for
  an unmapped book.
- **Component — `RegionMapView`:** switching tabs swaps image + caption.
- **Component — fullscreen:** ⤢ opens overlay; Esc and ✕ close it; focus restored.
- Baseline: add **zero** new lint/tsc/test errors relative to the known pre-existing red
  baseline.

## File manifest

**New:**
- `src/notepad/study/regionmap/RegionMapBlock.tsx` (+ test)
- `src/notepad/study/regionmap/RegionMapView.tsx` (+ test)
- `src/notepad/study/regionmap/ZoomableMap.tsx`
- `src/notepad/study/regionmap/RegionMapFullscreen.tsx` (+ test)
- `src/notepad/study/regionmap/useRegionMap.ts` (+ test)
- `src/notepad/study/regionmap/region-maps.ts`
- `src/notepad/study/regionmap/book-region-map.ts`
- `public/maps/<region-key>/then.jpg`, `now.jpg` (per region)
- `public/maps/ATTRIBUTION.md`

**Modified:**
- `src/notepad/study/panes/ApparatusRail.tsx` — render `<RegionMapBlock>` between context
  and cross-references.
- `package.json` — add `react-zoom-pan-pinch`.

## Open items resolved during brainstorming

- Source: curated illustrated image pairs (not interactive tiles, not AI-generated).
- Scope: source the real art now (B2), with a human license/accuracy review gate.
- Interaction: bigger inline map + zoom/pan + fullscreen.
- Defaults: collapsed by default; one map pair per book; factual captions.
