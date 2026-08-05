# Lamplight — Library & Reasoning (Depth Overhaul, Phase 1)

> Phase 1 of the depth overhaul decided in `2026-08-04-lamplight-depth-brainstorm.md` (§14 decision log). Research grounding: `docs/superpowers/research/2026-08-04-theological-source-library.md` (licenses verified) and `…-ai-faith-landscape-and-techniques.md` (grounding techniques, model capabilities). Assumes the Phase-0 quick fixes are merged (study tier fix, Layer C classifier wiring, content rules on reflections/etymology, spec thresholds).

## Purpose

Give every Lamplight surface two things it does not have today:

1. **A grounded library.** A license-clean corpus of the church's most trusted study material — Spurgeon's *Treasury of David*, Matthew Henry, JFB, the historic creeds, STEPBible lexicons, Berean interlinear, OpenBible topical scores — verse-anchored, embedded, and retrieved into study chat and Today's Lamp, with sources named per the by-surface visibility decision.
2. **Reasoning.** Migrate the OpenAI adapter from Chat Completions (where forced function tools require `reasoning_effort: 'none'`) to the Responses API, unlocking per-call reasoning effort — deep+high for Waymarks, budgeted effort elsewhere.

Plus the two trust structures that make both safe to ship: **deterministic Scripture verification** on every artifact, and a **live-model eval harness** (none exists today).

## Decisions log

1. **Corpus v1 = PD lean cut + CC-BY layer together** (brainstorm §14.1). Sources: `treasury-of-david`, `matthew-henry-concise`, `jfb`, `creeds` (Unlicense subset), `stepbible-lexicons` (TBESH+TBESG), `berean-interlinear`, `openbible-topics`. Matthew Henry *Complete* is a stretch goal behind the same schema (its ~6–7M tokens triple embed cost for overlapping coverage — Concise first, measure retrieval quality, then decide).
2. **Library chunks live in their own table** (`library_chunks`), not `lamplight_embeddings`. The chunk *is* the content (nothing to derive it from), it's global/public-read (no `user_id`), and it wants its own HNSW tuning and verse-range indexes. Mirrors how `bible_passages` is its own table.
3. **Same embedding space:** voyage-context-3, 512-dim — one query embedding serves notes, Bible, and library channels. No new Voyage config.
4. **Versification normalizes at ingest** via STEPBible TVTMS transforms inside the ingest scripts. No versification table ships; the DB stores only aligned OSIS refs (matching `bible_passages` id conventions). KJV-keyed sources (TSK-era commentaries) and Hebrew-Psalm-title offsets are the known hazards.
5. **By-surface visibility (brainstorm §14.2), v1 contract:** study chat may quote voices *by name* in prose; Today's Lamp draws substance without naming voices inline; both persist chunk-level provenance for the transparency panel. The `emit_chat_reply` citations schema is **unchanged** in v1 (`note|verse` only) — source attribution rides in prose + provenance, not the citations array. Extending the citation type is deferred until the panel proves insufficient.
6. **Journaling-side `lamplight-chat` gets NO library in v1.** Scope control: study chat and Today's Lamp are the two surfaces where depth is the product. The journaling chat inherits it in a later slice by passing the same context block.
7. **Responses API migration preserves the `LLMAdapter` interface exactly** (`generate`/`generateStream`, tool-forced JSON). Pipelines change only where they opt into `effort`. The tier seam (`fast|balanced|deep`) stays.
8. **Effort map v1:** Waymarks `deep/high`; study chat `deep/low` (protect streaming first-token latency; tune upward with data); study insight `deep/medium` (no user waiting on a keystroke); daily devotion `balanced/low`; judges + classifier + connection-why `fast/none`; etymology insight `deep/low`. Efforts are per-call parameters, so tuning is a one-line change per pipeline.
9. **`max_output_tokens` budgets rise where reasoning is on** (reasoning tokens count as output): reflections 2048→8192, study chat 1024→4096, insight 1024→3072. Cost is bounded by the effort level, not the ceiling.
10. **Verification repairs before it rejects.** A quoted verse that fuzzy-matches canonical text is silently replaced with the canonical rendering; only unresolvable refs or unmatched quotes become violations (`family: 'scripture'`) feeding the stricter retry. Never show the user a misquote; never fail an artifact a repair could save.
11. **Eval harness is on-demand, not CI-gating.** Real-model runs cost real money; the harness is a command run before any `prompt_version` bump or model/effort change, writing a dated report into `docs/lamplight/evals/`. CI keeps the existing mocked suites.
12. **Attribution ships as data + one screen.** `library_sources` carries render-ready credit lines; a "Sources" section (Study side panel footer + settings page) renders every source with its credit and license link — satisfying CC-BY for OpenBible/STEPBible on day one and doubling as the trust surface.

## Scope

### In
- Migration `058_library.sql`: `library_sources`, `library_chunks`, `match_library_chunks` RPC, indexes, RLS.
- Migration `059_artifact_library_provenance.sql`: `lamplight_artifacts.source_library_chunks jsonb` (chunk id + source id + heading snapshot).
- Ingest tooling: `scripts/ingest-library.ts` + per-source adapters + `docs/runbooks/library-ingest.md` (license evidence trail, mirroring `bible-translations-ingest.md`).
- `_shared/library-retrieval.ts`: two-channel retrieval (verse-range exact join + semantic) with RRF fusion and optional Voyage rerank.
- Study context + prompt updates (library excerpts block, voice-naming rules, lexicon block from TBESH/TBESG keyed by the chapter's `bible_interlinear` Strong's).
- Daily devotion context + prompt updates (devotional-register excerpts, no inline voice-naming).
- `_shared/openai.ts` → Responses API; per-call `effort`; streaming event parser rewrite; adapter test fixtures.
- `_shared/verse-verify.ts` extension: `verifyArtifactScripture` + repair; wired as a post-generation validator into daily devotion, chat replies (both surfaces), etymology insight, and reflection markers.
- `LamplightProvenancePanel` (the P2-2 "How was this written?" panel, expanded with library sources) on Today's Lamp + Waymarks detail.
- Eval harness v1: `scripts/eval-lamplight.ts` + synthetic persona fixtures + report format.
- Attribution surface ("Sources" screen/section).

### Out (explicitly)
- Journey Thread, note distillates, crisis layer (Phase 2 — design doc to follow).
- Curated OT↔NT quotation table, theme layer, connection explanations (Phase 3).
- Witnesses (Phase 4).
- NET-notes / Enduring Word corpora (v2, pending permission conversations).
- unfoldingWord TN/TW + Theographic (CC BY-SA quarantine layer — second library slice).
- Extending `emit_chat_reply` citations with a `source` type (decision 5).
- Journaling-chat library injection (decision 6).
- Client-side TSK / server cross-ref consolidation (Phase 3 alongside connections).

## Data model — migration `058_library.sql`

```sql
create table public.library_sources (
  id text primary key,                  -- 'treasury-of-david'
  title text not null,                  -- 'The Treasury of David'
  author text not null,                 -- 'Charles H. Spurgeon'
  era text not null,                    -- '1869–1885'
  tradition text not null,              -- 'Baptist (Reformed)'
  register text not null check (register in ('devotional','exegetical','confessional','lexical','topical')),
  license text not null,                -- 'Public domain' | 'CC BY 4.0'
  attribution text not null,            -- render-ready credit line incl. required links
  ingest_version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.library_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.library_sources(id) on delete cascade,
  -- Verse anchor (nullable for topical/confessional chunks). OSIS book codes,
  -- aligned to bible_passages conventions via TVTMS at ingest.
  book text,
  chapter int,
  verse_start int,
  verse_end int,
  strongs text,                         -- lexical chunks only ('H7462' / 'G26')
  topic text,                           -- topical chunks only ('anxiety')
  heading text not null,                -- 'Psalm 27:4 — exposition'
  content text not null,
  token_count int not null,
  embedding vector(512),
  created_at timestamptz not null default now()
);

create index library_chunks_verse_idx on public.library_chunks (book, chapter, verse_start, verse_end);
create index library_chunks_source_idx on public.library_chunks (source_id);
create index library_chunks_strongs_idx on public.library_chunks (strongs) where strongs is not null;
create index library_chunks_topic_idx on public.library_chunks (topic) where topic is not null;
create index library_chunks_embedding_idx on public.library_chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- Public read (global corpus), service-role write — mirrors bible_passages.
alter table public.library_sources enable row level security;
alter table public.library_chunks enable row level security;
create policy "library sources are readable by everyone" on public.library_sources for select using (true);
create policy "library chunks are readable by everyone" on public.library_chunks for select using (true);

create or replace function public.match_library_chunks(
  p_query_vector vector(512),
  p_limit int,
  p_registers text[] default null
) returns table (id uuid, source_id text, heading text, content text, similarity float, book text, chapter int, verse_start int, verse_end int)
language sql stable as $$
  select c.id, c.source_id, c.heading, c.content,
         1 - (c.embedding <=> p_query_vector) as similarity,
         c.book, c.chapter, c.verse_start, c.verse_end
  from public.library_chunks c
  join public.library_sources s on s.id = c.source_id
  where c.embedding is not null
    and (p_registers is null or s.register = any(p_registers))
  order by c.embedding <=> p_query_vector
  limit p_limit;
$$;
```

`059_artifact_library_provenance.sql`: `alter table public.lamplight_artifacts add column source_library_chunks jsonb;` — an array of `{chunk_id, source_id, heading}` snapshots (heading snapshotted so the panel renders even if a re-ingest rotates chunk ids).

## Ingestion — `scripts/ingest-library.ts`

One driver, per-source adapters, mirroring `ingest-bsb.ts` conventions (idempotent upserts, license header comments, `--source=<id>` selection, dry-run mode):

| Source | Input | Adapter work |
|---|---|---|
| treasury-of-david | SWORD `TDavid` via diatheke dump | Per-psalm sections → verse-anchored chunks (exposition per verse-range; "quaint sayings" grouped ≤600 tokens) |
| matthew-henry-concise | SWORD `MHCC` | Native verse-range keys → 1 chunk per comment block, split >600 tokens on paragraphs |
| jfb | SWORD `JFB` | Same as MHCC |
| creeds | Creeds.json (Unlicense subset only — exclude the 8 flagged docs) | 1 chunk per article/Q&A, `register='confessional'`, no verse anchor; scripture-proof refs kept in content |
| stepbible-lexicons | TBESH/TBESG TSV | 1 chunk per lemma keyed by `strongs`, `register='lexical'`; glosses + definitions only |
| berean-interlinear | Berean tsv/xlsx tables | Not chunked prose — feeds a `bible_interlinear` enrichment pass if columns are missing, else skipped in v1 (tables already exist via migration 041; adapter reconciles) |
| openbible-topics | Topical scores TSV | 1 chunk per topic (`topic` column set) listing top verses by votes, `register='topical'` |

Chunking rules (from the grounding research): **chunk on the source's own verse-range structure**, never fixed-size; prepend `"<author>, <era> — on <ref>:"` to the embedded text (retrieval carries authorship); 100–600 token bounds reusing `_shared/chunker.ts` limits for oversize splits; TVTMS-normalize refs before writing.

Embedding pass: batch Voyage calls (same `voyage.ts` deps), write via a `replace_library_embeddings`-style loop or direct update; ~8M tokens ≈ $1.50–5 one-time. Runbook records counts per source for idempotency checks.

## Retrieval — `_shared/library-retrieval.ts`

```ts
export interface LibraryExcerpt {
  chunkId: string; sourceId: string;
  sourceLabel: string;   // 'Treasury of David · Spurgeon, 1869–85'
  heading: string; content: string;
  score: number;
}

export async function searchLibrary(deps: RetrievalDeps, args: {
  refs: Array<{ book: string; chapter: number; verseStart?: number; verseEnd?: number }>; // anchor passage + top cross-refs
  queryEmbedding: number[];
  query: string;                      // for rerank
  k: number;
  registers?: string[];               // e.g. ['devotional'] for Today's Lamp
}): Promise<LibraryExcerpt[]>;
```

Two channels, fused:
1. **Verse-range exact join** — chunks whose `(book, chapter, verse range)` overlaps any anchor ref (SQL range-overlap on the composite index). Deterministic; this is the channel embeddings-only competitors don't have.
2. **Semantic** — `match_library_chunks(queryEmbedding, POOL, registers)`.

Fusion: reciprocal-rank fusion (k=60 constant) across the two ranked lists → top `2k` pool → optional Voyage rerank (reuse `rerank()`; gated by the existing `RERANK_ENABLED`) → top `k`. Per-surface budgets: study chat `k=4` (~≤1,200 tokens), study insight `k=2`, daily devotion `k=2` with `registers:['devotional']`.

## Prompt contracts

**Study chat (`study-chat.ts`, bump to v4):** new grounding block after cross-references:

```
Voices from the church's study:
[Treasury of David · Spurgeon, 1869–85 · Psalm 27:4]
<chunk content>
```

New instruction lines (composed into the existing system): theological claims beyond the passage's plain sense must come from the supplied voices or supplied passages; when leaning on a voice, name it in prose ("Spurgeon reads this as…"); when supplied voices disagree, present the disagreement honestly; never invent a source or attribute a claim to a voice that did not make it; the lexicon block (TBESG/TBESH entries for the chapter's Strong's numbers, replacing Phase-0's "no lexicon supplied" hedge) may be cited as "the lexicon glosses this as…".

**Daily devotion (`daily-devotion.ts`, bump prompt version):** excerpts arrive labeled but the instruction is inverse: *draw substance from the supplied study excerpts — a detail of the passage's argument, imagery, or setting you would not otherwise name — without quoting the old authors at length or naming them in the devotion; their names belong to the provenance panel.* Provenance: pipeline records used chunk ids into `source_library_chunks`.

## Responses API migration — `_shared/openai.ts`

- Endpoint → `https://api.openai.com/v1/responses`. Request: `{ model, instructions: system, input: messages→input items, tools: [{type:'function', name, description, parameters, strict: true}], tool_choice: {type:'function', name}, max_output_tokens, reasoning: { effort } }`.
- `GenerateInput` gains `effort?: ReasoningEffort` (`'none'|'low'|'medium'|'high'|'xhigh'|'max'`); tier defaults `fast→'none'`, `balanced→'low'`, `deep→'low'` — pipelines override upward per the effort map (decision 8). The `REASONING_EFFORT` constant and its Chat-Completions comment are deleted.
- Buffered parse: find `output[]` item `type:'function_call'` with matching `name`; `arguments` JSON string parses as today; usage from `usage.input_tokens/output_tokens` (reasoning tokens included in output count — cost map unchanged).
- Streaming parse: rewrite the SSE loop around Responses events — `response.function_call_arguments.delta` feeds `createToolJsonStreamParser` (unchanged), `response.completed` carries usage, `response.failed`/`error` events map to the existing throw contract. Refusals surface as `response.output_item` of type `message` with refusal content → same `openai refusal:` error.
- Adapter tests: fixture SSE transcripts for the new event stream (happy path, mid-stream error, length-truncation via `incomplete` status) replacing the Chat-Completions fixtures; the `LLMAdapter` seam means **no pipeline test changes**.
- Rollout: adapter lands with all pipelines on tier-default efforts (behavioral no-op except transport), then per-pipeline effort opts land as one-line diffs with eval runs (decision 11) before/after each.

## Scripture verification — `_shared/verse-verify.ts` extension

```ts
export interface ScriptureVerifyResult {
  ok: boolean;
  repairedText?: string;              // canonical replacements applied
  violations: Array<{ family: 'scripture'; rule: 'unresolvable_ref' | 'quote_mismatch'; snippet: string }>;
}
export async function verifyArtifactScripture(
  supabase: EdgeSupabase,
  args: { text: string; translation: string },
): Promise<ScriptureVerifyResult>;
```

Parse refs with the shared regex + OSIS map (already cross-runtime-mirrored) → bounds-check each against `bible_passages` (existing per-ref lookups, BSB fallback) → for quotes: any ≥6-word span inside quotation marks adjacent to a ref is normalized (case/punctuation/whitespace) and matched against canonical text; ≥0.9 token overlap → **repair** to canonical; below → `quote_mismatch` violation. Wire points: daily devotion (`scripture.text` + reflection prose), chat replies (both surfaces, post-stream — repairs apply to the persisted+done payload; the streamed text may differ, disclosed by the existing `refining` beat), etymology body, reflection markers (`unresolvable_ref` only — letters carry no verse-level citations by design). This closes backlog P2-8 with repair semantics.

## Transparency — `LamplightProvenancePanel`

Shared component fed by artifact rows: sources drawn from (note titles for `source_note_ids`), verses (`source_verses`), library sources (`source_library_chunks` → source label + heading), `model_used`, `prompt_version`. Surfaces: an unobtrusive icon on `TodaysLampCard` and Waymarks detail. The "Sources" screen (decision 12) renders `library_sources` rows grouped by license, with attribution links — the CC-BY obligation and the trust story in one place.

## Eval harness v1 — `scripts/eval-lamplight.ts`

- Fixtures: ~10 synthetic personas × months under `scripts/eval-fixtures/` (sparse month, grief month, ordinary month, doubt season, heavy-study month, contested-passage-heavy, no-name profile, long-vault, new-user, non-English-name). Each: notes + highlights + expected-property assertions.
- Modes: `--artifact=reflection|devotion|study-chat` × `--live` (real key, real models) vs `--dry` (context assembly only).
- Checks per run: deterministic validators pass; `verifyArtifactScripture` finds zero violations; judge verdicts; banned/contested/growth families clean; token + cost tally per artifact; output snapshots written to `docs/lamplight/evals/<date>-<label>/` for human read-through.
- Gate: run before any `prompt_version` bump, model id change, or effort change; the report lands in the PR.

## Acceptance criteria

1. `select count(*) from library_chunks group by source_id` matches the runbook's recorded counts; every chunk with a verse anchor resolves against `bible_passages` ids (TVTMS spot-check on Psalm 51 and Joel 2/3 boundaries).
2. Study chat on Psalm 27 surfaces at least one Treasury of David excerpt, names Spurgeon in prose when leaning on him, and cites only supplied refs (existing citation validator green).
3. Today's Lamp provenance panel lists the library sources used; the devotion body itself names no commentator.
4. All pipelines run on the Responses adapter; Waymarks generates at `deep/high` via the sweep; usage rows record real token counts including reasoning.
5. `verifyArtifactScripture` wired on all four surfaces; a seeded misquote fixture is repaired to canonical text; an unresolvable ref triggers the stricter retry.
6. Attribution screen renders OpenBible + STEPBible credit lines with links.
7. Eval harness produces a dated report on the fixture set with zero scripture violations; the report for the migration PR is checked in.
8. Gates: `npx tsc -b`, full `vitest run`, eslint on touched files; RLS isolation test extended to the two new tables (public read, no client write).

## Files touched / created

**New:** `supabase/migrations/058_library.sql`, `059_artifact_library_provenance.sql`; `scripts/ingest-library.ts` + `scripts/library-adapters/*.ts`; `docs/runbooks/library-ingest.md`; `supabase/functions/_shared/library-retrieval.ts` (+test); `supabase/functions/_shared/reasoning-effort.ts` (effort map constants, +test); `src/notepad/lamplight/LamplightProvenancePanel.tsx` (+test); `src/notepad/settings/SourcesScreen.tsx` (+test); `scripts/eval-lamplight.ts` + `scripts/eval-fixtures/`.

**Modified:** `_shared/openai.ts` (+test rewrite); `_shared/verse-verify.ts` (+test); `lamplight-study/study-context.ts` + `prompts/study-chat.ts` (v4) + `prompts/study-insight.ts`; `lamplight-generate/index.ts`, `daily-devotion-pipeline.ts` + `prompts/daily-devotion.ts`; `monthly-reflection-pipeline.ts` (effort + marker verification); `bible-chat-pipeline.ts` (verification only); `TodaysLampCard.tsx`, Waymarks detail; `src/admin/lamplight-cost.ts` (verify prices at ship time — standing health check).

## Sequencing inside Phase 1

1. **1a Responses adapter** (transport no-op → per-pipeline efforts) — unblocks everything, riskiest diff, land first with eval before/after.
2. **1b Library schema + ingest** (parallel with 1a; pure additive) — migration via SQL Editor per house workflow, then ingest + embed.
3. **1c Retrieval fusion + study/devotion prompts + provenance columns** — depends on 1b.
4. **1d Verification + panel + Sources screen + eval harness** — verification and the harness can start alongside 1a (they don't need the library).

Each numbered slice gets its own implementation plan in `docs/superpowers/plans/` per the workflow.

## Open questions (small, non-blocking)

- Matthew Henry Complete in v1 or after retrieval-quality data? (Default: after.)
- Library rerank default on or off? (Default: follow existing `RERANK_ENABLED`; A/B rides backlog P3-5.)
- Does the Sources screen live under Profile → About or the Study side panel footer? (Default: both link the same screen.)
- Effort for study chat once latency data exists (`low` → `medium`?).
