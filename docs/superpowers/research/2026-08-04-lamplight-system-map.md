# Research: Lamplight System Map (as of feat/lamplight-gpt-migration, 2026-08-04)

> Condensed audit of the AI system as it stands, produced for the depth-overhaul brainstorm. File:line refs are anchors, verified during the audit.

## Model layer
- Provider-neutral tiers in `supabase/functions/_shared/openai.ts:25-31`: `fast → gpt-5.6-luna`, `balanced → gpt-5.6-terra`, `deep → gpt-5.6-sol`. Chat Completions, forced single function tool.
- **`REASONING_EFFORT = 'none'` on every call** (openai.ts:33-40): gpt-5.x reasoning models reject function tools on Chat Completions unless effort is none. Per the comment: "Lifting this would mean moving to the /v1/responses API."
- Streaming variant parses tool-JSON field deltas (openai.ts:153-238). Retries on 429/5xx ×3.
- Embeddings: `voyage-context-3`, DIM 512, + `rerank-2.5` behind env `RERANK_ENABLED` (`_shared/voyage.ts`).

## Pipelines & models per artifact
| Artifact | Tier | Where |
|---|---|---|
| daily_devotion (Today's Lamp) | balanced | daily-devotion-pipeline.ts:294,338 |
| monthly_reflection (Waymarks) | balanced; judge on fast | monthly-reflection-pipeline.ts:180; reflection-judge.ts:71 |
| connection_card_why | fast, 256 tok | connection-why-pipeline.ts:104-106 |
| bible_chat (journaling chat) | balanced | bible-chat-pipeline.ts:124 |
| bible_study (Study chat) | **deep on buffered path only** — streaming path (client default) falls back to balanced | lamplight-study/index.ts:234 vs :182; bible-chat-pipeline.ts:164 |
| etymology verse insight | deep | etymology-insight/index.ts:84 |
| note transcription (vision OCR) | balanced, 4096 tok | transcribe-note/handler.ts:62-74 |

## Voice & guardrails (`_shared/voice.ts`)
- `LAMPLIGHT_SYSTEM_FRAGMENT`: "companion of rare insight… thinks like a theologian and a careful student of the human heart"; illumination-not-pronouncement; adaptive divine name (Lord/Father/Abba/Jesus); "historic, creedal Christian orthodoxy," denominationally neutral; economy + freshness; name ≤2×.
- Never-do list: no prophetic speech; contested passages named gently and deferred to pastor/study group; never condemn doubt/anger; psychological insight but no clinical counsel; no streak language.
- `BANNED_PHRASES` (9 prophetic regexes), `CONTESTED_PASSAGES` (Rev 13/17, Dan 9/12, 1 Cor 11:2-7 & 14:34-35, 1 Tim 2:11-15, Rom 9:11-23, Eph 1:4-5, Matt 24, Mark 13, 2 Thess 2), `GROWTH_BANNED_PHRASES`.
- Personalization today = sanitized first name only (`_shared/personalization.ts`).

## Reflections (Waymarks) quality machinery
- Candidate pool, 5 provenances, month-scoped (reflection-candidates.ts): flagged (transcription verse_flags), highlighted (bible_highlights), studied (chat threads), focus_listed (focus lists), semantic (match_bible_embeddings on month's notes). Trail outranks semantic; cap 12.
- Six deterministic validators (reflection-validators.ts): shape/word-bounds; verse allowlist + no verse-level citations in prose; marker anchoring to real note days; no-scorecard regexes; witnessed-not-reopened (no 8-word verbatim run from notes); provenance non-empty.
- LLM register judge (fast tier) sees artifact + raw notes; failures feed the single stricter retry. `repairOffListVerses` nulls off-list marker verses instead of dropping markers.
- Offline voice eval exists but mocks the LLM (reflection-voice-eval.test.ts — "guardrails only, never prose"). **No live-model eval harness anywhere.**
- Cadence machinery: reflection sweep + jobs + `select_monthly_reflection_cohort()` + hourly pg_cron (migrations 045-047); arrival hour 7 local; backfill cap 12.

## Retrieval & context
- `match_bible_embeddings` over BSB verse embeddings (semantic index BSB-only; text hydrated in user translation with BSB versification fallback). `match_user_note_embeddings` per-chunk fan-out for neighbors; rerank optional.
- Study context (study-context.ts): chapter text + `bible_books` apparatus (author/date/region/culture/genre/summary) + `bible_cross_references` top-votes (CC-BY OpenBible data, migration 033) + user notes (opt-in "offered notes" UX) + whole-Bible related passages; allowlist = union.
- Note context for devotion: 3 most-recently-updated notes → theme query → k=3 passages.
- Chunker: paragraph-grain 100–600 tokens.
- `verse-verify.ts` parses refs → OSIS and verifies against `bible_passages` — **used only by transcription** today.

## Data model highlights
- `lamplight_artifacts` (type enum already allows `weekly_insight`, `reflection_recap`, `tier_celebration`, `yearly_reflection`), provenance columns (`source_note_ids`, `source_verses`, `model_used`, `prompt_version`).
- `lamplight_settings` carries **vestigial `voice_preference` (Lord|Father|Abba|Jesus) and `tradition_hint`** columns — dropped from use by migration 020; no prompt reads them.
- `lamplight_suggestions_log` exists with no producer/consumer. `lamplight_reflection_state` keyed by natural key (survives regeneration).
- Bible data: `bible_passages` (BSB/KJV/WEB, PK (translation,id)), `bible_books`, `bible_cross_references` (votes, crosses_testament), `bible_interlinear` + `bible_strongs` (041), `bible_etymology` + verse insights (048, reviewed-gated), highlights, focus lists, memorize cards.
- TSK: `src/notepad/graph/tsk-data.json` — 4.15 MB, 29,364 keys, 344,799 edges, client-side only; server table is the independent OpenBible copy. Consolidation candidate.

## Entitlements & quota
- Tiers plus|lite|none; promo flag makes everything free. Rolling 24h usage buckets: generation 10/50/200, transcription 5/20/50, study 3/10/30, global 2000 (env-overridable).
- Cost map pinned May 2026 (src/admin/lamplight-cost.ts): luna 20/120¢, terra 200/1200¢, sol 500/3000¢ per 1M tokens.

## Found issues (fuel for the overhaul)
1. **Study chat tier drift** — streaming (default) path runs balanced, not deep (lamplight-study/index.ts:182 vs :234). Chip spawned to fix.
2. **Stale prompt line** — study-chat.ts:14 "there is no structured lexicon yet" while `bible_interlinear`/`bible_strongs`/`bible_etymology` ship.
3. **Three prompts bypass the voice fragment** (verse-insight, register judge, transcription — direct `llm.generate`, no `composeSystem`).
4. **Layer C doctrinal classifier hook declared, never wired** (`validators.ts` `classifier?` — backlog P0-5).
5. **Every retry budget is one attempt**; judge failure consumes the only retry.
6. **Word-count vs char-count mismatch** in daily-devotion prompt prose vs schema.
7. **Signal thinness** — highlights/focus-lists/chat-threads feed only Waymarks candidates; never Today's Lamp or chat. Tags + regex verse refs + cosine are the only cross-note signals.
8. **No live-model eval.**
9. Backlog alignment: P0-2 doctrinal review board (open), P0-5 Layer C, P1-4 cost cap, P2-2 transparency panel, P2-8 inline ref validation, P2-12 weekly insight, P3-8 premium translations read-time-only.
