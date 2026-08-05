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

**`Node.js 20 detected without native WebSocket support`** — `supabase-js` constructs a Realtime client at `createClient` time, and Node < 22 has no global `WebSocket`. `ingest-library.ts` handles this itself by handing Realtime an unused transport (it only ever issues REST calls), so this should not recur. Note that the *other* ingest scripts in `scripts/` have the same latent issue and would need either `--experimental-websocket` or the same treatment if they're ever run on Node 20.
