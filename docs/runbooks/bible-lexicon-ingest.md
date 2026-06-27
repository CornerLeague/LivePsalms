# Bible lexicon ingest (Hebrew/Greek interlinear + Strong's)

Populates `bible_interlinear` and `bible_strongs`. Run after migration 041 is applied.

## Sources (license-clean)
- Interlinear: STEPBible TAHOT (Hebrew/Aramaic OT) + TAGNT (Greek NT), CC BY 4.0 —
  https://github.com/STEPBible/STEPBible-Data
- Strong's definitions: OpenScriptures dictionaries (public domain) —
  https://github.com/openscriptures/strongs
  NOTE: the repo ships JS modules (`hebrew/strongs-hebrew-dictionary.js`,
  `greek/strongs-greek-dictionary.js`, each `module.exports = {...}`), NOT `.json`.
  Convert with: `node -e "require('fs').writeFileSync('scripts/data/strongs-hebrew-dictionary.json', JSON.stringify(require('./strongs-hebrew-dictionary.cjs')))"`
  (rename the download to `.cjs` first). The Greek dict uses field `translit` (not
  `xlit`) and has no `pron` — `ingest-strongs.ts` handles the `translit` fallback;
  Greek pronunciation is unavoidably empty.

## Steps
1. Download TAHOT + TAGNT release files; cache as `scripts/data/TAHOT.txt`, `scripts/data/TAGNT.txt`.
2. **Column order is already confirmed** against the real files (2026-06-26). The two
   corpora are laid out DIFFERENTLY, so `scripts/ingest-interlinear.ts` parses them
   language-aware: TAHOT (Hebrew) is one-field-per-column (`TAHOT_COL`); TAGNT (Greek)
   fuses "Greek (translit)" in col[1] and "dStrong=Grammar" in col[3] (compounds joined
   by " + "), split by `parseTagntRow`. If STEPBible ever revises the layout, adjust those
   and re-run `npx vitest run scripts/ingest-interlinear.test.ts`.

   **Versification + position (resolved 2026-06-26).** Where Hebrew/English numbering
   diverges, STEP inserts the alternate reference between the verse and the `#NN` word
   index — `(32.1)` in TAHOT, `[17.15]`/`{19.41}` in TAGNT (e.g. `Gen.31.55(32.1)#04`,
   `Psa.51.0(51.1)#01`). The leading `Book.Ch.Vs` is the **English** numbering the reader
   uses; `STEP_REF_RE` now skips the bracketed alternate so `#NN` is still read. But `#NN`
   is unsafe as the primary key: the bracket previously hid it (every word collapsed to
   `position 1`), and English versification folds several Hebrew sub-verses into one verse
   (a Psalm superscription → verse 0), restarting `#NN` and colliding. So
   `toInterlinearRows` numbers `position` by **appearance order per `verse_id`** — unique
   by construction, idempotent, and identical to `#NN` for the ~99.98% of verses with no
   divergence. This was the `ON CONFLICT … cannot affect row a second time` (Postgres
   `21000`) crash; covered by `ingest-interlinear.test.ts`.
3. Download `strongs-hebrew-dictionary.json` + `strongs-greek-dictionary.json` to `scripts/data/`.
4. Load (service-role env required). Use `INGEST_LANG`, **not** `LANG` — `LANG` is the
   POSIX locale variable the OS sets (e.g. `en_US.UTF-8`); the scripts read `INGEST_LANG`
   and reject anything that isn't `hebrew`/`aramaic`/`greek` so a misset value fails fast:
   ```
   INGEST_LANG=hebrew FILE=scripts/data/TAHOT.txt npx tsx scripts/ingest-interlinear.ts
   INGEST_LANG=greek  FILE=scripts/data/TAGNT.txt npx tsx scripts/ingest-interlinear.ts
   INGEST_LANG=hebrew FILE=scripts/data/strongs-hebrew-dictionary.json npx tsx scripts/ingest-strongs.ts
   INGEST_LANG=greek  FILE=scripts/data/strongs-greek-dictionary.json  npx tsx scripts/ingest-strongs.ts
   ```
5. Spot-check: `select * from bible_interlinear where verse_id = 'jhn.3.16' order by position;`

## Strong's-number reconciliation (RESOLVED — lookup-time normalization)
STEPBible dStrong numbers don't match the OpenScriptures `bible_strongs` keys verbatim:
- **Zero-padding:** STEP pads to 4 digits (`G0025`, `H0430`); OpenScriptures keys are
  unpadded (`G25`, `H430`). This hits MANY common words (e.g. John 3:16 "loved" = `G0025`).
- **Disambiguation suffixes / wrappers:** STEP adds suffixes (`H1234a`, `G2424G`), curly
  braces (`{H7225G}`), and prefix slashes (`H9003/{H7225G}`) the base dictionary lacks.
- **Greek compounds:** STEP joins them with ` + ` (`G1473 + G2532`).

This is now handled at **lookup-time** by `src/notepad/study/lexicon/normalizeStrongs.ts`,
called inside `useStrongsEntry` (query + cache key) and the panel badge. It strips
wrappers, picks the braced Hebrew root / primary Greek token, drops a single trailing
letter, and un-pads zeros. **The raw `bible_interlinear` data is stored verbatim and needs
NO transformation at ingest — do not normalize during ingest.** STEP prefix codes (`H9xxx`)
have no OpenScriptures entry and correctly remain "Definition unavailable."

Acceptance after ingest: John 3:16 "loved" (`G0025` → `G25`) shows a real definition, and a
Hebrew root (e.g. Gen 1:1 `{H7225G}` → `H7225`) resolves too.
