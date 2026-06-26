# Bible lexicon ingest (Hebrew/Greek interlinear + Strong's)

Populates `bible_interlinear` and `bible_strongs`. Run after migration 041 is applied.

## Sources (license-clean)
- Interlinear: STEPBible TAHOT (Hebrew/Aramaic OT) + TAGNT (Greek NT), CC BY 4.0 —
  https://github.com/STEPBible/STEPBible-Data
- Strong's definitions: OpenScriptures dictionaries (public domain) —
  https://github.com/openscriptures/strongs

## Steps
1. Download TAHOT + TAGNT release files; cache as `scripts/data/TAHOT.txt`, `scripts/data/TAGNT.txt`.
2. **Confirm column order** in those files matches the `COL` constant in
   `scripts/ingest-interlinear.ts` (ref, original, transliteration, gloss, dStrong, grammar).
   Adjust `COL` + re-run `npx vitest run scripts/ingest-interlinear.test.ts` if the layout differs.
3. Download `strongs-hebrew-dictionary.json` + `strongs-greek-dictionary.json` to `scripts/data/`.
4. Load (service-role env required):
   ```
   LANG=hebrew FILE=scripts/data/TAHOT.txt npx tsx scripts/ingest-interlinear.ts
   LANG=greek  FILE=scripts/data/TAGNT.txt npx tsx scripts/ingest-interlinear.ts
   LANG=hebrew FILE=scripts/data/strongs-hebrew-dictionary.json npx tsx scripts/ingest-strongs.ts
   LANG=greek  FILE=scripts/data/strongs-greek-dictionary.json  npx tsx scripts/ingest-strongs.ts
   ```
5. Spot-check: `select * from bible_interlinear where verse_id = 'jhn.3.16' order by position;`

## Known reconciliation risk
STEPBible dStrong numbers may carry disambiguation suffixes (e.g. `H1234a`) that the
OpenScriptures base dictionary lacks. Unmatched numbers degrade to "Definition unavailable"
in the UI (acceptable for MVP). A future pass can normalize suffixes.
