# Runbook — Lamplight library ingest

How the grounding corpus (migration 058) is acquired, verified, and loaded. Mirrors the evidence-trail standard of `bible-translations-ingest.md`: every source records its license with the evidence quoted, and every run records its counts so a later re-run can be checked against them.

**Recorded run: 2026-08-05.**

---

## 1. Sources in v1

| Source id | Work | Author | Module | License evidence |
|---|---|---|---|---|
| `treasury-of-david` | The Treasury of David | C. H. Spurgeon (1869–1885) | CrossWire `TDavid` 2.1 | module `tdavid.conf` → `DistributionLicense=Public Domain` |
| `matthew-henry-concise` | Concise Commentary on the Whole Bible | Matthew Henry (1706–1710) | CrossWire `MHCC` 2.0 | module `mhcc.conf` → `DistributionLicense=Public Domain` |
| `jfb` | Commentary Critical and Explanatory | Jamieson, Fausset & Brown (1871) | CrossWire `JFB` 3.0 | module `jfb.conf` → `DistributionLicense=Public Domain` |

All three authors died before 1900; the works are public domain by age in the US, and CrossWire's own module metadata declares Public Domain distribution. Confirm with:

```bash
grep -i DistributionLicense /opt/homebrew/share/sword/mods.d/{tdavid,mhcc,jfb}.conf
```

## 1b. Phase A1 sources (added 2026-08-07)

Five public-domain works added to broaden the corpus beyond one tradition — the prerequisite for Insights Door 2 (*Deeper In*), whose value over Door 1 is breadth of interpretation. Plan: `docs/superpowers/plans/2026-08-07-library-a1.md`.

| Source id | Work | Author | Module | Register | License evidence |
|---|---|---|---|---|---|
| `wesley-notes` | Explanatory Notes on the Bible | John Wesley (1754–1765) | CrossWire `Wesley` 1.1 | devotional | `wesley.conf` → `DistributionLicense=Public Domain` |
| `adam-clarke` | Commentary and Critical Notes | Adam Clarke (1810–1826) | CrossWire `Clarke` 2.0 | exegetical | `clarke.conf` → `DistributionLicense=Public Domain` |
| `calvin-commentaries` | Calvin's Commentaries | John Calvin (1540–1564) | CrossWire `CalvinCommentaries` 1.1 | exegetical | `calvincommentaries.conf` → `DistributionLicense=Public Domain` |
| `catena-aurea` | Catena Aurea | Aquinas, tr. Newman (1841) | CrossWire `Catena` 1.0.1 | exegetical | `catena.conf` → `DistributionLicense=Public Domain` |
| `geneva-notes` | Geneva Bible Translation Notes | Geneva translators (1560–1599) | CrossWire `Geneva` 1.1 | confessional | **none — see below** |

```bash
installmgr --allow-internet-access-and-risk-tracing-and-jail-or-martyrdom -ri CrossWire Wesley
# …likewise Clarke, CalvinCommentaries, Catena, Geneva
```

### Three provenance facts, recorded rather than smoothed over

- **`Geneva` declares NO `DistributionLicense` at all.** Its `.conf` carries `InstallSize` and `SwordVersionDate` but no licence field, so there is nothing to quote against this runbook's own evidence standard. It is ingested on the **age** argument — the 1560/1599 marginalia are unambiguously public domain — and that is the claim recorded in `library_sources.license`, not a declaration that does not exist. The module is a 2001 ThML conversion of unstated provenance; if a cleaner source appears, prefer it.
- **`Clarke`'s `TextSource` is Wikisource**, which the Insights design flags for ShareAlike quarantine handling. Clarke died in 1832, so the underlying text is PD by age, and a faithful transcription of a public-domain work creates no new copyright. Recorded because the flag was raised and deserves an answer.
- **`CalvinCommentaries`'s `TextSource` is `ccel.org`** — and §1 above already excludes "CCEL's own editions (their formatting copyright)". The module itself declares Public Domain and the CTS translation is PD by age; what is inherited is a *conversion* of CCEL-hosted text, not a CCEL edition claim we are asserting. Flagged so a future audit starts from the fact rather than rediscovering it.

### Module behaviour — observed, not assumed

Probed with `parseChapterDump` against real output, per §3's standing instruction:

| Module | Keying | Note |
|---|---|---|
| `Wesley` | clean per-verse | Catchword notes; many verses empty |
| `Clarke` | clean per-verse | Verse 1 carries a chapter preface; bodies up to 26k chars |
| `Geneva` | clean per-verse | Body is **verse text + `{a}`-marked glosses**; the verse text is stripped at ingest |
| `Catena` | clean per-verse | Gospels only; inline patristic attributions, preserved |
| `CalvinCommentaries` | **range-repeats, varying BY BOOK** | Psalm 27: 14 verse keys → **1 distinct body**. Romans 9: 33 → 33 |

Calvin takes the same consecutive-collapse path as JFB and MHCC, and it must not be assumed off for any book — the behaviour varies *within* the module. No dumper changes were needed: `buildEntries` special-cases only `TDavid`.

**Geneva's verse text is stripped** (`stripGenevaVerseText`), because it duplicates `bible_passages` and is half the corpus by character count. Two things only the real 14,695-entry dump revealed: markers are **alphanumeric** (`(1)` in Genesis 6:16, not just `(a)`), and **"The Argument" book prefaces must survive** — 28 of the 35 sit *before* the first note marker, so cutting at the marker would delete the best summary Geneva has for those books.

### Recorded run — 2026-08-07

| Source | Chunks | Unanchored |
|---|---:|---:|
| `adam-clarke` | 23,797 | 0 |
| `calvin-commentaries` | 19,129 | 0 |
| `wesley-notes` | 16,968 | 0 |
| `geneva-notes` | 14,701 | 0 |
| `catena-aurea` | 2,966 | 0 |
| **Total** | **77,561** | **0** |

Corpus **34,076 → 111,637**. Registers went from two (devotional, exegetical) to three, `confessional` gaining its first member. Zero unanchored chunks — every one resolved to a book/chapter/verse ref.

**Load order:** Catena first, as the smallest, to prove the write path before committing the larger sources. `--dry-run` for all five first; the parsed counts matched the adapter counts exactly.

**Not ingested, deliberately:** BibleProject (no-derivatives), Got Questions (200-word commercial cap), Louw-Nida (UBS copyright), CCEL's own editions (their formatting copyright — take PD text from SWORD instead), Chambers' *My Utmost* (renewed copyright), NET notes and Enduring Word (permission pending — v2). Lexical data is **not** a library source: `bible_strongs` + `bible_interlinear` (migration 041) already hold it publicly, and slice 1c's lexicon block reads them directly.

## 2. Install the SWORD tooling and modules

```bash
brew install sword
```

```bash
installmgr -init
installmgr --allow-internet-access-and-risk-tracing-and-jail-or-martyrdom -sc
installmgr --allow-internet-access-and-risk-tracing-and-jail-or-martyrdom -ri CrossWire TDavid
installmgr --allow-internet-access-and-risk-tracing-and-jail-or-martyrdom -ri CrossWire MHCC
installmgr --allow-internet-access-and-risk-tracing-and-jail-or-martyrdom -ri CrossWire JFB
```

Notes:
- `-init` **overwrites** an existing `~/.sword/InstallMgr/InstallMgr.conf`. Check before running it on a machine that already uses SWORD.
- The long `--allow-internet-access…` flag is CrossWire's deliberate friction; there is no shorter alias.
- Modules install to `/opt/homebrew/share/sword/` on Apple-silicon Homebrew, **not** `~/.sword`.

## 3. Dump to JSONL

```bash
npx tsx scripts/dump-sword-commentary.ts --module=TDavid --books=Psalm --out=scripts/data/tdavid.jsonl
npx tsx scripts/dump-sword-commentary.ts --module=MHCC --out=scripts/data/mhcc.jsonl
npx tsx scripts/dump-sword-commentary.ts --module=JFB  --out=scripts/data/jfb.jsonl
```

Treasury of David covers **Psalms only** — hence `--books=Psalm`. The other two run the whole canon (~15 min each; they spawn one `diatheke` per chapter).

**Why a dump step exists at all.** The three modules key their content three different ways, all observed from real output rather than assumed:

- **JFB** is verse-range keyed, and `diatheke` repeats a range's text for *every* verse in it. Psalm 27:4 and 27:5 return byte-identical bodies — one comment on 27:4-5, not two. The dumper collapses consecutive identical bodies into a single ranged entry.
- **MHCC** does the same with much wider ranges (one comment spanning a whole psalm section).
- **TDavid** puts the **entire psalm on verse 1**; verses 2+ come back empty. The body carries inline `* Verse N. *` markers, repeated once per section (exposition / explanatory notes & quaint sayings / hints to the village preacher). The dumper splits on those markers, which is what makes Spurgeon verse-anchored rather than one 85 KB chapter blob.

Because Treasury comments on the same verse once per section, a ref legitimately repeats. The dumper appends an occurrence suffix (`Psalm 27:1 [2]`) so rows cannot collide on `library_chunks_ident`; without it the upsert would silently keep only the last one.

The output files are **gitignored** — regenerate rather than commit.

## 4. Verify the dump before loading

```bash
npx tsx scripts/ingest-library.ts --source=treasury-of-david --file=scripts/data/tdavid.jsonl --dry-run
```

Recorded 2026-08-05 (re-runs should match within a module version):

| Source | JSONL entries | Parsed chunks | Verse-anchored | Chapter-level | Tokens | Key collisions |
|---|---|---|---|---|---|---|
| treasury-of-david | 11,224 | 12,745 | 11,947 | 798 | 2,912,484 | 0 |
| matthew-henry-concise | 4,047 | 4,136 | 4,136 | 0 | 934,146 | 0 |
| jfb | 16,882 | 17,195 | 17,195 | 0 | 2,343,707 | 0 |
| **total** | **32,153** | **34,076** | **33,278** | **798** | **6,190,337** | **0** |

Chunks exceed entries because oversize sections are split by `chunkText` into numbered pieces.

## 5. Load and embed

Requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_AI_KEY`. Migrations 058 and 059 must already be applied (SQL Editor — the CLI `db push` is broken on this machine).

```bash
npx tsx scripts/ingest-library.ts --source=treasury-of-david --file=scripts/data/tdavid.jsonl
```

Repeat per source. The run upserts the source row, then the chunks in slices of 200, then embeds every chunk still missing a vector (Voyage batches of 64, written in slices of 16 — HNSW maintenance is O(M·log N) per row and a large upsert can exceed the statement timeout).

Embedding ~6.19M tokens on `voyage-context-3` costs roughly **$1.11** one-time at $0.18/M.

To embed only (resuming after a partial or failed pass): `--embed-only --source=<id>`. The pass is resumable by construction — it repeatedly claims the next 500 chunks whose `embedding` is null, so re-running picks up exactly what is left and a completed corpus is a no-op.

**Always check `embedded` in the final report against the source's chunk count in §4.** A suspiciously round number (500, 1000) means paging regressed; PostgREST caps a single response at ~1000 rows, which silently truncated this pass before it was fixed on 2026-08-05.

## 6. Acceptance queries

```sql
-- per-source counts must match §4
select source_id, count(*), sum(token_count) from public.library_chunks group by 1 order by 1;

-- every verse-anchored chunk resolves against real scripture; expect 0
select count(*) from public.library_chunks c
 where c.book is not null
   and not exists (select 1 from public.bible_passages p
                    where p.book = c.book and p.chapter = c.chapter and p.translation = 'BSB');

-- nothing left unembedded; expect 0
select count(*) from public.library_chunks where embedding is null;

-- versification canary: Spurgeon on Psalm 51 should anchor to psa 51
select heading, verse_start from public.library_chunks
 where source_id = 'treasury-of-david' and book = 'psa' and chapter = 51
 order by verse_start limit 5;
```

## 6b. Retrieval baseline (recorded 2026-08-05)

```bash
npx tsx scripts/library-retrieval-smoke.ts
```

Default query `"waiting on the Lord in a season of fear"` returned, top 5:

| # | sim | source | heading | anchor |
|---|---|---|---|---|
| 1 | 0.551 | jfb | Psalm 130:5-6 | psa 130 |
| 2 | 0.536 | treasury-of-david | Psalm 27:14 | psa 27 |
| 3 | 0.530 | treasury-of-david | Psalm 130:5 [2] | psa 130 |
| 4 | 0.525 | treasury-of-david | Psalm 25:5 [3] (1/2) | psa 25 |
| 5 | 0.521 | treasury-of-david | Psalm 130:5 [3] | psa 130 |

What this baseline pins, beyond "retrieval works":

- **Semantic quality** — every hit is a waiting-on-God passage (Ps 130 "I wait for the LORD", Ps 27:14 "Wait on the LORD", Ps 25:5 "On thee do I wait"), and JFB's top hit independently cross-references Ps 27:14 while Treasury's Ps 27:14 ranks second. The corpus corroborates itself.
- **The occurrence suffix is doing real work.** `Psalm 130:5 [2]` and `[3]` carry *different* text (one on waiting as "a most blessed posture", the other on waiting as "a great part of life's discipline") — Treasury's per-section comments on one verse. Before the suffix these collided on `library_chunks_ident` and the upsert kept only one.
- **Suffix and chunk-splitting compose** — `Psalm 25:5 [3] (1/2)` is occurrence 3, piece 1 of 2.
- **Anchors resolve** to real books/chapters.
- **Similarity band ~0.52–0.55** for a good match on this corpus. Useful when slice 1c sets fusion/rerank thresholds — do not assume note-similarity thresholds transfer.

**Watch item:** `matthew-henry-concise` did not place in the top 5. Not necessarily wrong — it is the smallest source (4,136 chunks) and its comments summarise passage blocks rather than dwelling on single verses, so a devotional single-verse query favours the other two. If MHCC never surfaces across varied slice-1c queries, investigate before assuming it is earning its place.

**Resolved 2026-08-06 (slice 1c).** `npx tsx scripts/library-fusion-smoke.ts` — which runs the real two-channel fusion rather than the bare RPC — surfaces all three sources across its four queries, MHCC included. The verse-anchor channel plus block-level questions are what reach it; a single-verse semantic query alone does not. MHCC is earning its place; Matthew Henry *Complete* stays deferred.

## 6c. Acceptance re-run after Phase A1 (2026-08-07)

Corpus **111,637 chunks across 8 sources**.

| §6 query | result |
|---|---|
| per-source counts | clarke 23,797 · calvin 19,129 · jfb 17,195 · wesley 16,968 · geneva 14,701 · treasury 12,745 · mhcc 4,136 · catena 2,966 |
| unembedded | **0** across all eight (checked per source) |
| versification canary | Treasury on Psalm 51 still anchors to `psa 51` ✓ |
| unknown book codes | see note below |

**Book coverage per new source** — a better check than the sampled one, and it matches each module's stated scope exactly:

| source | books |
|---|---|
| `adam-clarke` | 66/66 |
| `wesley-notes` | 64/66 |
| `geneva-notes` | 63/66 |
| `calvin-commentaries` | 48/66 *(its partial canon)* |
| `catena-aurea` | **4/66 — the four Gospels**, exactly as the module scopes |

**On the unknown-book-code query:** the whole-table `book not.in.(66 codes)` form times out — a full scan of 111,637 rows, the same shape as §Known limits below. The property still holds structurally: `parseHeadingRef` resolves against `BIBLE_BOOKS` and returns null for anything it cannot match, the driver **skips** unresolvable refs, and the A1 ingest recorded **zero unanchored chunks** across all 77,561. An unknown code is not reachable from the adapter.

### 6d. Retrieval baseline re-run (2026-08-07)

Same query as §6b, `"waiting on the Lord in a season of fear"`:

| # | sim | source | heading |
|---|---|---|---|
| 1 | **0.561** | **adam-clarke** | Psalm 27:14 |
| 2 | 0.551 | jfb | Psalm 130:5-6 |
| 3 | **0.549** | **wesley-notes** | Exodus 14:13 |
| 4 | 0.536 | treasury-of-david | Psalm 27:14 |
| 5 | 0.530 | treasury-of-david | Psalm 130:5 [2] |

**Source diversity doubled: 2 sources → 4** in the top five. Treasury's share fell from 4-of-5 to 2-of-5, and the new top hit (Clarke, 0.561) outscores the old top hit (JFB, 0.551).

The most interesting arrival is #3: Wesley on **Exodus 14:13** — *"Stand still and see the salvation of the LORD"* — a waiting-in-fear passage from **outside the Psalms**, which the three-source corpus never surfaced for this query. That is precisely what broadening was for. The similarity band is unchanged (~0.53–0.56), so slice-1c thresholds still hold.

`npx tsx scripts/library-fusion-smoke.ts` surfaces **five** sources across its four Psalm 27 queries — Treasury, Matthew Henry, Clarke, JFB and Calvin — with MHCC still placing.

**Watch item, in the tradition of §6b's MHCC note:** `catena-aurea`, `geneva-notes` and `wesley-notes` do not place in the fusion smoke. For Catena that is correct and expected — it is Gospels-only and every fusion query is on Psalm 27. Geneva and Wesley cover the Psalms and did not rank; not necessarily wrong (Geneva's notes are terse glosses, Wesley's are catchwords), but if neither surfaces across varied Gospel and Epistle queries, investigate before assuming they earn their place.

## 7. Re-running / rollback

Chunks upsert on `library_chunks_ident (source_id, heading, book, chapter, verse_start)` with `nulls not distinct`, and sources upsert on `id` — so a re-run is safe and idempotent.

To remove a source entirely:

```sql
delete from public.library_chunks where source_id = '<id>';
delete from public.library_sources where id = '<id>';
```

(The FK is `on delete cascade`, so deleting the source row alone also clears its chunks.)

## 8. Open follow-ups

- **Creeds.json** (Unlicense subset — the 8 copyright-restricted documents must be excluded by name) and **OpenBible topical scores** (CC BY) are planned v1 sources with adapters not yet written; neither file is in `scripts/data/` yet.
- **Matthew Henry Complete** (`MHC`, ~6–7M tokens) is deferred until slice 1c produces retrieval-quality data — Concise covers the same ground at an eighth the size.
- If a module is ever updated, re-run §4 and diff against the recorded counts before loading; a large swing means the module's keying changed and the dumper needs re-verification.

## 9. Troubleshooting

**`Cannot find module '/Users/<you>/scripts/ingest-library.ts'`** — the command ran outside the repo. All commands here are relative to the repo root; `cd` there first. A second tell is `npx` fetching `tsx` into `~/.npm/_npx` instead of using the repo's local copy.

**`Node.js 20 detected without native WebSocket support`** — `supabase-js` constructs a Realtime client at `createClient` time, and Node < 22 has no global `WebSocket`. `ingest-library.ts` handles this itself by handing Realtime an unused transport (it only ever issues REST calls), so this should not recur. `ingest-cross-references.ts` hit this for real on 2026-08-06 and now carries the same fix. The *remaining* ingest scripts in `scripts/` still have the latent issue and would need either `--experimental-websocket` or the same treatment if they're ever run on Node 20.
