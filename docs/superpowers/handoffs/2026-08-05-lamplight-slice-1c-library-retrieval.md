# Handoff: Lamplight slice 1c — library retrieval fusion + prompts

**Date:** 2026-08-05
**Status:** READY TO EXECUTE. The plan is written and its dependency (slice 1b) is complete and verified. Start by reading the plan, then implement task-by-task with `superpowers:executing-plans` (or `subagent-driven-development`).
**Branch:** work continues on `feat/responses-api-migration` (the whole depth-overhaul train lives there; it squash-merges as one PR). Latest commit `531c1c22`. Only two untracked files, both pre-existing July plan docs unrelated to this work.

## Read these first, in this order

1. **The plan you are executing:** `docs/superpowers/plans/2026-08-06-library-retrieval-and-prompts.md` — 8 tasks, TDD, with the load-bearing constraints called out.
2. **The design it comes from:** `docs/superpowers/specs/2026-08-04-lamplight-library-and-reasoning-design.md` (decisions 5 and 6 govern this slice).
3. **The initiative's decision log:** `docs/superpowers/specs/2026-08-04-lamplight-depth-brainstorm.md` §14 — six decisions the user made; do not relitigate them.
4. **What 1b actually produced:** `docs/runbooks/library-ingest.md`, especially §4 (counts) and §6b (retrieval baseline).

## What is already done

| Slice | State | Commits |
|---|---|---|
| Phase 0 (quick fixes, Layer C, tier drift) | shipped | `c1173be7` |
| 1a — Responses API + reasoning efforts | shipped | `35e52c23` |
| 1b — library schema + ingest | **shipped and verified** | `882bede4` → `531c1c22` |
| **1c — retrieval fusion + prompts** | **← you are here** | — |
| 1d — verification, provenance panel, evals | planned, unblocked | — |

**The corpus is live in the database.** 34,076 chunks, all embedded:

| source_id | chunks | verse-anchored | tokens |
|---|---|---|---|
| `treasury-of-david` | 12,745 | 11,947 | 2.91M |
| `matthew-henry-concise` | 4,136 | 4,136 | 0.93M |
| `jfb` | 17,195 | 17,195 | 2.34M |

Verified: unembedded = 0; orphan verse anchors = 0 (all 33,278 anchors resolve against `bible_passages`); `match_library_chunks` returns apt results.

Schema (migrations 058/059, already applied): `library_sources`, `library_chunks` (with `embedding extensions.vector(512)`, HNSW), the `match_library_chunks(p_query_vector, p_limit, p_registers)` RPC, and `lamplight_artifacts.source_library_chunks jsonb`.

## Facts from 1b that the plan predates — these change how you build 1c

1. **The similarity band for a GOOD match on this corpus is ~0.52–0.55.** Do not carry over note-similarity thresholds — the connection-cards threshold is `0.78` and would return nothing here. Baseline in runbook §6b.
2. **There is no lexical library source, deliberately.** The plan's Task 3 says to build a lexicon block; build it reading `bible_strongs` + `bible_interlinear` (migration 041) **directly** — they already hold Strong's data publicly, and duplicating it into `library_chunks` was dropped during 1b. Join: `bible_interlinear.verse_id` → `strongs` → `bible_strongs`.
3. **Creeds and OpenBible-topics chunks do not exist yet** (adapters unwritten, source files absent). Any `registers` filter must therefore tolerate `confessional`/`topical` returning nothing. Registers currently present: `devotional` (Treasury, MHCC), `exegetical` (JFB).
4. **`matthew-henry-concise` did not place in the baseline top-5.** Plausible — smallest source, summarises passage blocks rather than single verses. **Confirm during Task 8 that it surfaces on some queries.** If it never does, investigate before assuming it earns its context budget.
5. **Headings carry structural suffixes** you will see in output and should not "clean up": `Psalm 130:5 [2]` means Treasury's second section commenting on that verse (they carry genuinely different text); `Psalm 25:5 [3] (1/2)` adds chunk-splitting. Both are load-bearing for idempotency.
6. **`content` is stored with an embedding prefix** — `"Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:\n<body>"`. Decide deliberately whether prompts show that prefix or strip it; `sourceLabel` from `library_sources` is the cleaner label for prompt rendering.

## Load-bearing constraints (from the plan — do not soften)

- **Library excerpts must NOT expand `allowedVerseRefs`.** A commentary mentioning Isaiah 40:31 does not authorise citing it — the verse text was never supplied, and the citation validator exists precisely to stop that. Task 4 requires a test asserting `allowedVerseRefs` is byte-identical with and without library excerpts.
- **Graceful degradation is mandatory.** Empty table, failed query, Voyage error → `[]`, and the turn proceeds on today's grounding. Precedent: `retrieveRelatedPassages` in `lamplight-study/study-context.ts` (~line 70) wraps everything in try/catch. The library must never be able to break a devotion or a chat reply.
- **No new migrations.** Verse-anchor channel uses a PostgREST `.or()` over `(book, chapter)` pairs plus a pure JS overlap filter — keeps the slice code-only and revertible.
- **Bump `promptVersion` on every prompt change** (`study-chat-2026-08-04-v3` → `-v4`; daily-devotion likewise). It is persisted per artifact and is how 1d's eval attributes quality.
- **Citations schema is frozen in v1** — `emit_chat_reply` stays `type: 'note' | 'verse'`. Source attribution rides prose + provenance, not the citations array.
- **Journaling chat (`lamplight-chat`) gets NO library in v1** (design decision 6). Add the new `BibleChatContext` fields as **optional** so that path is untouched by construction.
- **Reflections/Waymarks are out of scope** for this slice.

## Conventions this repo enforces

- Gates before done, all three: `npx tsc -b` (exit 0), `npx vitest run supabase/functions`, `npx eslint <touched files>`. Pre-existing noise that is NOT yours: ~100 repo lint errors, and 2 `react-hooks/refs` errors in `src/notepad/hooks/useConnectionDiscovery.ts`.
- Vitest 4 with `globals: false` — import `describe/it/expect/vi` from `'vitest'`. Component tests need `// @vitest-environment jsdom` as the **first line** plus a top-level `afterEach(cleanup)`.
- `supabase/functions/_shared/**` must stay free of Deno globals so vitest can import it.
- **Commit only when the user asks.** Messages present-tense, scoped `feat(lamplight): …`, and end with the `Co-Authored-By` trailer used on the commits above.
- Migrations apply **manually via the Supabase SQL Editor** — CLI `db push` is broken on this machine. (Not needed for 1c.)

## Hard-won gotchas (each cost real debugging in 1b)

- **PostgREST caps a response at ~1000 rows.** Any `select` that could exceed that must paginate or `.limit()`. This silently left 91% of the corpus unembedded and reported success. If a count comes back suspiciously round, suspect this first.
- **`supabase-js` needs a WebSocket at `createClient`** and Node 20 has none. Scripts use `createIngestClient` in `scripts/ingest-library.ts`, which passes an unused Realtime transport. Edge functions are unaffected.
- **Run scripts from the repo root.** A wrong cwd surfaces as `Cannot find module '/Users/<you>/scripts/...'`, and `npx` fetching `tsx` into `~/.npm/_npx` is the tell.

## Useful commands

Retrieval sanity check against the live corpus (read-only, one Voyage query):

```bash
cd /Users/myles/Downloads/Psalms_app && SUPABASE_URL="$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" SUPABASE_SERVICE_ROLE_KEY='...' VOYAGE_AI_KEY='...' npx tsx scripts/library-retrieval-smoke.ts --query="your query" --k=5
```

`.env.local` holds `VITE_SUPABASE_URL` and the **anon** key only — the service-role key (Supabase dashboard → Project Settings → API) and `VOYAGE_AI_KEY` must be supplied by the user. Ask; do not guess or search for secrets.

## Definition of done for 1c

The plan's Task 8 spells it out. In short: Study chat on a psalm surfaces a commentary excerpt and names its voice in prose, citing only allowed refs; a chapter with no library coverage behaves exactly as it does today with no empty prompt blocks; Today's Lamp names no commentator but persists `source_library_chunks`; all three gates green; the prompt-size/cost delta measured and recorded (this is the first slice that materially grows a prompt).

## After 1c

Slice 1d (`docs/superpowers/plans/2026-08-07-verification-provenance-and-evals.md`) — Scripture verification with repair, the provenance panel, the Sources screen (CC-BY compliance for OpenBible/STEPBible), and the first live-model eval harness. Its verification half depends on nothing from 1b/1c and could equally run first if the user prefers.

Also still open, unrelated to 1c: the Phase-0 `app_config` threshold SQL (`lamplight_min_similarity` 0.3 → 0.78) and a live run of `scripts/smoke/openai-adapter-smoke.ts` before 1a deploys.
