# Runbook — OpenBible cross-reference ingest

How `bible_cross_references` (migration 033) is acquired, verified, and loaded. Mirrors the evidence-trail standard of `library-ingest.md` and `bible-translations-ingest.md`: the source records its license with the evidence quoted, and the run records its counts so a later re-run can be checked against them.

**Recorded run: 2026-08-06.** Before it, the table held **0 rows** — the migration had been applied but the data was never loaded, so the Study rail's cross-reference section could not render and `lamplight-study` had been grounding on the open chapter alone. See §7 for what changed downstream.

---

## 1. Source

| Field | Value |
|---|---|
| Dataset | OpenBible.info cross-references (TSK-derived, community-voted) |
| License | **CC BY** |
| License evidence | The file's own header row ends `#www.openbible.info CC-BY 2026-08-03` — the notice ships inside the data |
| Landing page | https://www.openbible.info/labs/cross-references/ |
| Direct file | https://a.openbible.info/data/cross-references.zip |
| Recorded size | 1,981,836 bytes zipped · 8,301,611 bytes extracted · last modified 2026-08-03 |

`bible_cross_references.source` defaults to `'OpenBible.info (CC BY)'` per migration 033, so attribution is carried per row. **CC BY requires the credit to be visible to users** — confirm OpenBible.info appears on the Sources screen alongside the library credits. Row-level provenance alone does not satisfy the license.

## 2. Acquire

From the repo root:

```bash
cd scripts/data && curl -sSL -o cross-references.zip "https://a.openbible.info/data/cross-references.zip" && unzip -o cross-references.zip
```

Yields `scripts/data/cross_references.txt`. Both files are covered by the `scripts/data/` entry in `.gitignore` — the corpus is never committed.

Format is tab-separated `From Verse⇥To Verse⇥Votes`, OSIS refs, one header line:

```
From Verse	To Verse	Votes	#www.openbible.info CC-BY 2026-08-03
Gen.1.1	Exod.31.18	-38
Gen.1.1	Acts.17.24	132
```

Targets may be a single ref or a range (`John.1.1-John.1.3`). Votes may be **negative** — OpenBible allows downvotes, and the rail's `order by votes desc` sinks them.

## 3. Verify before loading

`parseCrossRefLine` is exported and unit-tested (`scripts/ingest-cross-references.test.ts`), and the whole file is parsed **before any upsert** — so an unmapped OSIS token throws with nothing written. That is the safety property worth knowing: a malformed file cannot half-load.

Recorded parse figures for the 2026-08-03 file. A later download should land close to these; a large swing means the dataset's shape changed and `osis-book-map.ts` needs re-checking:

| Check | Recorded |
|---|---|
| Lines in file | 344,791 |
| Rows parsed | **344,789** (1 header, 1 trailing blank) |
| Unmapped OSIS tokens | **0** — all 66 Protestant-canon books map |
| Duplicate keys within the file | **0** |
| Cross-testament rows | 73,304 |
| Multi-verse targets | 88,134 |
| Negative-vote rows | 1,247 |
| Upsert batches (1,000 each) | 345 |

`osis-book-map.ts` covers the 66-book Protestant canon only. OpenBible ships no deuterocanonical refs, so this is complete for this dataset — but a different source would need the map extended before it would parse.

## 4. Load

Service-role env required. **The script reads `SUPABASE_URL`, not `VITE_SUPABASE_URL`** — `.env.local` only defines the latter, so map it on the command line. `SUPABASE_SERVICE_ROLE_KEY` must be added to `.env.local` yourself (Supabase Dashboard → Project Settings → API → `service_role`); it is not there by default.

```bash
set -a && . ./.env.local && set +a && SUPABASE_URL="$VITE_SUPABASE_URL" npx tsx scripts/ingest-cross-references.ts scripts/data/cross_references.txt
```

Progress prints per batch, ending `upserted 344789/344789`. The run takes a few minutes.

**Idempotent.** The upsert uses `onConflict` on the full unique key with `ignoreDuplicates: true`, so a re-run is a no-op and a partial run is safe to resume by re-running from the top.

## 5. Acceptance

```sql
-- 344789 on the recorded run
select count(*) from public.bible_cross_references;

-- John 1 → Genesis 1:1 should lead, cross-testament, ~337 votes
select to_book, to_chapter, to_verse_start, votes, crosses_testament
  from public.bible_cross_references
 where from_book = 'jhn' and from_chapter = 1
 order by votes desc limit 4;

-- Psalm 27 → Isaiah 40:31, Hebrews 13:6, Psalm 118:6
select to_book, to_chapter, to_verse_start, votes
  from public.bible_cross_references
 where from_book = 'psa' and from_chapter = 27
 order by votes desc limit 3;
```

Recorded results: 344,789 rows; John 1 → `gen 1:1` (337 votes, cross-testament); Psalm 27 → `isa 40:31` (149), `heb 13:6` (145), `psa 118:6` (133).

Then in the app, signed out: the Study rail's **CROSS-REFERENCES** section renders with **verse text** (not bare refs), and switching the reader to KJV re-renders that text in KJV phrasing. Both are worth checking together — they exercise the `(translation, id)` filter that `useApparatus` needs, and empty verse text is the tell that it regressed.

## 6. Rollback

```sql
delete from public.bible_cross_references;
```

No FK depends on it. Every consumer degrades to "no cross-references" rather than erroring — which is precisely how the empty-table state went unnoticed for so long.

## 7. What loading this changes downstream

Not just the rail. `supabase/functions/lamplight-study/study-context.ts` uses the table twice: for the `crossRefs` grounding block, **and** to add every *resolved* cross-ref target as a `libraryAnchor`, which is what pulls commentary written on the cross-referenced verse.

Measured across 15 chapters spanning psalm, gospel, epistle, prophecy, law, wisdom, and apocalyptic, before → after:

| | Before | After |
|---|---|---|
| Cross-references supplied | 0 | 75 (every chapter fills its `CROSSREF_K = 5` budget) |
| Crossing testaments | 0 | 30 |
| New library anchor chapters | 0 | 66 |
| Commentary chunks newly reachable | 0 | **2,602** |

So this is a grounding change for every study-chat turn, not a cosmetic one. **The eval harness cannot measure it**: `--artifact=devotion` is the only artifact wired for live runs, and the devotion pipeline never reads this table. Wiring `study-chat` into the harness (README §Coverage — the fixture schema already accommodates it) is what would catch a regression here.

## 8. Troubleshooting

**`Node.js 20 detected without native WebSocket support`** — `supabase-js` constructs a Realtime client at `createClient` time and Node < 22 has no global `WebSocket`. `ingest-cross-references.ts` carries the same fix `ingest-library.ts` does (an unused Realtime transport; the script only issues REST calls), so this should not recur. See `library-ingest.md` §9 for which scripts still carry the latent issue.

**`SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required`** — `.env.local` defines `VITE_SUPABASE_URL`, not `SUPABASE_URL`. Map it as in §4. If only the URL resolves, the missing half is the service-role key, which is not in `.env.local` by default.

**`Unmapped OSIS book token: <tok>`** — the dataset contains a book `scripts/osis-book-map.ts` doesn't know (deuterocanon, or a different OSIS dialect). Nothing was written; extend the map and re-run.

**Rail shows refs with no verse text** — the cross-ref target read is not filtering on translation. `bible_passages` is keyed `(translation, id)`, so an unfiltered `maybeSingle()` matches one row per ingested translation and errors. `useApparatus` takes the reader's translation as a required argument for exactly this reason; a default would reintroduce it silently.
