# Strong's-number normalization for the interlinear lexicon

**Date:** 2026-06-26 · **Branch:** `feat/study-interlinear`

## Problem

`bible_interlinear.strongs` stores raw STEPBible **dStrong** values (`G0025`,
`{H7225G}`, `H9003/{H7225G}`, `G1473 + G2532`). `bible_strongs.strongs` uses bare
**OpenScriptures** keys (`G25`, `H430`, `H7225`, `G1473`). `useStrongsEntry` queries
`.eq('strongs', raw)`, so the raw value rarely matches a key and the panel shows
"Definition unavailable" for most common words (e.g. John 3:16 "loved" = `G0025`).

## Decision

**Normalize at lookup-time** via a pure `normalizeStrongs(raw) -> string`. Raw
`bible_interlinear` data is preserved (no re-ingest, reversible). `useStrongsEntry` is
the single chokepoint every definition lookup passes through, so wiring there fixes all
call sites.

## `normalizeStrongs(raw)` — rules

Applied in order:

1. Trim. Empty / whitespace → `''`.
2. **Greek compound** `"G1473 + G2532"`: split on `+`, keep the **first/primary** token → `G1473`.
3. **Hebrew prefix chain** `"H9003/{H7225G}"`: the lexical root is the **braced** token →
   extract `{…}` → `H7225G`. (STEP prefix codes `H9xxx` have no OpenScriptures entry.) If
   a `/` exists without braces, take the last `/`-segment (root trails the prefix).
4. Match `^[HG]\d+[A-Za-z]?$`: **drop the single trailing letter**, **un-pad** leading
   zeros, **uppercase** the H/G prefix. No match → `''`.

`H9003` alone (prefix code, no root) → stays `H9003` → lookup misses → "unavailable"
(documented, acceptable).

### Fixtures (all real STEP data)

| raw | normalized |
|---|---|
| `G0025` | `G25` |
| `H0430` | `H430` |
| `G2424G` | `G2424` |
| `H1254A` | `H1254` |
| `H7225G` | `H7225` |
| `{H7225G}` | `H7225` |
| `H9003/{H7225G}` | `H7225` |
| `G1473 + G2532` | `G1473` |
| `H7225` (identity) | `H7225` |
| `G2316` (identity) | `G2316` |

## Wiring

- **New:** `src/notepad/study/lexicon/normalizeStrongs.ts` (+ colocated `.test.ts`).
- **`useStrongsEntry.ts`:** `key = normalizeStrongs(strongs) || null`; query `.eq('strongs', key)`;
  cache by `key` (so `G0025` and `G25` share one entry). Existing tests stay green
  (`normalize('H7225') === 'H7225'`).
- **`OriginalLanguagePanel.tsx`:** `WordRow` normalizes once; the badge shows the canonical
  key (`G25`) and `StrongsDefinition` looks up the canonical key.

## Out of scope

Re-ingest / ingest-time normalization; any change to the STEP parser; multi-letter
suffix handling (not present in real data).

## Testing

TDD, real-data fixtures: unit tests for `normalizeStrongs`; `useStrongsEntry` test that a
padded raw value queries the canonical key + shares cache; panel test that a padded raw
value renders the canonical badge and looks up the canonical key.
