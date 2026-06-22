# Bible Translations Ingest Runbook (KJV + WEB)

This runbook covers the operator steps to ingest KJV and WEB translations into `bible_passages`,
run the parity check, and any caveats about migration ordering. Steps 3–5 below must be run by
an operator with Supabase service-role credentials — they are NOT run in CI.

---

## 1. Source verification

### KJV — King James Version

- **Download URL:** `https://eBible.org/Scriptures/eng-kjv_vpl.zip`
- **Distributor:** eBible.org (eng-kjv edition)
- **License:** Public Domain (US). Evidence: `eng-kjv_about.htm` inside the zip states:
  > "Public Domain. … This royal decree has no effect outside of the UK, where this work is
  > firmly in the Public Domain."
- **UK caveat:** Crown letters-patent issued by King James means printing or importing printed
  copies into the United Kingdom requires permission from the Cambridge University Press, Oxford
  University Press, or Collins. This affects print only — digital distribution outside the UK is
  public domain.
- **Format in zip:** `eng-kjv_vpl.txt` uses `BOOKCODE C:V Text` lines (one verse per line,
  space-separated, no tab). Book codes are 3-letter uppercase OSIS codes (e.g. `GEN`, `PSA`,
  `SOL`, `MAR`). The zip also includes `eng-kjv_vpl.sql` and `eng-kjv_vpl.xml`.
- **Apocrypha:** The KJV VPL includes 14 apocryphal books (e.g. `1MA`, `2MA`, `TOB`, `SIR`).
  These are filtered out by `convert-vpl-to-bsb-tsv.ts`.

### WEB — World English Bible (Protestant edition)

- **Download URL:** `https://eBible.org/Scriptures/engwebp_vpl.zip`
- **Distributor:** eBible.org (engwebp edition — Protestant canon, no Apocrypha)
- **License:** Public Domain. Evidence: `engwebp_about.htm` inside the zip states:
  > "The World English Bible is in the Public Domain. That means that it is not copyrighted.
  > However, 'World English Bible' is a Trademark of eBible.org."
- **Trademark note:** The name "World English Bible" is trademarked by eBible.org. Use the
  translation ID `WEB` in the database, not the full name in user-facing copy.
- **Format in zip:** `engwebp_vpl.txt` — same `BOOKCODE C:V Text` shape as KJV; exactly 66
  Protestant-canon books, no apocrypha.

### Why `url` is left empty in `SOURCES`

Both VPL files use OSIS 3-letter uppercase book codes (e.g. `GEN`, `MAR`, `PHI`, `JAM`, `JOE`,
`SOL`) and space-separated fields without a tab character. `parseBsbText` in `ingest-bsb.ts`
requires lines in the format `<Full English Book Name> C:V\t<Text>` (tab-separated, full English
names matching `BOOK_ABBREV`). The raw zip URL cannot be consumed directly, so `url` is left
as `''` and the cache file must be produced by the conversion step below before running ingest.

---

## 2. Format conversion (operator step)

Run `scripts/convert-vpl-to-bsb-tsv.ts` to transform each VPL file into the BSB-compatible TSV
format. This script maps OSIS codes to full English book names and inserts the required tab.

```bash
# Step 2a: Download + unzip the VPL archives
curl -L "https://eBible.org/Scriptures/eng-kjv_vpl.zip" -o /tmp/eng-kjv_vpl.zip
unzip /tmp/eng-kjv_vpl.zip -d /tmp/kjv_vpl/

curl -L "https://eBible.org/Scriptures/engwebp_vpl.zip" -o /tmp/engwebp_vpl.zip
unzip /tmp/engwebp_vpl.zip -d /tmp/web_vpl/

# Step 2b: Convert to BSB TSV format (produces scripts/data/kjv.txt and web.txt)
npx tsx scripts/convert-vpl-to-bsb-tsv.ts \
  --in /tmp/kjv_vpl/eng-kjv_vpl.txt \
  --out scripts/data/kjv.txt

npx tsx scripts/convert-vpl-to-bsb-tsv.ts \
  --in /tmp/web_vpl/engwebp_vpl.txt \
  --out scripts/data/web.txt
```

Expected output for each conversion:
```
Converted 31102 verses → scripts/data/kjv.txt
Skipped codes (apocrypha/unknown):
  1ES (apocrypha): 457 verses
  1MA (apocrypha): 924 verses
  ...
```

The WEB conversion should report 0 skipped codes (clean Protestant canon).

**Do NOT commit `scripts/data/kjv.txt` or `scripts/data/web.txt` to the repository** — these
are large corpora (~4–5 MB each) and are operator-produced artifacts, not source-controlled.
(Check `.gitignore` includes `scripts/data/*.txt` except `bsb.txt` if it is already tracked.)

---

## 3. Run the ingests

Run with your target-environment credentials (never against production unless intentional):

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> TRANSLATION=KJV \
  npx tsx scripts/ingest-bsb.ts

SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> TRANSLATION=WEB \
  npx tsx scripts/ingest-bsb.ts
```

Expected output for each:
```
loading KJV corpus…
parsed 31102 verses + 1189 pericopes = 32291 rows
bible_passages upserted
skip embeddings for KJV (shared semantic index = BSB only)
done
```

The ingest is idempotent: re-running skips rows with the same `content_hash`.

---

## 4. Run parity checks

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> TRANSLATION=KJV \
  npx tsx scripts/bible-parity-check.ts

SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> TRANSLATION=WEB \
  npx tsx scripts/bible-parity-check.ts
```

Expected output (counts should be within ~50 verses of BSB's ~31,102 verse keys):
```
KJV: 31102 verse keys; BSB: 31102
missing in KJV (present in BSB): 0 []
extra in KJV (absent in BSB): 0 []
```

Any `missing`/`extra` entries are versification edge cases where KJV/WEB split or merge verses
differently from BSB. Record them in the PR description — the BSB fallback (Task 13) covers
them for display.

---

## 5. Migration ordering caveat

**IMPORTANT:** This branch (`feat/bible-translations`) adds migrations 036 and 037.
Branch `feat/study-mode` has applied migrations 031–035 to production.

Before merging `feat/bible-translations` to `main` and pushing migrations to production:

1. Confirm `feat/study-mode` has been merged first (migrations 031–035 must already be in prod).
2. Verify that migrations 036–037 on this branch do not conflict with 031–035.
3. Run `supabase db push` only after step 1–2 are confirmed.
4. If both branches land simultaneously, reconcile migration numbers to avoid sequence gaps.

Apply migrations via:
```bash
supabase db push
```

(Migrations apply automatically against the linked project; only new ones pending are applied.)

---

## 6. BOOK_ABBREV aliases

No new aliases were required. The conversion script `convert-vpl-to-bsb-tsv.ts` maps all VPL
OSIS codes to the exact full English names already present in `BOOK_ABBREV`:
- `SOL` → `Song of Solomon` (matches existing entry)
- `MAR` → `Mark` (matches existing entry)
- `PHI` → `Philippians` (matches existing entry)
- `JAM` → `James` (matches existing entry)
- `JOE` → `Joel` (matches existing entry)
- `PSA` → `Psalm` (singular, matches existing entry)

The conversion is the right layer for this mapping — `BOOK_ABBREV` stays clean and the throw on
unknown names remains intact as a correctness guard.
