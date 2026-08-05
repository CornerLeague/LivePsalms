# Research: Theological Source Library for Lamplight Grounding

> Deep-research report, 2026-08-04. License claims marked **[verified]** were confirmed by fetching the actual license/terms page during research; **[unverified]** needs a human check before shipping. Context: commercial app (RAG corpus / bundled datasets / AI-generated devotionals, reflections, study chat, cross-reference insights).

## 1. Public-domain whole-Bible commentaries

**Machine-readable channels** (referenced per-work below):

- **CrossWire SWORD modules** — https://www.crosswire.org/sword/modules/ModDisp.jsp?modType=Comments — **[verified]** hosts Matthew Henry Complete (`MHC`) + Concise (`MHCC`), `JFB`, `Barnes` (NT), `Clarke`, `KD` (Keil & Delitzsch), `CalvinCommentaries`, `Geneva`, `Wesley`, `TSK`, and `TDavid` (Spurgeon's Treasury of David), plus Robertson's Word Pictures, Scofield 1917, Luther, Catena Aurea. Verse-keyed — ideal for RAG chunking. Extract via `diatheke`/libsword or Python `pysword`. Gotcha: the `SWORD-to-JSON` converter handles Bible modules only, not commentaries — use diatheke dumps for commentaries.
- **CCEL (ccel.org)** — canonical transcriptions, but **[verified via ccel.org/about/copyright.html]** CCEL claims copyright on *their formatting/editions* even where the underlying text is public domain; commercial republication of their files requires permission. Use CCEL for reference/QA; bundle text from SWORD/e-Sword transcriptions instead (or get CCEL permission).
- **e-Sword / MySword modules** (biblesupport.com) — SQLite-based, easy to extract; covers works missing from CrossWire (notably Poole, Gill complete).
- **TheologAI** — https://github.com/TJ-Frederick/TheologAI — MCP server bundling 6 PD commentaries (Matthew Henry, JFB, Clarke, Gill, Keil-Delitzsch, +) as compressed JSON/SQLite — closest ready-made JSON dump found. **[existence verified; audit provenance before shipping]**

| Work | Credibility | Status | Machine-readable | Notes |
|---|---|---|---|---|
| Matthew Henry Complete (1708–10) | Most-loved devotional commentary in English; trusted across traditions | PD | SWORD `MHC`; CCEL; TheologAI | ~5M words est.; devotional tone fits Lamplight |
| Matthew Henry Concise | Verse-range-keyed abridgment | PD | SWORD `MHCC` | ~600k words; best cost/coverage ratio |
| Jamieson-Fausset-Brown (1871) | Standard one-volume exegetical | PD | SWORD `JFB`; TheologAI | Terse, verse-keyed — very RAG-friendly |
| John Gill (1746–63) | Baptist; strongest on Hebraica/rabbinics | PD | e-Sword/MySword modules | Largest (5–10M words); no clean canonical dump — extract from modules |
| Albert Barnes (1830s–50s) | Presbyterian pastor's classic; whole NT + much OT | PD | SWORD `Barnes` (NT); e-Sword for OT | Confirm OT coverage per module |
| Adam Clarke (1810–26) | Methodist polymath; strong philology | PD | SWORD `Clarke`; TheologAI | Some idiosyncratic views — one voice among several |
| Matthew Poole (1685) | Puritan synopsis tradition | PD | e-Sword module (biblesupport.com file 772) | Not in CrossWire |
| Keil & Delitzsch (Eng. tr. 1866–91) | Scholarly conservative OT standard | English tr. PD | SWORD `KD`; TheologAI | Technical; normalize transliterated Hebrew before embedding |
| Calvin's Commentaries (CTS tr. 1840s–50s) | Reformation cornerstone | CTS translations PD | SWORD `CalvinCommentaries`; CCEL | Doesn't cover every book |
| Geneva Bible notes (1560/1599) | The Reformation study Bible | PD original; **Tolle Lege modernized edition is copyrighted — avoid** | SWORD `Geneva` | Short, pointed; archaic spelling |
| Wesley, Explanatory Notes (1755–66) | Methodist founder | PD | SWORD `Wesley`; CCEL | Brief, warm, devotional |
| **Spurgeon, Treasury of David** (Psalms) | The single best Psalms resource — flagship fit for a Psalms-branded app; Spurgeon d. 1892 | PD | SWORD `TDavid` **[verified in module list]**; archive.org | ~2.5–3M words; per-Psalm structure (exposition + quaint sayings + hints) chunks beautifully |

## 2. Modern openly-licensed study resources

### NET Bible + 60k translators' notes — usable only with permission
- ~25 evangelical seminary scholars; famous for 60,932 translators' notes showing translation reasoning.
- **[verified at netbible.com/copyright]**: Scripture text (without notes) freely quotable non-commercially with attribution; **the notes are explicitly excluded** from the free grant; the older bible.org notice prohibits reformatting/bundling the data files without express permission; commercial publication routes through HarperCollins licensing. bible.org markets a "ministry first" posture (most requests get yes), but **bundling notes in a commercial app requires written permission**.
- Verdict: pursue the permission conversation — nothing else matches the notes' quality. Don't bundle until signed.

### unfoldingWord — the license-cleanest modern study layer
- **[verified at unfoldingword.org/for-translators/content]**: "Each resource is made available under **CC BY-SA 4.0**." Commercial use permitted.
- **Translation Notes (en_tn)** (TSV, verse-keyed), **Translation Words (en_tw)** (markdown), UHB/UGNT tagged original texts — all on Door43 git (git.door43.org/unfoldingWord/…).
- Gotcha: written for Bible *translators* (phrase-rendering focus) — excellent for "what does this phrase mean," weaker for application. ShareAlike: keep as a quarantined data layer.

### Tyndale House Cambridge — STEPBible-Data
- **[verified at github.com/STEPBible/STEPBible-Data]**: **CC BY 4.0** — credit "STEP Bible" linked to www.STEPBible.org. Explicitly permits software inclusion.
- Contents: **TBESH** (Hebrew lexicon by extended Strong's), **TBESG** (Greek lexicon, updated Abbott-Smith/Thayer-derived), TFLSJ (full LSJ), **TAHOT/TAGNT** (tagged OT/NT: morphology + semantics), TIPNR (proper names), **TVTMS (versification mapping — solves cross-dataset verse alignment)**. TSV format.
- Verdict: **best single original-language grounding source, license-clean.**

### Enduring Word (David Guzik)
- Most-used free contemporary verse-by-verse commentary; in YouVersion/e-Sword by permission.
- **[verified via enduringword.com/permissions excerpts]**: free for free-Bible-study use with attribution; **profit-related use requires requested permission**. Track record of granting (e-Sword, faith.tools). Worth the email; best modern devotional-register commentary legally addable.

### Not usable as corpus
- **BibleProject** — **[verified terms]**: non-commercial only, **no derivatives**. Do not ingest.
- **Got Questions** — **[verified copyright page]**: commercial use capped at 200 words/article, ≤10% of containing work. Unusable as corpus.
- **Blue Letter Bible** — **[verified permissions]**: no scraping; no-fee redistribution only. Its underlying PD data is available from open sources anyway.

## 3. Cross-reference + topical datasets

- **Treasury of Scripture Knowledge** (~1830s; the classic ~500–640k ref set). PD. SWORD `TSK`; best structured derivative is OpenBible's cleaned version. Keyed to KJV versification — map through TVTMS.
- **OpenBible.info Cross References** — **[verified]**: ~**340,000 refs with user votes**, 2 MB TSV zip, **CC Attribution**. Run by Stephen Smith (respected Bible-tech figure). Use as a *selection* graph, not embedded prose. Also mirrored in **scrollmapper/bible_databases** (**[verified]** MIT repo; underlying xref data remains CC-BY OpenBible). *Note: this is exactly the dataset already ingested as `bible_cross_references` (migration 033).*
- **Nave's Topical Bible** (1896) — 20,000+ topics; PD; SWORD `Naves` / e-Sword; CCEL edition caveat applies.
- **Torrey's New Topical Textbook** (1897) — PD by age; SWORD/e-Sword; smaller; good devotional topic seeds.
- **Thompson Chain References** — **[verified via bible-discovery.com]**: 1934 copyright **not renewed → PD since 1962**, BUT "Thompson Chain-Reference" is a live Kirkbride/Zondervan **trademark**; modern editions add copyrighted refinements. Practical call: skip; Nave's + OpenBible cover the need without trademark risk.
- **OpenBible.info Topical Bible** — **[verified]**: votes-ranked topic→verse scores, weekly downloads, **CC Attribution**. Modern phrasing ("anxiety," "loneliness") complements Nave's 19th-century labels.

## 4. Original-language data

| Resource | License | Source | Notes |
|---|---|---|---|
| Strong's numbers/dictionaries (1890) | Text PD; openscriptures/strongs repo has **no top-level LICENSE [verified]** | github.com/openscriptures/strongs | Prefer STEPBible TBESH/TBESG as cleaner Strong's-keyed sources |
| Brown-Driver-Briggs (1906) | **[verified]** files CC BY 4.0; underlying text PD | github.com/openscriptures/HebrewLexicon | BDB XML is WIP — supplemental |
| Thayer's (1889) | PD by age | e-Sword/SWORD | Dated; superseded by TBESG |
| Abbott-Smith (1922) | PD **[verified via search]** | github.com/translatable-exegetical-tools/Abbott-Smith | Seed of unfoldingWord's Greek lexicon |
| OSHB morphology | **[verified]** CC BY 4.0 (WLC text PD) | github.com/openscriptures/morphhb | OSIS XML |
| MorphGNT / SBLGNT | **[verified]** analysis CC BY-SA 3.0; **SBLGNT text now CC BY 4.0** per sblgnt.com/license (MorphGNT README's EULA citation is stale) | github.com/morphgnt/sblgnt | License-clean critical Greek text + morphology |
| **Berean interlinear / translation tables** | **[verified at berean.bible/terms.htm]**: dedicated to **public domain** 2023-04-30, explicitly incl. interlinear; free commercial use | berean.bible/downloads.htm (xlsx/tsv) | Easiest PD interlinear-grade dataset; ideal for "what does the Greek say" |
| Louw-Nida semantic domains | **Copyrighted (UBS)** — licensed only via Logos/Accordance | n/a | **Do not ingest.** Substitute: unfoldingWord TW + STEP semantic tags |

## 5. Knowledge graphs / structured data

- **Theographic Bible Metadata** — github.com/robertrouse/theographic-bible-metadata — people/places/periods/events/passages graph behind Viz.Bible. **[verified from README]** **CC BY-SA 4.0**. JSON/CSV/Neo4j. Gotchas: KJV versification keys; Airtable-export artifacts in CSV. Excellent for entity grounding in study chat.
- **Viz.Bible site artwork** — "all rights reserved" **[verified]** — use the data, not the artwork.
- **OpenBible.info Geocoding** — **[verified]** CC Attribution; lat/longs for identifiable biblical places; some coordinates derive from OSM (ODbL attribution stacking). KML/tab-delimited.
- **BradyStephenson/bible-data** — person tables (labels with Strong's + name meanings, relationships, person↔verse), events, epochs; **CC BY 4.0 [verified by the intertextuality research pass]**.

## 6. Creeds, confessions, catechisms

- **Creeds.json** — github.com/NonlinearFruit/Creeds.json **[verified]**: 43 documents as JSON (Apostles', Nicene, Athanasian, Chalcedonian; Westminster + catechisms; Heidelberg; Belgic; Dort; 1689 LBC; Augsburg; 39 Articles…). **Mixed licensing: most under The Unlicense; 8 documents copyright-restricted** (e.g., Chicago Statement). Ship the Unlicense subset; exclude the flagged 8.
- Trap: historic texts are PD; **modern denominational translations** (contemporary Heidelberg/Nicene renderings) are copyrighted. Creeds.json's per-document license metadata is the guardrail.

## 7. Bible translation text + APIs

**Fully clean to bundle:** BSB (**[verified]** PD since 2023-04-30 — already the app's base translation), WEB (**[verified]** PD; trademark on the *name* for modified text), KJV (PD in US; UK Crown letters-patent caveat — already noted in the repo's ingest runbook), ASV. eBible.org is the master USFM/USX distribution point.

**Conditionally usable:** NET (text quotable with attribution; notes/data-file bundling needs bible.org permission; commercial publication via HarperCollins).

**Restricted:** ESV API (**[verified]** non-commercial only, 500-verse caps, no local storage beyond 500 verses — commercial app needs a direct Crossway license); NIV (**[verified via Biblica excerpts]** commercial reference products need written Zondervan permission; Biblica "generally does not issue licenses for products still in development"); NASB/Amplified (Lockman), CSB (Lifeway) similar. **API.Bible** (**[verified]**): Starter $0 = non-commercial; **Pro $29+/mo = 150k calls, copyrighted translations from ~$10/mo each — the realistic legal route to NIV/CSB/NASB/NKJV/NLT** without negotiating five publisher contracts. bible-api.com (hobby, 15 req/30s — prototyping only); bolls.life (no published license — not a foundation); wldeh/bible-api (MIT repo, per-version text rights — PD versions only); getBible v2 (keyless JSON from SWORD modules — secondary source).

**Recommended architecture:** bundle BSB (+WEB/KJV) locally as the AI-response scripture layer — zero legal exposure, no rate limits (this is already the app's architecture); when the user's reading translation is copyrighted (future), have the AI quote BSB and label it, or stay within per-translation quote allowances with correct notices. Matches backlog P3-8 ("read-time-only via API; never store; embeddings stay BSB").

## 8. Devotional classics (flavor/quotes)

- **Spurgeon, Morning & Evening** — PD; 732 short readings; natural daily-devotional seed corpus.
- **Chambers, My Utmost for His Highest** — **NOT usable**: US copyright renewed 1963; 1992 updated edition separately copyrighted. Exclude.
- **Augustine, Confessions** — PD in **Pusey (1838)** translation; avoid Chadwick/Boulding (copyrighted).
- **Brother Lawrence, Practice of the Presence of God**; **Bunyan, Pilgrim's Progress** — PD.
- Pre-1929 hymn *texts* (Watts, Wesley, Newton, Crosby) PD; modern translations/arrangements often copyrighted — check per hymn via hymnary.org.

## Recommended core corpus v1 (by value-to-risk)

| # | Source | License | Format | Est. size | Attribution |
|---|---|---|---|---|---|
| 1 | Berean Standard Bible + interlinear tables | PD | USFM/TSV/xlsx | ~5 MB text (~1.3M tok); tables ~25 MB | none (appreciated) |
| 2 | World English Bible | PD | USFM/USX | ~5 MB | name only on unmodified text |
| 3 | Matthew Henry Concise + Complete | PD | SWORD → JSON | ~0.8M + ~6–7M tok | none |
| 4 | **Spurgeon, Treasury of David** (Psalms flagship) | PD | SWORD `TDavid` → JSON | ~3–4M tok | none |
| 5 | JFB (+ optionally Barnes/Clarke as second exegetical voice) | PD | SWORD → JSON | ~1.5–2.5M tok each | none |
| 6 | OpenBible xrefs + topical scores + geocoding | CC BY | TSV | ~5 MB (graph, not embedded prose) | "OpenBible.info" |
| 7 | STEPBible TBESH/TBESG + TAHOT/TAGNT + TVTMS | CC BY 4.0 | TSV | ~50–100 MB raw | "STEP Bible" → stepbible.org |
| 8 | unfoldingWord TN + TW | CC BY-SA 4.0 | TSV/MD | ~4–6M tok | attribution + ShareAlike quarantine |
| 9 | Theographic metadata | CC BY-SA 4.0 | JSON/CSV | ~15–25 MB | attribution + ShareAlike quarantine |
| 10 | Creeds.json (Unlicense subset) | Unlicense | JSON | ~2 MB | none |

**Totals:** ~150–250 MB raw / ~20–30M embeddable tokens. **Lean first cut** (BSB + WEB + MHCC + Treasury of David + OpenBible xrefs + Creeds subset): ~**8M tokens / ~50 MB** — small enough to embed and ship fast, with zero attribution obligations beyond courtesy lines.

**Engineering gotchas:**
1. **Versification alignment is the #1 silent data bug** — TSK/Theographic/old commentaries key to KJV; Hebrew Psalm titles shift verse numbers. Normalize through STEPBible **TVTMS** at ingest.
2. **CC BY-SA quarantine** — keep unfoldingWord + Theographic in a separately-licensed data package; per-chunk `license` + `attribution` metadata lets the app render source credits inside AI answers (trust win too).
3. **CCEL files are not license-free** even when the author is PD.
4. **Chunk commentaries by their native verse-range keys** (SWORD modules store this) and prepend canonical ref + author + era to each chunk.
5. Two licensing conversations for v2: **bible.org (NET notes)** and **Enduring Word (Guzik)** — both permission-required but permission-friendly; the two best modern-language layers.
