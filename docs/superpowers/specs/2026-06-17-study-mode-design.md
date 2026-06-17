# Study Mode — Design Spec (Phase 1)

- **Date:** 2026-06-17
- **Status:** Approved design, pending implementation plan
- **Author:** Brainstormed with Claude (superpowers:brainstorming)
- **Scope:** Phase 1 only. Phase 2 (deep lexical word study) is a documented follow-on with its own future spec.

## Summary

The notepad gains two distinct feature suites: **Journaling** (everything that exists today — notes ⇄ scripture connection, Connection Cards, daily-devotion Lamplight) and **Studying** (new). Study is a separate, reading-first destination for users who want to go deeper into Scripture itself, rather than the connection between their own notes and Scripture.

In Study, **Lamplight becomes "Lamplight Study"** — a deeper, scholarly, theological companion running on **Claude Opus**, grounded in real reference data, that connects dots across Scripture the way a seasoned student of the Bible does: authorship and dating, regions and cultures, cross-references and OT↔NT typology, conversational Hebrew/Greek meaning, and modern-day application. It stays bound by the existing **Lamplight voice principle** (never prophetic; interpretation offered as possibility, facts cited).

The user's notes are *de-emphasized* in Study but never out of reach: when a passage or the conversation is semantically relevant to notes the user has written, Lamplight Study **offers** them ("you have N notes touching this — bring them in?") rather than silently injecting them.

## Goals (Phase 1)

- A distinct Study **space** with its own route, reachable via a `Journaling | Study` toggle.
- A **Study Desk** three-pane layout: apparatus rail · Scripture reader · Lamplight Study chat.
- A distinct visual identity — **Twilight Indigo (#43508C)** accent on the existing cream reading base.
- **Lamplight Study** chat on **Claude Opus** with a scholarly persona, grounded in verse text + apparatus data.
- An **apparatus rail** auto-loading book context (author / date / region / culture) and cross-references (incl. OT↔NT links) for the open passage.
- **Notes-on-offer**: detect relevance, offer, user includes — reusing existing note embeddings.
- A separate, tighter **Study quota** cap (Opus is pricier), reusing existing quota/entitlement/opt-in gates.

## Non-Goals (Phase 1 — deferred to Phase 2)

- Strong's (or equivalent) lexicon table.
- Per-word **interlinear tagging** (mapping every verse word to a lexicon entry).
- Clickable Hebrew/Greek words in the reader and structured, dataset-backed **word-study cards**.

> Phase 1's Lamplight Study can still *discuss* Hebrew/Greek meanings conversationally (Opus knows them, hedged appropriately); it just won't have the structured, clickable, dataset-backed word-study UI until Phase 2.

## Key Decisions (with rationale)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Study is a **distinct space** (own route), not a global recolor of the journaling workspace | User chose Option B: a reading-first room with its own layout; journaling stays untouched. |
| 2 | AI provider stays **Claude (Opus tier)**, not OpenAI | The entire backend is Claude-shaped (adapter, tool-use, quota, retry, prompts); Opus is excellent at deep theology and naturally holds the non-overclaiming voice. "Feel distinct" is achieved via persona + layout + accent, not a second provider. |
| 3 | Layout is the **Study Desk** (three panes) | User chose Option B; the apparatus rail is where the requested depth (authors, regions, cultures, cross-refs) lives on-screen. |
| 4 | Apparatus content is **hybrid**: facts from datasets, interpretation from Opus grounded in those facts | Matches how Lamplight already grounds in real Scripture; honors the voice principle — facts cited, interpretation humble. Avoids hallucinated dates/etymologies. |
| 5 | Notes are **offered, not auto-injected** (Option C) | User wants Study scripture-first but "implied" note pulling to work. Detect → offer → user includes keeps the reader in control. Reuses existing embeddings. |
| 6 | **Approach 1** integration: own route sharing `NotepadProvider` via a nested layout route | True "distinct destination," deep-linkable, and reuses the notes data brain so the notes feature is nearly free. |
| 7 | Accent = **Twilight Indigo #43508C**, cream base retained | Maximum contrast with journaling gold; cream stays for long-reading comfort. |

## Architecture

### Routing & shell

Use a **nested layout route** so Journaling and Study share one `NotepadProvider` instance (the notes "brain" stays warm; toggling does not remount it):

```
/notepad/u/:username            → NotepadProviderLayout (mounts NotepadProvider + shared chrome)
   ├── index   (journaling)     → existing JournalWorkspace
   └── study                    → new StudyWorkspace   ← /notepad/u/:username/study
```

The signed-out local route (`/notepad/notes`) gets the same parent layout with a `study` child.

- **Entry/exit:** a segmented `Journaling | Study` toggle in the notepad header that navigates between the two child routes. The URL is the single source of truth for which mode is active (no extra session state).
- **Gating:** the reader + apparatus are public Scripture data and render for anyone (signed-in or local). **Lamplight Study chat reuses the existing entitlement + opt-in gates** — a signed-out / unentitled user can read and browse cross-references; the AI conversation prompts sign-in/entitlement exactly as today's chat does.
- **Isolation:** all Study-specific code lives under `src/notepad/study/`. Nothing bleeds into journaling code.

### Theming (with a small, justified refactor)

- Today the gold accent is hardcoded inline (`#C49A78`, `#b8843a`) in a few spots (e.g. `src/components/sections/Notepad.tsx`, `StudyWindow.tsx`).
- Introduce a CSS custom property `--lamplight-accent` (default gold) and point those spots at it.
- The `StudyWorkspace` root carries `data-mode="study"`, which overrides `--lamplight-accent` (and a small set of companion variables, exact list confirmed at implementation) to **Twilight Indigo #43508C**.
- Result: the whole space recolors from one scope, no indigo literals sprinkled around. Refactor is limited to the accent values already being touched.

### The Study Desk (three panes)

- **Left — Apparatus rail** (collapsible): auto-loads for the open passage — book context card (author / date / region / culture / genre / summary) + cross-references (top-N by relevance, OT↔NT links surfaced specially) + "written around the same time" + "same author."
- **Center — Reader:** reuses the existing `BibleReader` (book/chapter nav, BSB text, highlights) in the indigo skin.
- **Right — Lamplight Study:** the Opus conversation panel with the notes-on-offer affordance.

## Data layer (apparatus)

All apparatus tables key off the same identifiers as `bible_passages` (`book` text name + `chapter` + `verse`). Public-read RLS so the frontend queries them directly via the anon client — **the rail needs no edge function.**

### Table A — `bible_books` (book-level context, ~66 curated rows)

Columns: `book` (PK, matches `bible_passages.book`), `canonical_order`, `testament` ('OT'|'NT'), `full_name`, `author`, `author_note` (e.g. "traditionally attributed to Moses; authorship debated"), `date_label` ("~57 AD"), `date_start_year` / `date_end_year` (int, for same-era queries), `region`, `provenance_note`, `cultural_context` (short paragraph), `genre`, `summary`, `source`, `source_url`.

- **Hand-authored and reviewable** (only 66 rows) — no LLM-invented facts. Authorship uncertainty is a first-class column so the rail can show it honestly.
- Powers: book context card, "written around the same time" (overlapping year ranges), "same author" (group by `author`).

### Table B — `bible_cross_references`

Source: **OpenBible.info cross-references (CC BY, TSK-derived)**, ~340k links with relevance votes.

Columns: `id`, `from_book` / `from_chapter` / `from_verse`, `to_book` / `to_chapter` / `to_verse_start` / `to_verse_end`, `votes` (weight), `crosses_testament` (derived bool). Index on the `from_*` triple; order by `votes desc` for top-N.

- `crosses_testament` lets the rail surface OT↔NT connections specially (the user's "Old to New and vice versa").
- Each target reference is resolved to its text via `bible_passages` when rendered.

### Ingestion, licensing, migrations

- `032_bible_books.sql` — table + RLS (public read) + the 66-row seed (small enough to live in the migration).
- `033_bible_cross_references.sql` — table + RLS + indexes; data loaded by a one-time **idempotent ingest script** (mirrors the existing BSB ingest pattern noted in `009_bible_passages.sql`).
- **Alignment step:** OpenBible uses OSIS-style book abbreviations; the ingest script normalizes them to the `bible_passages.book` naming. Exact book-name format to be verified at implementation time so the join is exact.
- **Licensing:** OpenBible cross-refs are CC BY (attribution carried in `source` / an About note). Book metadata is authored in-house or drawn from public-domain references. Provenance shown in the rail reinforces the non-overclaiming voice.

## Lamplight Study backend

A new edge function **`lamplight-study`**, a sibling to `lamplight-chat`, reusing all of `_shared/*` (`entitlement`, `quota`, `usage`, `voyage`, `retrieval`, `anthropic`, `auth-identity`, `generation-lifecycle`, `cors`, `classify-error`). It differs in four deliberate ways:

1. **Model = Opus.** Add `opus` to `MODEL_IDS` in `_shared/anthropic.ts`. *Exact published Opus API model id confirmed against the Claude API reference at implementation time — not guessed.*
2. **Scholarly persona prompts** — `lamplight-study/prompts/study-chat.ts` + `study-insight.ts`. Deep-theologian voice (word meaning, historical-cultural context, OT↔NT typology, modern application) **bound by the non-prophetic voice principle**: facts cited, interpretation offered as possibility. The "feel distinct" lives here.
3. **Grounding** — prompt context = verse text **plus apparatus data** (`bible_books` row + `bible_cross_references`), so Opus reasons over sourced facts.
4. **Notes-on-offer** — the function always computes semantically relevant notes (reusing `searchUserNotesByQuery` / Voyage embeddings) but **only injects note text into the Opus prompt when the client passes `note_ids` / an `include_notes` flag**. Every response returns an `offered_notes` array (relevant notes *not* included) so the UI can show the offer. Default keeps Study scripture-first.

- **Quota:** Opus gets its **own tighter daily cap** (new env knob), recorded via existing `checkQuota` / `recordLamplightUsage` with a `study` scope; same opt-in + entitlement gates as today's chat.
- **Threads:** reuse `lamplight_chat_threads` with a `surface` marker (migration `034`) so Study conversations don't intermix with journaling Bible-chat history.
- **Client:** `src/notepad/study/study-chat-client.ts` mirroring `lamplight-chat-client.ts` (`sendStudyMessage`, `requestStudyInsight`), returning `{ ok, threadId, reply, citations, offeredNotes }`.
- **Deploy:** manual — `supabase functions deploy lamplight-study --use-api` (edge functions are not in CI).

### Notes-on-offer behavior (detail)

1. On passage open / each chat turn, the function embeds the passage (or conversation topic) and matches user notes via the existing Voyage retrieval path.
2. Notes above the relevance threshold that were **not** injected are returned as `offered_notes` (id + title + short snippet).
3. The UI shows a quiet affordance: *"You have N notes touching this — bring them in?"* One tap adds their ids to the next request's `note_ids`.
4. Explicit asks ("what have I written about this?") also set the include path.
5. If the relevance probe fails, the offer simply doesn't appear — the conversation is never blocked on it.

## Error handling

- Chat reuses `classify-error.ts` (user-fixable vs transient). UI maps reasons: *not opted in* → enable prompt; *no entitlement* → upgrade; *quota exceeded* → "you've reached today's Study limit"; *transient* → retry. Anthropic/Voyage adapters already retry 429/5xx with backoff.
- **Apparatus rail degrades quietly:** missing book metadata or no cross-refs → hide that section, never error. Failed Supabase read → small "couldn't load study context, retry"; reader + chat keep working.
- **Notes-on-offer never blocks:** a failed relevance probe just hides the offer.

## Testing strategy

Match the existing vitest-beside-source convention.

- **Unit:** grounding-context assembly; notes-on-offer selection (relevant-but-not-included); `crosses_testament` derivation; same-era / same-author query builders; theme-override resolution.
- **Edge function:** `lamplight-study` handler tests mirroring `lamplight-chat` — opt-in / entitlement / quota gates, `include_notes` vs `offered_notes` behavior, Opus selection — with mocked fetch.
- **Ingest:** OSIS→book-name normalization + idempotency.
- **Frontend:** nested-route renders; toggle navigates **without** remounting `NotepadProvider`; rail with/without data; notes-offer interaction; `data-mode="study"` applies indigo.
- **Baselines:** verify **zero new** lint/tsc/test failures against the known pre-existing red baseline (not a green repo). Typecheck with `tsc -b`, not bare `--noEmit`.

## Module / file map

**Frontend — `src/notepad/study/`:**
- `StudyWorkspace.tsx` (three-pane shell, `data-mode="study"`)
- `panes/ApparatusRail.tsx`
- `panes/StudyReader.tsx` (wraps existing `BibleReader`)
- `panes/LamplightStudyPanel.tsx`
- `study-chat-client.ts`
- `useApparatus.ts` (fetch `bible_books` + `bible_cross_references` for open passage)
- `useStudyChatThread.ts` (mirrors `useChatThread`)
- `useNotesOnOffer.ts`
- study theme tokens (under `[data-mode="study"]`)

**Routing:**
- `NotepadProviderLayout` hoisting `NotepadProvider` above journaling + study child routes (`App.tsx` route changes)
- header `Journaling | Study` toggle

**Shared / refactor:**
- `_shared/anthropic.ts`: add `opus` to `MODEL_IDS`
- refactor hardcoded gold accents → `--lamplight-accent` (`Notepad.tsx`, `StudyWindow.tsx`)

**Backend — `supabase/functions/lamplight-study/`:**
- `index.ts`, `prompts/study-chat.ts`, `prompts/study-insight.ts`, study pipeline (reuse `runBibleChatPipeline` if parameterizable, else a study variant)

**Migrations / data:**
- `032_bible_books.sql` (+66-row seed)
- `033_bible_cross_references.sql`
- `034_lamplight_chat_threads_surface.sql`
- cross-reference ingest script (OSIS→book normalization, idempotent)

**Env:**
- new Study quota knob(s); reuse existing `ANTHROPIC_API_KEY` / `VOYAGE_AI_KEY`.

## To confirm at implementation time

These are intentionally deferred specifics, not open design questions:

1. Exact published **Opus API model id** (via the Claude API reference).
2. Exact **`bible_passages.book` naming format** for the OSIS→book normalization in the cross-ref ingest.
3. Exact **Study quota cap** values (env knob defaults).
4. Exact set of **companion accent variables** overridden under `[data-mode="study"]`.
5. Whether the study chat pipeline reuses `runBibleChatPipeline` directly or needs a study-specific variant (depends on how parameterized the existing pipeline is).

## Phase 2 (follow-on, separate spec)

Deep lexical word study: a lexicon table (e.g. Strong's), per-word interlinear tagging, clickable Hebrew/Greek words in the reader, and structured dataset-backed word-study cards in the apparatus rail.
