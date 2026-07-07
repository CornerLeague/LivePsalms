# Reflection Timeline — "Waymarks" — Design Spec

**Date:** 2026-07-06 · **Status:** Design complete, ready for implementation planning · **Feature:** Lamplight Reflection Timeline (product name **Waymarks**)
**Source of truth for intent + voice:** `/Users/newmac/Downloads/reflection-timeline-spec.md` (§5 voice rules are the product)
**Repo:** `/Users/newmac/Downloads/Psalms_app` · **Provenance:** compiled from a `superpowers:brainstorming` chain (19 locked decisions, 9 approved section designs) grounded against live migrations (008, 011, 019, 024/025, 027, 042; latest migration 044 → next 045).

> **This spec is design, not a plan.** It records *what* to build and *why*, at implementation-ready fidelity. The step-by-step build order is produced next by `superpowers:writing-plans`. **No implementation follows from this document directly.**

---

## 0. Summary

Live Psalms already captures the daily writing. **Waymarks** does the thing people rarely do on their own — it goes back. On a monthly cadence, **Lamplight reads the notes from the month just lived and composes a reflection that arrives like a letter**: a title for the month, the key moments marked along a timeline, each moment carrying its date and, where it fits, the scripture that was already speaking to it.

The metaphor is the oldest form of the practice: memorial stones (Joshua 4; Ebenezer, 1 Samuel 7:12). Each month becomes **one stone** on a vertical path ("**The Path**"). Twelve stones gather into a **cairn** for the year. Moments between stones are **markers**. Every stone has equal dignity regardless of how much was written — **never a scorecard**.

**Tone is the product.** The §5 voice rules travel *verbatim* into both the generation prompt (§2, §6) and the UI copy (§13). A feature that reopens a user's hard season, or counts their sparse months, is one they close.

**MVP scope:** monthly generation + first-open backfill + The Path + the letter view + hide/annotate + Plus entitlement with a graceful locked preview. **Yearly cairn** is fully designed here and ships as a **fast-follow** (§15).

---

## 1. Product decisions (the locked ledger)

All 19 decisions below are **locked** (brainstorming design-approval gate passed). They are grouped for reading; the numbers are the canonical decision IDs referenced throughout. **Do not re-litigate.** If implementation surfaces a *genuinely new* fork, it is numbered from **20** and raised with the user — not decided silently.

### Placement & navigation
1. **Own destination.** A dedicated route `/notebook/reflections` ("The Path"). The Lamplight panel card and the arrival badge **deep-link into it**; Waymarks is not a Lamplight sub-tab.
6. **Visual direction: "The Path."** A vertical walk back through time — stones along one path, moment markers between stones, each year's twelve stones gathering into a cairn. **Every stone equal dignity regardless of writing volume — no sizes, no counts, never a scorecard.**
7. **Path ordering: present at the head.** The sealed newest letter sits at the top; scrolling *descends into the past*; each year's cairn is a **year-gate divider** between Dec and Jan (e.g. a cairn labeled "2025 — The Year of the Narrow Door" sits between Jan 2026 and Dec 2025).

### Scope & cadence
2. **Monthly + backfill now; yearly designed-now/ship-fast-follow.** Monthly reflections plus a first-open backfill of past months (cap ~12). The yearly "cairn" is designed in full here but shipped as a fast-follow (§15).
11. **Yearly cairn artifact identity.** New `type` value `'yearly_reflection'`, `period_key = '2026'`. Type is a plain CHECK constraint (one-line migration). Monthly stays `'reflection_recap'` + `'2026-06'`. **Never parse the key-string shape to tell a stone from a cairn** — always branch on `type`.

### Arrival & ceremony
3. **Arrival is delivered, not hunted.** Sealed letter appears at The Path's head + a quiet badge on the Lamplight/dock entry + a small invitation card in the Lamplight panel. **Opening is always the user's deliberate act.** Never a full-screen ambush (this matters most for hard months). **Email is not wired** in the app (`lamplight_settings.weekly_email` flag exists, no transport) — arrival is **in-app for MVP**.
9. **Opening ceremony: a room of its own.** Tapping the seal (always the user's act) breaks the seal and opens the letter on **its own route** `/notebook/reflections/:periodKey`; the badge and panel card deep-link straight into the opened letter; "‹ The Path" returns. `prefers-reduced-motion` → gentle crossfade, seal still reads broken. Once opened, the letter **sets** as the month's stone: title revealed at The Path head, seal retired.
12. **Backfill arrival state: one seal, history set.** The most recent complete month arrives **sealed** at The Path head; older backfilled months are set **directly as titled, readable stones** (no seal). The seal is reserved for letters that arrive in their own time.

### Naming & vocabulary
10. **Name: Waymarks** (Jeremiah 31:21). Held-constant vocabulary: **unit = stone**, **year = cairn**, **moments = markers**. Route stays `/notebook/reflections`.
8. **Letter interior: letter first, then the moments.** The prose reads whole and uninterrupted; below a hairline, a section "**THE MOMENTS, MARKED**" — a mini-path of markers (each: date + verse + italic phrase) echoing the outer Path; then the dashed "**＋ Add your words**" box and a quiet footer "**Save to notes · Hide this stone**".

### Entitlement & tiers
5. **Plus-only flagship.** `lamplight_entitlements` tier `plus` gates generation. `lite`/`none` see the destination with a graceful **locked preview** (an invitation, never a paywall slam).
17. **Downgrade — the stones stand.** On downgrade below Plus, **generated stones remain fully readable** (annotate / hide / save-to-notes still work); new months simply don't generate; a quiet locked note at The Path head carries a gentle *"your path resumes the moment you return."* Win-back comes from §2 backfill re-running **instantly** on return (artifact-table-as-checklist), not from hostage-taking.

### User agency
4. **Hide (reversible) + annotate; never edit Lamplight's words.** A stone can be **hidden** (reversible, not destructive) and **annotated** (the user's words shown as *theirs*, alongside Lamplight's). The user never edits Lamplight's text.
14. **Scripture matching: month's-own-trail precedence.** When register fits, a verse the user actually touched that month (flagged / highlighted / studied / focus-listed) outranks a fresh semantic match — "it had been waiting there" is literal. **≤1 verse per marker, abstention allowed**; every chosen verse comes from the validated candidate list.
15. **Validation: deterministic validators + register judge.** Deterministic validators run first; a small register judge then grades against the §5 rubric; its reasons feed a **single** retry; the retry maps onto the controller's existing `refining` phase.
16. **Hide/annotate storage: satellite table by natural key.** `lamplight_reflection_state` keyed `(user_id, artifact_type, period_key)` — **not** `artifact_id` — so state survives any regeneration structurally.
18. **Zero-notes closed month: quiet-skip.** `no_notes` is terminal (we only ever attempt *closed* months, so a month can't gain notes later); no artifact row; the month is simply **absent** from The Path, exactly like a gap (decision 12). On-demand shows a soft *"Nothing was written here"* — never an error. Distinct from the sparse floor (≥1 note still yields a whole stone). **Also ratified:** retry-cap of **3 attempts → `deferred`** (§9) and an on-demand controller **`unavailable`** state with a gentle *"Try again."*
19. **Testing eval: offline / non-gating.** CI gates deterministic Tier 1–2 + a thin Tier 4 UI smoke using a **stubbed model client**; the real-model voice eval (Tier 3) runs **offline** (nightly / on-demand) as a human-reviewed regression signal.

---

## 2. Voice & tone — the product

The §5 rules below are reproduced **verbatim** from the feature spec. They are the single most load-bearing content in this document. They travel **verbatim** into (a) the generation prompt as constraints (§6 Layer 1) and (b) the UI copy register (§13). Nothing in generation or copy may soften or contradict them.

### 2.1 §5 voice rules (verbatim)

> **Titles: underline-worthy, not devotional headers.** Aim for something a person would want to keep. A month might come back as "The Month You Stopped Waiting" or "Small Faithfulness." A year might read "The Year of the Narrow Door." Never generic, never a sermon title.
>
> **Battles: witnessed, not reopened.** When Lamplight surfaces a hard season, it names that the season happened and that the user wrote their way through it. It does not recount the painful detail, quote the darkest lines back, or re-narrate the wound. The register is a hand on the shoulder, not a replay. It marks the stone and moves on.
>
> **Sparse periods: a graceful floor.** When someone barely wrote, the reflection shifts from "here is your arc" to "here is what you kept coming back to say." It honors the little that was written and never counts the gaps. It is never a scorecard of how often they showed up. A single honest entry can be the whole stone.

### 2.2 The register exemplar (verbatim — the one-shot the prompt carries)

This is the approved gold-standard letter. It is embedded **verbatim** in the generation prompt as the one-shot register exemplar, and it is the required first fixture in the offline voice eval (§14, Tier 3). The companion mockup directory is gitignored and may be cleaned — this spec is its durable home.

**May 2026 · "The Month You Stopped Waiting"**

Letter prose (3 paragraphs):

> You began May circling a decision you had been holding since March. On the twelfth the circling stopped — that entry doesn't argue with itself; it simply asks to be led, and then goes quiet.
>
> The middle of the month held a hard week. You know which one. You wrote through it rather than around it, and the writing held you. The stone stands; the details can rest.
>
> And a small thing you almost didn't record: the early walks, Psalm 27 open again and again. You kept returning without calling it returning. That thread is what this month was made of.

Markers:

- `12 May · Ps 27:14 — the day the circling stopped`
- `17–23 May · Ps 34:18 — a hard week, witnessed`
- `27 May · Ps 27:4 — the walk you kept taking`

**Register notes (why this is the exemplar):**
- The battle (the hard week, marked as a 7-day span `17–23 May`) is **pointed at, never replayed** — "You know which one… the details can rest."
- Marker phrases ("the day the circling stopped") are **Lamplight's namings, not quotes** from the user's notes.
- The prose names a scripture *thread* ("Psalm 27 open again and again") narratively; the **verse-level** references (Ps 27:14, Ps 34:18, Ps 27:4) live **only in the markers**. This distinction is enforced by validators — see §6.2 and the reconciliation note in §6.4.

### 2.3 Three-layer enforcement (overview; detail in §6)

Tone is enforced structurally, not hoped for:
1. **Prompt** (Layer 1) — §5 verbatim + the exemplar, versioned `prompt_version = monthly-reflection-v1`.
2. **Deterministic validators** (Layer 2) — machine-checkable invariants before any artifact row is written.
3. **Register judge** (Layer 3) — a small model call grading against the §5 rubric, feeding one repair.

---

## 3. Data model

All Waymarks tables are user-scoped and reference **`public.profiles(id)`** with RLS `auth.uid() = user_id`, mirroring every other `lamplight_*` table (confirmed in `008_lamplight_schema.sql`). **This corrects the earlier design draft that referenced `auth.users` — the live schema references `profiles`.**

> **All new schema below composes a single migration file `045`.** The `lamplight_reflection_state` table (§3.2), the `lamplight_settings.timezone` column (§3.3), and the `lamplight_artifacts` type-CHECK alter (§3.4) are statements *within that one file* — the repeated `-- migration 045` markers denote the same file, not three separate migrations.

### 3.1 Reuse: `lamplight_artifacts` (008, unchanged shape)

The schema anticipated this feature. Confirmed columns (008):

```
id uuid pk · user_id uuid → profiles · type text CHECK · period_key text
title text default '' · body jsonb default '{}' · source_note_ids uuid[] · source_verses text[]
model_used text · prompt_version text · saved_to_notes boolean · created_at timestamptz
unique (user_id, type, period_key)
```

Waymarks usage:
- **Monthly:** `type = 'reflection_recap'`, `period_key = 'YYYY-MM'` (e.g. `'2026-06'`).
- **Yearly (fast-follow):** `type = 'yearly_reflection'`, `period_key = 'YYYY'` (e.g. `'2026'`).
- **`title` column** = the reflection's title (e.g. "The Month You Stopped Waiting") — a denormalized copy of `body.title`, written atomically from the same generation output, so The Path list query can read titles **without loading `body`**.
- **`body` jsonb** = the model's full strict-JSON output: `{ title, letter, markers: [{ date, date_end?, verse, phrase }] }` (see §4.3).
- **Provenance:** `source_note_ids uuid[]` (the month's notes that fed the letter), `source_verses text[]` (chosen marker verses), `model_used`, `prompt_version`.
- `unique (user_id, type, period_key)` makes regeneration **idempotent** (`on conflict` upsert).

> **⚠️ `lamplight_artifacts` has NO `updated_at`** (only `created_at`). The regeneration upsert must therefore **explicitly preserve `saved_to_notes`** in its column list and must not reference a non-existent `updated_at` (§4.4).

### 3.2 New: `lamplight_reflection_state` (migration 045) — hide/annotate satellite

Keyed by the **natural key** `(user_id, artifact_type, period_key)`, never by `artifact_id`, so it **survives any regeneration** structurally (decision 16). **Generation NEVER writes this table** — a structural guarantee, not a convention.

```sql
-- migration 045
create table public.lamplight_reflection_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  artifact_type text not null
    check (artifact_type in ('reflection_recap','yearly_reflection')),
  period_key text not null,
  hidden_at timestamptz,               -- null = visible
  annotation text,                     -- null = none; ALWAYS rendered as the USER'S words
  annotation_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, artifact_type, period_key)
);

alter table public.lamplight_reflection_state enable row level security;

create policy "Users can view own lamplight_reflection_state"
  on public.lamplight_reflection_state for select using (auth.uid() = user_id);
create policy "Users can insert own lamplight_reflection_state"
  on public.lamplight_reflection_state for insert with check (auth.uid() = user_id);
create policy "Users can update own lamplight_reflection_state"
  on public.lamplight_reflection_state for update using (auth.uid() = user_id);
create policy "Users can delete own lamplight_reflection_state"
  on public.lamplight_reflection_state for delete using (auth.uid() = user_id);

-- reuse existing update_updated_at() (defined in 003_triggers.sql)
create trigger set_lamplight_reflection_state_updated_at
  before update on public.lamplight_reflection_state
  for each row execute function public.update_updated_at();
```

Semantics: `hidden_at IS NOT NULL` ⇒ the stone is **absent** from The Path (no placeholder, matching the gapped-months rule of decision 12); `annotation` is one plain-text note per stone, always rendered as the user's own words. `artifact_type` distinguishes stones from cairns uniformly.

### 3.3 New: `lamplight_settings.timezone` (migration 045)

```sql
-- migration 045
alter table public.lamplight_settings add column if not exists timezone text;  -- IANA; null ⇒ UTC fallback
```

Captured silently client-side each visit via `Intl.DateTimeFormat().resolvedOptions().timeZone`; UTC fallback when null (decision 13). Drives the scheduled cohort query and the client arrival rule (§7).

### 3.4 Alter: add `'yearly_reflection'` to the type CHECK (migration 045)

Fixes the cairn identity now (decision 11) so the data model is complete even though yearly generation ships fast-follow:

```sql
-- migration 045  (constraint name auto-generated in 008; VERIFY the exact name — §16)
alter table public.lamplight_artifacts
  drop constraint if exists lamplight_artifacts_type_check,
  add constraint lamplight_artifacts_type_check
    check (type in ('daily_devotion','weekly_insight','reflection_recap','tier_celebration','yearly_reflection'));
```

### 3.5 Reuse: `lamplight_jobs` (008) — the retry/attempt ledger

`lamplight_jobs` already exists (008): `id, user_id→profiles, kind text, status CHECK(queued|running|done|failed), payload jsonb, attempts int, scheduled_at, started_at, finished_at, error`, with `create index … (status, scheduled_at)`. It is the **natural home** for the §9 retry-cap / `deferred` tracking, rather than a new run-log table (schema correction). See §7 and §9 for how it composes with the artifact-table-as-checklist. (Whether reusing `jobs` reads cleaner than a purpose-built column is flagged in §16 — the scheduled run uses the service role and bypasses RLS.)

### 3.6 Read-only inputs (no schema change)

- **Notes:** `notes(content TipTap HTML, created_at, …)` (002). The month's notes are bucketed by **`created_at`** — edits never rebucket, because a stone marks *when you wrote*. MVP reads note **text** only.
- **Candidate-pool sources** for scripture matching (§5): `note_transcriptions.verse_flags` jsonb (019); `bible_highlights(user_id, verse_id)` (027); `lamplight_chat_threads.passage_ref` `"{book}.{chapter}"` (024/025); **`scripture_focus_lists` + `scripture_focus_list_items(book, chapter, verse_start, verse_end, label)`** (042) — the 4th lived-provenance source, month-scoped by `created_at`.
- **Semantic neighbors:** existing bible-passage embeddings + match RPCs (012/016; global passage embeddings have `user_id NULL` per 011).
- **Entitlement:** `lamplight_entitlements(user_id pk → profiles, tier CHECK(plus|lite|none), source, granted_at, expires_at)` — users have **SELECT-only** RLS; the server is authoritative (§10).

---

## 4. Generation architecture

### 4.1 One edge function, new kinds, two callers, one code path

Add two kinds to the existing `lamplight-generate` dispatch (`supabase/functions/lamplight-generate/index.ts`, which today handles `smoke_test`, `daily_devotion`, `connection_card_why`):
- **`monthly_reflection`** (MVP)
- **`yearly_reflection`** (fast-follow)

snake_case matches the existing kinds. Two callers share the identical generation code path:
- **Scheduled headless run** (pg_cron → drain, §7): writes the artifact row directly (service role).
- **On-demand client run** (backfill / retry, §8): streams via the existing SSE path with buffered fallback, driven by the reflections controller (§12).

Shared types live in `supabase/functions/_shared/artifacts.ts`.

### 4.2 Inputs

- **Monthly:** the month's notes, bucketed by `created_at` into `[month_start, month_end]` (local, per the user's timezone). Text only. Plus the per-marker candidate pool (§5).
- **Yearly (fast-follow):** both layers per feature spec §3 — the raw notes across all twelve months **and** the twelve monthly reflections already generated (the raw read catches what a month missed; the monthly reflections carry what was already named significant). December's monthly stone generates **before** the cairn.

### 4.3 Output shape (model → strict JSON)

The model returns **strict JSON**:

```json
{
  "title": "The Month You Stopped Waiting",
  "letter": "…prose, second person, reads whole…",
  "markers": [
    { "date": "2026-05-12", "verse": "Ps 27:14", "phrase": "the day the circling stopped" },
    { "date": "2026-05-17", "date_end": "2026-05-23", "verse": "Ps 34:18", "phrase": "a hard week, witnessed" },
    { "date": "2026-05-27", "verse": "Ps 27:4", "phrase": "the walk you kept taking" }
  ]
}
```

- **`markers`**: 1–6 (`MARKER_MIN`/`MARKER_MAX`, §17). Each: `date` (ISO, within the month), optional `date_end` (ISO, for spans like "17–23 May"), `verse` (a candidate-list reference string **or `null`** for abstention), `phrase` (short, Lamplight's own naming — never a quote). Marker categories come from feature spec §4: turning points, wins, battles, threads, pivots.
- **`letter`**: second person; reads whole; **no numerals that tally activity** and **no verse-level citations** in the prose (scripture precision lives only in markers — see §6). Dates are not spelled into prose as counts; precise dates live in markers.
- **`title`**: underline-worthy (§2.1).

### 4.4 Persistence (idempotent upsert)

On a validated pass, upsert one `lamplight_artifacts` row:
- `type` / `period_key` per decision 11; `title` = `output.title`; `body` = the full `output` object; `source_note_ids` = the contributing notes ⊆ month's notes; `source_verses` = chosen (non-null) marker verses; `model_used`; `prompt_version = 'monthly-reflection-v1'`.
- `on conflict (user_id, type, period_key) do update` with an **explicit column list that preserves `saved_to_notes`** and touches no `updated_at` (there is none — §3.1).
- The satellite `lamplight_reflection_state` is **never** touched here.

---

## 5. Scripture matching (decision 14)

Per marker, build a **candidate pool** of ~8–12 provenance-tagged verse references (`CANDIDATE_POOL_TARGET`, §17):

**(a) The month's own trail** — verses the user actually touched that month, provenance-tagged:
- flagged in that month's notes (`note_transcriptions.verse_flags`),
- highlighted (`bible_highlights.verse_id`, e.g. `'jhn.1.1'`),
- studied (`lamplight_chat_threads.passage_ref`, e.g. `'jhn.10'`),
- focus-listed (`scripture_focus_list_items`, month-scoped by the list's `created_at`).

**(b) Semantic neighbors** of the marker's notes via the existing bible-passage embeddings / match RPCs (012/016).

**Selection:** the model composes the letter and picks **at most one verse per marker, abstention allowed** ("where it fits", feature spec §4) — the register judgment is the model's, made from the tagged shortlist.

**Precedence (decision 14 = A):** when register fits, a verse from the **month's own trail** outranks a fresh semantic match — "it had been waiting there" is literal.

**Allowlist validator (bridges into §6):** any chosen marker verse **must be one of the offered candidates, or `null`**. This structurally kills hallucinated or misquoted references. Chosen verses land in `source_verses[]`.

> The exact canonical-vs-display representation of a verse (OSIS id vs "Ps 27:14") and the precise match-RPC signatures are **verify-at-implementation** (§16). The candidate list is the contract; its internal id format is an implementation detail.

---

## 6. Validation pipeline (decision 15; §5 → machine-enforced)

Three layers, then a bounded failure loop. All of Layer 2 runs in the edge function **before any artifact row is written**.

### 6.1 Layer 1 — Prompt (`prompt_version = monthly-reflection-v1`)

- §5 voice rules travel **verbatim** as constraints (§2.1); the **May 2026 exemplar** (§2.2) is the one-shot register exemplar.
- **Titles:** underline-worthy; the spec's example titles as positives; generic devotional/sermon headers as **anti-examples**.
- **Battles:** name the season and that the user wrote through it; **never** recount, quote, or re-narrate the wound.
- **Sparse:** shift from "here is your arc" to "what you kept coming back to say"; never mention gaps or counts; one entry can be the whole stone.
- **Markers:** 1–6 from the §4 categories; each = date (+ optional span) + ≤1 verse from the candidate pool (abstention allowed; decision-14 precedence) + a short italic phrase in Lamplight's own words (namings, never quotes).
- **Letter prose:** second person; reads whole; no tally numerals; no verse-level citations (scripture only in markers).
- **Output:** strict JSON `{ title, letter, markers }`.

### 6.2 Layer 2 — Deterministic validators (edge function, pre-write)

1. **Shape + bounds** — parses; typed; `MARKER_MIN`–`MARKER_MAX` markers; letter length within `LETTER_WORD_MIN`–`LETTER_WORD_MAX` (§17).
2. **Scripture allowlist** — every marker `verse` ∈ its candidate pool or `null`; **the prose is scanned for verse-level *citation* patterns and any hit fails** (see the reconciliation in §6.4 — this targets `Book Chapter:Verse` citations, not narrative mentions of a book/chapter).
3. **Anchoring** — each marker's `date`/span lies **inside the month** AND touches **≥1 source note's `created_at` day**.
4. **No-scorecard lint** — the prose contains **no tally of the user's activity**: a tally-phrase blocklist ("N times", "N days", "N entries", "N out of", streak language) plus a numeric-count heuristic flagging digit-sequences adjacent to activity nouns. **Scripture chapter/verse numbers and spelled-out dates are exempt** (§6.4).
5. **Witnessed-not-reopened lint** — no verbatim run of `VERBATIM_RUN_MAX_WORDS`+ words (§17, default 8) copied from any source note into the letter or any phrase.
6. **Provenance** — `source_note_ids[]` non-empty and ⊆ the month's notes; chosen verses → `source_verses[]`.

### 6.3 Layer 3 — Register judge (small model call)

After the deterministic pass, one small model call grades against the §5 rubric — **title register; battle handling given the actual notes; scorecard-ness; exemplar fidelity** — returning pass/fail + reasons.

### 6.4 Reconciliation notes (so validators don't reject the gold-standard exemplar)

The approved exemplar (§2.2) must pass every validator. Two rules are therefore **precise, not naive** — the implementation plan must encode the nuance:

- **Validator 2 (no scripture in prose) forbids *verse-level citations* only.** The forbidden pattern is `Book Chapter:Verse` (e.g. "Ps 27:14", "John 3:16"). A **narrative mention of a book/chapter** the user was reading — the exemplar's "Psalm 27 open again and again" — is **permitted**; verse-level precision still lives only in markers. Without this distinction the validator would reject the exemplar.
- **Validator 4 (no-scorecard numerals) forbids *tallies of the user's activity* only.** A scripture chapter number ("Psalm 27") and a spelled-out date ("on the twelfth") are **not** scorecard numerals and are exempt. The exemplar deliberately spells "the twelfth" and keeps precise dates in markers.

### 6.5 Failure loop (bounded)

- **Off-list verse on an otherwise-valid marker** → repair by **dropping that marker to abstention** (`verse: null`) — a voice-safe, designed state — and continue.
- **Any other failure** (deterministic or judge) → **ONE** regeneration with the judge/validator reasons appended to the prompt (maps to the controller's `refining` phase).
- **Still failing** → **NO artifact row is written**; the run reports `validators_failed`. Because "no artifact row" is how the hourly job and backfill know to re-attempt, the scheduled path additionally tracks attempts and caps them (§9) so an ungeneratable month is not selected forever.

---

## 7. Trigger timing & scheduling (decision 13)

**Generate at local month close; reveal at 7am local on the 1st.**

- **Timezone:** `lamplight_settings.timezone` (IANA, §3.3), captured client-side each visit, UTC fallback.
- **Scheduled generation:** an **hourly** `pg_cron` job (built on the proven `011_lamplight_signal_layer.sql` pattern — `pg_cron` + `pg_net` + `claim_lamplight_jobs()` already drain `lamplight_jobs` every minute) runs a **cohort query**: for each **Plus** user whose **local month just closed**, who has **≥1 note** in that closed month, and for which there is **no artifact row** and **no `deferred` job** for that `period_key` → generate a `monthly_reflection`.
- **Arrival is a pure client rule — no delivery infrastructure:** a letter appears sealed at The Path head (and lights the badge + panel card) when **the artifact exists AND the user's local time is ≥ 7am on the 1st**. `ARRIVAL_HOUR_LOCAL = 7` is a spec-tunable constant (§17).
- **Yearly (fast-follow):** December's monthly stone generates **before** the cairn; both arrive the morning of Jan 1.

The single cohort query is the backbone: it encodes generation-selection + backfill + `tier = plus` + `deferred` exclusion (see §8, §9). Exact cron cadence (hourly vs the existing per-minute drain) is confirmed at implementation (§16).

---

## 8. Backfill (decision 2, 12; first Plus open)

- On a Plus user's **first open** of The Path, query "**the last ~12 months that have notes but no artifact row**" — the **artifact table is the job checklist**; an interrupted backfill resumes for free.
- **Newest first, sequential, cap `BACKFILL_CAP` = 12** (§17). Runs on-demand through the same generation code path (§4), streaming.
- **Empty months are skipped entirely** — no placeholder (The Path shows gaps by design; no-scorecard, decision 12).
- Backfilled stones **set directly as titled, readable stones** (no seal — decision 12; the seal is only for the newest arriving month).
- **Status line:** stones fade in as they set, under **one quiet, non-numeric** status line (copy in §13.6) — never "3 of 12".
- **Upgrade path costs nothing:** the very first Plus open (including immediately after a re-subscribe) runs this backfill, which is the win-back mechanism for decision 17.

---

## 9. Error handling (decision 18; §6 failure loop continued)

- **(a) Zero-notes closed month → quiet-skip.** `no_notes` is terminal (only closed months are attempted). No artifact row, no job churn; the month is **absent** from The Path like any gap. On-demand (a user explicitly opening that period) shows a soft *"Nothing was written here"* — never an error. Distinct from the sparse floor, where ≥1 note still yields a whole stone.
- **(b) `validators_failed` / transient generation failure → bounded silent retry with a cap.** Since "no artifact row" is the re-attempt signal, an ungeneratable month would be re-selected forever. So the **scheduled path tracks attempts in `lamplight_jobs`** (kind `monthly_reflection`/`yearly_reflection`, payload carries `period_key`), and stops at **`RETRY_ATTEMPT_CAP` = 3 → `deferred`** (a terminal `failed` job that the cohort query treats as "do not re-select"). The cohort query excludes any `period_key` that has an artifact row **or** a terminal/`deferred` job. **Backfill and on-demand can clear a `deferred` job** to force a fresh attempt. The user sees nothing — a `deferred` month is simply an absent stone, in register.
- **(c) Transient network/API failure in the scheduled run self-heals** — next hour's cohort query re-selects the still-row-less month (until the cap).
- **(d) On-demand failure (user actively watching)** → the reflections controller enters **`unavailable`** with a gentle *"Try again."* Never expose validator or technical detail.

**Inner loop reminder (from §6.5):** off-list verse → drop to abstention; any other failure → one regeneration with reasons; still failing → no row, `validators_failed`.

> The retry ledger is drawn as `lamplight_jobs` reuse; a purpose-built column/table is the fallback if `jobs` reads awkwardly against the service-role/RLS split (§16).

---

## 10. Entitlement & locked preview (decision 5, 17)

**The route is visible to every tier; below Plus it renders an invitation, never a paywall slam** — a short evocative explanation of Waymarks, a **ghosted, clearly-labeled example path** reusing the fictional mockup months, and one quiet upgrade affordance. No counts, no "your N months are waiting" pressure (copy in §13.6).

**Enforcement in 3 layers** (client checks are UX, not security — the edge function and cohort query are the real gates):
1. **Client** — locked route state; the reflections controller never instantiates below Plus; backfill never initiates; the arrival badge + panel invitation card are Plus-only.
2. **Edge function** — `monthly_reflection` / `yearly_reflection` check entitlement **server-side** (reuse the dispatch's existing gate if present — verify at §16).
3. **Scheduled job** — the cohort query filters `tier = plus` (zero generation compute below Plus).

**Consent gates unchanged:** sign-in → consent → entitlement precede generation; the preview may be seen pre-consent.

**Downgrade (decision 17 = A):** generated stones **stand** — annotate / hide / save-to-notes still work; new months don't generate; a quiet locked note at The Path head. Nothing generated is taken back. Re-subscribing triggers §8 backfill instantly.

---

## 11. Hide / annotate (decision 4, 16)

Backed by `lamplight_reflection_state` (§3.2), keyed by natural key so state survives regeneration.

- **Hide** = set `hidden_at`. A hidden stone is **fully absent** from The Path (no placeholder — matches decision-12 gapped months). Reversible via a quiet "**Hidden stones**" affordance at The Path foot and a "**Restore this stone**" control in the hidden letter's footer (clears `hidden_at`). Hiding is never destructive — the artifact is untouched.
- **Annotate** = one plain-text `annotation` per stone (the "＋ Add your words" box, decision 8). **Always rendered as the user's own words**, alongside — never replacing — Lamplight's text. The user edits/deletes their own annotation freely; **Lamplight's text is untouchable** (decision 4).
- **Cairns** use the same table (`artifact_type = 'yearly_reflection'`).
- **Path join:** The Path route joins `lamplight_reflection_state` onto the artifact list — `hidden` → omit; annotation surfaced on the letter view. Both lamplight adapters (§12) gain state read/write.

---

## 12. Client architecture

- **Reflections controller** on the existing `todays-lamp-controller.ts` state-machine pattern. Phases:
  `retrieving → generating → refining → ready | error | unavailable`
  - **retrieving** — loading artifact(s) + state from the adapter (and the candidate pool for on-demand generation).
  - **generating** — on-demand generation streaming (backfill / retry) via SSE.
  - **refining** — the register-judge / repair pass (decision 15; §6.5).
  - **ready** — artifact loaded/generated; letter displayable.
  - **error** — transient/technical failure during load or generation (retry likely helps immediately).
  - **unavailable** — generation ran but produced nothing voice-safe (`validators_failed`) on-demand; gentle *"Try again"* (decision 18); never technical detail.
- **Adapters:** both `lamplight-adapter.ts` and `supabase-lamplight-adapter.ts` gain reflection read/write **and** `lamplight_reflection_state` read/write.
- **Routes** (React Router v7 SPA):
  - `/notebook/reflections` — **The Path.** Lists visible artifacts (`select id, type, period_key, title, created_at`) left-joined to state (hidden → omit; annotation carried); renders newest-at-head, year-divider cairns, the sealed newest letter, and the "Hidden stones" foot affordance. Below Plus → the locked-preview state (§10).
  - `/notebook/reflections/:periodKey` — **a letter / the opening ceremony.** Loads one artifact + its state; renders letter-first-then-markers (decision 8); runs the opening ceremony (decision 9) with a reduced-motion crossfade.
- **Arrival rule** (client, §7): artifact exists AND local now ≥ 7am on the 1st → newest complete month shows **sealed** at head + badge on Lamplight/dock + invitation card in the Lamplight panel.

---

## 13. UI / visual

### 13.1 The Path (`/notebook/reflections`)
Vertical walk back through time, **present at the head** (decision 7). **Equal-dignity stones** — equal-size ellipses with slight rotation, **never sized or counted by writing volume** (decision 6). Year **cairns** are year-gate dividers between Dec/Jan. Gaps (empty / hidden / deferred months) are simply absent — no placeholders.

### 13.2 The letter (`/notebook/reflections/:periodKey`)
**Letter first, then the moments** (decision 8): the prose reads whole and uninterrupted; below a hairline, "**THE MOMENTS, MARKED**" — a mini-path of markers (date + verse + italic phrase each); then the dashed "**＋ Add your words**" box; then a quiet footer "**Save to notes · Hide this stone**". Annotations render as the user's words.

### 13.3 Opening ceremony (decision 9)
Tap the seal → seal breaks → the letter opens on its own route. Once opened it **sets** as the stone (title at The Path head, seal retired). `prefers-reduced-motion` → gentle crossfade, seal still reads broken.

### 13.4 Locked preview (below Plus)
An **invitation, not a paywall** (§10): evocative Waymarks explanation + a ghosted, clearly-labeled example path (fictional months) + one quiet upgrade affordance. No counts, no pressure.

### 13.5 Palette & type (from the approved mockups — matches `src/index.css`)
plaster `#F0ECE8` · umber `#3A3426` · scripture gold `#C49A78` · silica `#8A8B90` · hairline `#CECCCA` · stones `#DCCFBF` / `#D3C6B4` / `#CBBBA5`, stroke `#A89A87` · letter card `#FAF7F3`. Titles **Cormorant Garamond italic** (Georgia fallback); labels **Inter**; captions **Georgia italic**. Seal motif: gold circle r9 @ .22 opacity + solid r4.5; arrival badge = a small gold dot on the envelope corner. **Dark mode** exists: `#0a0a0a` / `#efedee` / accent `#c4b5a0`. Grain-texture motif throughout.

### 13.6 Copy (all copy must hold the §5 register — witnessing, never a scorecard)
- **Backfill status line (non-numeric):** *"Gathering the months behind you…"* (never "N of 12").
- **Zero-notes on-demand:** *"Nothing was written here."*
- **On-demand `unavailable`:** *"This one isn't ready yet. Try again."*
- **Downgrade locked note (Path head):** *"Your path is here whenever you return. New stones resume the moment you're back."*
- **Hidden-stones affordance (Path foot):** *"Hidden stones"* → list; each hidden letter footer: *"Restore this stone."*
- **Locked preview (below Plus):** a short evocative paragraph on what Waymarks is + *"See your own months marked"* upgrade affordance — no counts.
- **Annotation box:** *"＋ Add your words."*
- **Letter footer:** *"Save to notes · Hide this stone."*

> Exact final wording is copy-tunable during implementation, but the register is not: nothing may count, tally, or replay.

---

## 14. Testing (decision 19; 4 tiers)

1. **Deterministic unit (bulk; highest ROI; TDD-first; deletion-test discipline** — each test goes red if the rule it guards is deleted**):** the 6 §5 validators (§6.2, including the §6.4 nuances — a test that "Psalm 27" in prose passes but "Ps 27:14" fails, and that "the twelfth" passes but "showed up 14 days" fails); the §5 candidate-pool + month's-own-trail precedence ordering; the §9 retry/attempt transitions (`queued → running → failed`, cap 3 → `deferred`, clear-on-backfill); the controller state machine.
2. **Integration (test DB):** the **cohort query** is the backbone (one query encodes generation-selection + backfill + `tier = plus` + `deferred` exclusion) → most coverage; plus `lamplight_reflection_state` CRUD + **RLS** (no cross-user) + Path join (hidden → absent, restore → returns); regeneration upsert **preserving `saved_to_notes`**; entitlement enforcement incl. **downgrade-leaves-stones-readable**.
3. **Offline voice eval harness (Tier 3; non-gating):** ~5–8 hand-authored fixture months spanning register-hard cases — battle-heavy, single-entry sparse floor, span marker, forces-abstention off-list verse, zero-notes skip, sparse-vs-empty boundary. **The May 2026 exemplar (§2.2) is fixture #1.** Runs the **real** pipeline and asserts **guardrails hold** (validators pass + judge pass + structural invariants: marker count in range, no verse-level citations in prose, dates anchored) — **NOT exact prose**. Runs nightly / on-demand as a human-reviewed regression signal.
4. **Thin UI smoke e2e (minimal):** hide → gone → restore; annotate → renders as the user's words; locked-preview renders as an invitation (not a paywall) for non-Plus; on-demand failure → gentle retry.

**CI fork (decision 19):** CI gates Tiers 1–2 + Tier 4 using a **stubbed model client**; Tier 3 is offline.

**Not tested (YAGNI):** exact letter wording, prose snapshots, framework/Supabase internals, eval-scoring ML.

---

## 15. Out of scope / fast-follow

- **Yearly cairn generation + UI** — fully **designed** here (decisions 2, 11; §4.2, §7), **shipped fast-follow.** The type-CHECK value and identity land in migration 045 now (data-model completeness); MVP renders **year dividers as plain year labels**; the generated cairn letter, its "The Year of…" title, and its opening ceremony are the fast-follow.
- **Email / push transport** — not wired (`lamplight_settings.weekly_email` exists, no transport). Arrival is **in-app for MVP** (decision 3).
- **Recordings as input** — MVP reads note **text** (`notes.content`) only. `note_recordings` audio (043/044) + the existing `transcribe-note` edge function are a **future input**, not MVP text-scope.
- **`quiet_mode`** exists but is deliberately **not** wired into arrival for MVP.
- **Editing Lamplight's text** — never (decision 4). Only hide + annotate.

---

## 16. Verify at implementation

These are known unknowns to resolve during planning/implementation — not open design questions:
1. **Retry ledger:** does reusing `lamplight_jobs` for attempt/`deferred` tracking read cleaner than a purpose-built column/table? (`jobs` RLS is user-CRUD; the scheduled run uses the **service role** and bypasses RLS.) Add a partial unique index per `(user_id, kind, payload->>'period_key')` if reused (cf. the 011 embedding-refresh index).
2. **Entitlement gate reuse:** does `lamplight-generate` dispatch already enforce entitlement server-side, or must the two new kinds add it? (§10 layer 2.)
3. **type-CHECK constraint name:** confirm the auto-generated name from 008 before the `drop constraint` in §3.4.
4. **`update_updated_at()` signature:** confirm the exact function name/signature in `003_triggers.sql` for the §3.2 trigger.
5. **`bible_highlights` month-scoping:** confirm a `created_at` (or equivalent) column exists to bucket highlights into the month for the candidate pool.
6. **Match-RPC signatures** (012/016) and the **canonical-vs-display verse representation** used in markers and the allowlist (§5).
7. **Exact cron cadence** — hourly cohort query vs the existing per-minute `lamplight_jobs` drain (§7).
8. **`note_transcriptions` ↔ `note_recordings`** relationship (whether transcriptions already flow from recordings) — informs the future recordings-as-input path (§15), not MVP.

---

## 17. Tunable constants (single source)

| Constant | Default | Where |
|---|---|---|
| `ARRIVAL_HOUR_LOCAL` | `7` | client arrival rule (§7) |
| `BACKFILL_CAP` | `12` | first-open backfill (§8) |
| `MARKER_MIN` / `MARKER_MAX` | `1` / `6` | output shape + validator 1 (§4.3, §6.2) |
| `LETTER_WORD_MIN` / `LETTER_WORD_MAX` | tune to the exemplar (~60 / ~350) | validator 1 (§6.2) |
| `VERBATIM_RUN_MAX_WORDS` | `8` | witnessed-not-reopened lint, validator 5 (§6.2) |
| `RETRY_ATTEMPT_CAP` | `3` | scheduled retry → `deferred` (§9) |
| `CANDIDATE_POOL_TARGET` | `8–12` | per-marker candidate pool (§5) |
| `prompt_version` | `monthly-reflection-v1` | prompt + artifact provenance (§6.1) |

---

## Appendix A — Clarifications resolved while writing (not new product forks)

Three implementation-shape ambiguities were resolved so the spec is internally consistent. Each follows directly from a locked decision; none is a new product decision, so none is numbered 20+. All are surfaced here for transparency:

- **A1 — `title` lives in both the `title` column and `body.title`.** The model outputs `{ title, letter, markers }`; the edge function stores the full object in `body` (matching the locked body shape) and copies `title` into the `title` column (so The Path list query avoids loading `body`). Both are written atomically from one generation output; regeneration rewrites both. (Reconciles the "title = month name in column" and "body = { title, letter, markers }" statements from the brainstorm.)
- **A2 — the `'yearly_reflection'` type value is added in migration 045 now**, even though yearly *generation/UI* is fast-follow — a one-line CHECK addition that fixes the locked cairn identity (decision 11) and avoids a second migration. Yearly generation, the cairn letter/title, and the cairn opening ceremony remain fast-follow (§15).
- **A3 — MVP renders year dividers as plain year labels**; the generated cairn (a `yearly_reflection` artifact with a title and opening) is the fast-follow. This is the direct consequence of decision 2 (yearly = fast-follow) meeting decision 7 (cairn as year-gate divider).

## Appendix B — Provenance

Compiled from the brainstorm handoff chain `/tmp/handoff-reflection-timeline-brainstorm-2026-07-06{,-part2,-part3,-part4,-part5}.md` and grounded against live migrations this session (008 `lamplight_schema`, 011 `signal_layer` cron pattern, 019 `note_transcriptions`, 024/025 `chat_threads`, 027 `bible_highlights`, 042 `scripture_focus_lists`; `003_triggers` for `update_updated_at()`). Original feature spec: `/Users/newmac/Downloads/reflection-timeline-spec.md`. The May 2026 exemplar (§2.2) is verbatim from the approved `letter-view.html` mockup (companion dir is gitignored).
