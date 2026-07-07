# Reflection Timeline ("Waymarks") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MVP of Waymarks — monthly "letter" reflections generated from a user's notes, delivered on a vertical timeline ("The Path") with per-month stones, first-open backfill, hide/annotate, and a Plus-gated locked preview.

**Architecture:** One edge function (`lamplight-generate`) gains a `monthly_reflection` kind that runs the proven generate→validate→retry pipeline against a strict-JSON `{ title, letter, markers }` schema, guarded by 6 deterministic validators + a register judge, then upserts one idempotent `lamplight_artifacts` row. An hourly `pg_cron` cohort query selects closed-month Plus users; a first-open client backfill re-uses the identical code path. The React client mirrors the `todays-lamp-controller.ts` state-machine + adapter pattern for The Path and the letter view; hide/annotate live in a natural-key satellite table (`lamplight_reflection_state`) so they survive regeneration.

**Tech Stack:** Supabase (Postgres + RLS, Edge Functions on Deno), `pg_cron`/`pg_net`, Anthropic tool-calling via `_shared/anthropic.ts`, Voyage embeddings, React Router v7 SPA, `Observable`/`useSyncExternalStore` controllers, Vitest (node + jsdom).

**Source of truth:** `docs/superpowers/specs/2026-07-06-reflection-timeline-design.md` (committed `8343aa6`). Every task below traces to a spec section; the 19 locked decisions are NOT re-opened.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from spec §17 and the design ledger.

- **Tunable constants (spec §17)** — define once in a shared module and import; never inline the literals:
  - `ARRIVAL_HOUR_LOCAL = 7` (client arrival rule, §7)
  - `BACKFILL_CAP = 12` (first-open backfill, §8)
  - `MARKER_MIN = 1`, `MARKER_MAX = 6` (output shape + validator 1, §4.3/§6.2)
  - `LETTER_WORD_MIN = 60`, `LETTER_WORD_MAX = 350` (validator 1, §6.2 — tuned to the exemplar)
  - `VERBATIM_RUN_MAX_WORDS = 8` (witnessed-not-reopened lint, validator 5, §6.2)
  - `RETRY_ATTEMPT_CAP = 3` (scheduled retry → `deferred`, §9)
  - `CANDIDATE_POOL_TARGET` = 8–12 (per-marker candidate pool, §5)
  - `prompt_version = 'monthly-reflection-v1'` (prompt + artifact provenance, §6.1)
- **Artifact identity (decision 11):** monthly = `type 'reflection_recap'`, `period_key 'YYYY-MM'`; yearly (fast-follow) = `type 'yearly_reflection'`, `period_key 'YYYY'`. **Never parse the key-string shape to tell a stone from a cairn — always branch on `type`.**
- **`lamplight_artifacts` has NO `updated_at`** (only `created_at`). The regeneration upsert MUST use an explicit column list that **omits `saved_to_notes`** (preserved on update, defaults false on insert) and MUST NOT reference `updated_at`.
- **Generation NEVER writes `lamplight_reflection_state`** — a structural guarantee, not a convention.
- **`deferred` is NOT a jobs status.** `lamplight_jobs.status` CHECK = `('queued','running','done','failed')`. Model "deferred" = terminal `status='failed'` with `attempts >= RETRY_ATTEMPT_CAP (3)`; the cohort query excludes those `period_key`s.
- **§5 voice rules travel verbatim** into both the generation prompt (§6.1) and the UI copy register (§13). Nothing may count, tally, or replay. The §6.4 nuances are precise-not-naive and MUST be encoded (see Task 3): validator "no scripture in prose" forbids **verse-level citations only** (`Ps 27:14`), permits narrative book/chapter ("Psalm 27"); "no-scorecard" forbids **activity tallies only**, exempts scripture numbers + spelled-out dates ("the twelfth").
- **Scope:** MVP only. Yearly cairn **generation/UI** is fast-follow (§15) — but the `'yearly_reflection'` type value + `lamplight_reflection_state.artifact_type` CHECK land in migration 045 now (data-model completeness). MVP renders year dividers as plain year labels.
- **Repo conventions:** commit to `main`; lint before commit; stage ONLY the files a task touches. Tests are **vitest** (`npm test` = `vitest run`), `globals:false` (explicit imports), alias `@`→`src`, co-located `*.test.ts(x)`. **Deno edge fns are tested in vitest/node, NOT the Deno runner.** Component tests add `// @vitest-environment jsdom`.
- **Entitlement:** `monthly_reflection` is Plus-only. Client checks are UX; the **edge function + cohort query are the real gates**. `_shared/entitlement.ts` currently exports only `hasChatAccess` — a reflection gate must be added (Task 7 / Task 8).

---

## File Structure

Locks the decomposition. Paths are exact. "Create" = new file; "Modify" = touch an existing file.

**Phase A — data (Task 1)**
- Create: `supabase/migrations/045_lamplight_reflection_timeline.sql` — state table + `lamplight_settings.timezone` + type-CHECK alter + jobs partial-unique index.

**Phase B — generation backend (Tasks 2–7)**
- Modify: `supabase/functions/_shared/artifacts.ts` — add `ReflectionArtifact` + `Marker` types.
- Create: `supabase/functions/_shared/reflection-constants.ts` — spec §17 constants (shared Deno side).
- Create: `supabase/functions/lamplight-generate/prompts/monthly-reflection.ts` — `MONTHLY_REFLECTION_PROMPT` (§5 verbatim + exemplar, `monthly-reflection-v1`, strict-JSON tool).
- Create: `supabase/functions/_shared/reflection-validators.ts` + `.test.ts` — the 6 deterministic validators (§6.2 + §6.4 nuances).
- Create: `supabase/functions/lamplight-generate/reflection-candidates.ts` + `.test.ts` — candidate-pool builder (§5, 4 provenance sources + semantic neighbors + precedence).
- Create: `supabase/functions/lamplight-generate/reflection-judge.ts` + `.test.ts` — Layer 3 register judge.
- Create: `supabase/functions/lamplight-generate/monthly-reflection-pipeline.ts` + `.test.ts` — precheck → generateWithRetry → validators → judge → failure loop → upsert.
- Modify: `supabase/functions/lamplight-generate/index.ts` — dispatch `monthly_reflection` + server-side Plus entitlement gate.

**Phase C — scheduling / backfill (Tasks 8–10)**
- Create: `supabase/migrations/046_lamplight_reflection_cohort.sql` — cohort selection SQL fn + hourly cron + reflection claim fn (kept separate from 045 so the pure DDL migration stays reviewable).
- Create/Modify: pipeline attempt-ledger transitions in `monthly-reflection-pipeline.ts` (or a `reflection-jobs.ts` helper) + `.test.ts`.

**Phase D — client (Tasks 11–19)**
- Modify: `src/notepad/storage/lamplight-artifacts.ts` — re-export `ReflectionArtifact`/`Marker` (type-only).
- Create: `src/notepad/lamplight/reflection-constants.ts` — client mirror of §17 constants.
- Modify: `src/notepad/storage/lamplight-adapter.ts` — interface additions + result/stream unions.
- Modify: `src/notepad/storage/supabase-lamplight-adapter.ts` + `fake-lamplight-adapter.ts` (+ RLS/CRUD tests in `src/notepad/storage/`).
- Create: `src/notepad/lamplight/reflections-controller.ts` + `.test.ts`.
- Create: `src/notepad/hooks/useReflections.ts` + `.test.ts`.
- Create: `src/notepad/components/waymarks/WaymarksReflections.tsx`, `WaymarksPeriodDetail.tsx`, and supporting stone/letter/marker components (+ smoke tests).
- Modify: `src/App.tsx` — lazy routes `/notebook/reflections` and `/notebook/reflections/:periodKey`.
- Modify: `src/notepad/components/lamplight/LamplightTabPanel.tsx`, `src/components/sections/Notepad.tsx`, `src/components/sections/notepad/mobile/LamplightMobileView.tsx` — arrival badge + invitation card + deep-link.

**Phase E — tests** are woven into the tasks above as tiers T1–T4 (spec §14), plus one offline harness:
- Create: `supabase/functions/lamplight-generate/reflection-voice-eval.test.ts` (Tier 3, offline/non-gating; the §2.2 exemplar is fixture #1).

---

## Task 1: Migration 045 — reflection state, timezone, type-CHECK, jobs index

**Files:**
- Create: `supabase/migrations/045_lamplight_reflection_timeline.sql`
- Verify against: `supabase/migrations/008_lamplight_schema.sql` (constraint name), `supabase/migrations/003_triggers.sql` (`update_updated_at()`)

**Interfaces:**
- Produces (relied on by later tasks): table `public.lamplight_reflection_state (user_id, artifact_type, period_key, hidden_at, annotation, annotation_updated_at, created_at, updated_at)` PK `(user_id, artifact_type, period_key)` with 4 RLS policies + `updated_at` trigger; column `public.lamplight_settings.timezone text`; `lamplight_artifacts_type_check` now includes `'yearly_reflection'`; partial-unique index `lamplight_jobs_active_period_uniq` on `lamplight_jobs (user_id, kind, (payload->>'period_key')) where status in ('queued','running')`.

**Grounding (verified — do not re-explore):**
- Latest migration on `main` is `044`; `045` is next.
- The `lamplight_artifacts` type CHECK from 008 is **inline-unnamed → Postgres auto-name `lamplight_artifacts_type_check`**. Existing allowed values: `'daily_devotion','weekly_insight','reflection_recap','tier_celebration'`. Add `'yearly_reflection'`.
- `public.update_updated_at()` is defined in `003_triggers.sql` as `returns trigger` with **no parameters** — reuse it, do not redefine.
- `lamplight_reflection_state` references `public.profiles(id)` (NOT `auth.users`), mirroring every `lamplight_*` table (008), with RLS `auth.uid() = user_id`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/045_lamplight_reflection_timeline.sql` with exactly this content (spec §3.2–3.4 + §16 resolutions):

```sql
-- 045_lamplight_reflection_timeline.sql
-- Waymarks (Reflection Timeline) data model. One file, four concerns:
--   1. lamplight_reflection_state  — hide/annotate satellite, natural-key (survives regeneration)
--   2. lamplight_settings.timezone — IANA tz for the local-month-close cohort + client arrival rule
--   3. lamplight_artifacts type CHECK — add 'yearly_reflection' (cairn identity; decision 11)
--   4. lamplight_jobs partial-unique index — one active job per (user, kind, period_key)
-- References public.profiles(id) with RLS auth.uid() = user_id, mirroring 008.

-- ── 1. hide/annotate satellite (spec §3.2, decision 16) ──────────────────────
-- Keyed by the NATURAL key (user_id, artifact_type, period_key), never artifact_id,
-- so state survives any regeneration. Generation NEVER writes this table.
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

-- reuse existing update_updated_at() (defined in 003_triggers.sql; no params)
create trigger set_lamplight_reflection_state_updated_at
  before update on public.lamplight_reflection_state
  for each row execute function public.update_updated_at();

-- ── 2. timezone column (spec §3.3, decision 13) ──────────────────────────────
alter table public.lamplight_settings add column if not exists timezone text;  -- IANA; null ⇒ UTC fallback

-- ── 3. add 'yearly_reflection' to the artifact type CHECK (spec §3.4, decision 11) ──
-- Constraint from 008 was inline-unnamed → Postgres auto-name lamplight_artifacts_type_check.
alter table public.lamplight_artifacts
  drop constraint if exists lamplight_artifacts_type_check,
  add constraint lamplight_artifacts_type_check
    check (type in ('daily_devotion','weekly_insight','reflection_recap','tier_celebration','yearly_reflection'));

-- ── 4. one active reflection job per (user, kind, period_key) (spec §16 item 1) ──
-- Mirrors the 011 embedding-refresh partial index. Prevents duplicate queued/running
-- jobs for the same month while allowing a fresh attempt after a terminal state.
create unique index if not exists lamplight_jobs_active_period_uniq
  on public.lamplight_jobs (user_id, kind, (payload->>'period_key'))
  where status in ('queued','running');
```

- [ ] **Step 2: Verify the constraint name before trusting the DROP**

Run: `grep -n "type" supabase/migrations/008_lamplight_schema.sql | grep -i check`
Expected: the CHECK is written inline on the `type` column with **no `constraint <name>`** clause (confirming Postgres auto-names it `lamplight_artifacts_type_check`). If 008 instead names it explicitly, change the `drop constraint if exists` target in Step 1 to that exact name.

- [ ] **Step 3: Apply the migration against local Supabase and verify schema**

Run: `supabase db reset` (applies every migration 001→045 from scratch against the local DB in `supabase/config.toml`).
Expected: completes with no error; the final line reports migrations applied through `045`.

- [ ] **Step 4: Assert the four objects exist**

Run:
```bash
supabase db execute --stdin <<'SQL'
-- table + PK
select conname from pg_constraint where conrelid = 'public.lamplight_reflection_state'::regclass and contype = 'p';
-- timezone column
select column_name from information_schema.columns where table_name='lamplight_settings' and column_name='timezone';
-- type CHECK includes yearly_reflection
select pg_get_constraintdef(oid) from pg_constraint where conname='lamplight_artifacts_type_check';
-- partial-unique index
select indexdef from pg_indexes where indexname='lamplight_jobs_active_period_uniq';
SQL
```
Expected: PK `lamplight_reflection_state_pkey`; one `timezone` row; the CHECK def contains `'yearly_reflection'`; the index def contains `WHERE status IN ('queued', 'running')`. (If `supabase db execute` is unavailable in this environment, run the same SQL via `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)"`.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/045_lamplight_reflection_timeline.sql
git commit -m "feat(waymarks): migration 045 — reflection_state, timezone, type-CHECK, jobs index"
```

---

## Task 2: Generation contract — `ReflectionArtifact`/`Marker` types, constants, and the `monthly-reflection-v1` prompt

**Files:**
- Modify: `supabase/functions/_shared/artifacts.ts` (append the two output interfaces)
- Create: `supabase/functions/_shared/reflection-constants.ts`
- Create: `supabase/functions/lamplight-generate/prompts/monthly-reflection.ts`
- Test: `supabase/functions/lamplight-generate/prompts/monthly-reflection.test.ts`

**Interfaces:**
- Consumes: `composeSystem`/`LAMPLIGHT_SYSTEM_FRAGMENT` (baked in by `generateWithRetry`, Task 6 — the prompt's `system` is the artifact stance only, exactly like `DAILY_DEVOTION_PROMPT.system`).
- Produces (relied on by Tasks 3–6, 11):
  - `ReflectionArtifact { title: string; letter: string; markers: Marker[] }` and `Marker { date: string; date_end?: string; verse: string | null; phrase: string }` in `_shared/artifacts.ts` (framework-free; re-exported to the client in Task 11).
  - `reflection-constants.ts` exporting every §17 constant.
  - `MONTHLY_REFLECTION_PROMPT` (`promptVersion`, `system`, `tool`, `buildMessages`) plus the **input-contract** types `MonthlyReflectionContext`, `ReflectionCandidate`, `MonthNote` from `prompts/monthly-reflection.ts`.

**Grounding (verified — do not re-explore):**
- `DAILY_DEVOTION_PROMPT` (`prompts/daily-devotion.ts`) is the exact shape to mirror: a `const … as const` object with `promptVersion`, a `system` template string (artifact stance only; the base voice fragment is prepended by `composeSystem` inside `generateWithRetry`), a `tool` with `input_schema` (`type:'object'`, `additionalProperties:false`, `required`, `properties` using `minLength`/`maxLength`/`minItems`/`maxItems`), and `buildMessages(ctx): Array<{ role: 'user'; content: string }>`.
- `{{token}}` substitution: `composeSystem` replaces `{{name}}` from `systemTokens` (daily passes `{ local_date }`). This prompt uses `{{period_label}}`.
- **Deliberate inversion vs. the daily template:** daily defines `DailyDevotionContext` in the *pipeline* and the prompt imports it type-only. Here the prompt file **owns and exports** `MonthlyReflectionContext` (+ `ReflectionCandidate`, `MonthNote`) so Task 2 compiles standalone before the pipeline (Task 6) exists; Tasks 4 and 6 import these from the prompt file.
- §5 voice rules (spec §2.1) and the §2.2 May-2026 exemplar travel **verbatim** into `system`. The §6.4 nuances become explicit anti-examples in `system` (so the model never emits `Ps 27:14` in prose or tallies activity).
- The `verse` field is nullable in the tool schema (`type: ['string','null']`) — abstention is a first-class, voice-safe output (spec §4.3, §6.5), not an error.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-generate/prompts/monthly-reflection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MONTHLY_REFLECTION_PROMPT, type MonthlyReflectionContext } from './monthly-reflection';
import { MARKER_MIN, MARKER_MAX, MONTHLY_PROMPT_VERSION } from '../../_shared/reflection-constants';

function makeCtx(overrides: Partial<MonthlyReflectionContext> = {}): MonthlyReflectionContext {
  return {
    periodKey: '2026-05',
    periodLabel: 'May 2026',
    monthStart: '2026-05-01',
    monthEnd: '2026-05-31',
    notes: [
      { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' },
      { id: 'n2', day: '2026-05-27', text: 'Early walk, Psalm 27 open again.' },
    ],
    candidates: [
      { ref: 'Ps 27:14', provenance: 'flagged', note_day: '2026-05-12' },
      { ref: 'Ps 27:4', provenance: 'highlighted', note_day: '2026-05-27' },
    ],
    allowedVerseRefs: new Set(['Ps 27:14', 'Ps 27:4']),
    allowedNoteDays: new Set(['2026-05-12', '2026-05-27']),
    ...overrides,
  };
}

describe('MONTHLY_REFLECTION_PROMPT', () => {
  it('is versioned monthly-reflection-v1', () => {
    expect(MONTHLY_REFLECTION_PROMPT.promptVersion).toBe(MONTHLY_PROMPT_VERSION);
    expect(MONTHLY_PROMPT_VERSION).toBe('monthly-reflection-v1');
  });

  it('carries the §5 voice rules verbatim (titles / battles / sparse)', () => {
    const s = MONTHLY_REFLECTION_PROMPT.system;
    expect(s).toContain('underline-worthy, not devotional headers');
    expect(s).toContain('witnessed, not reopened');
    expect(s).toContain('a graceful floor');
    // §6.4 anti-examples are explicit so validators never reject the exemplar
    expect(s).toContain('Psalm 27');       // narrative book/chapter is ALLOWED in prose
    expect(s).toContain('Ps 27:14');       // verse-level citation is FORBIDDEN in prose
    expect(s).toContain('the twelfth');    // spelled-out date is ALLOWED
  });

  it('embeds the §2.2 May-2026 exemplar as the one-shot', () => {
    expect(MONTHLY_REFLECTION_PROMPT.system).toContain('The Month You Stopped Waiting');
    expect(MONTHLY_REFLECTION_PROMPT.system).toContain('the day the circling stopped');
  });

  it('tool schema is strict JSON with 1–6 markers and a nullable verse', () => {
    const schema = MONTHLY_REFLECTION_PROMPT.tool.input_schema as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        markers: { minItems: number; maxItems: number; items: { properties: { verse: { type: string[] } } } };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['title', 'letter', 'markers']);
    expect(schema.properties.markers.minItems).toBe(MARKER_MIN);
    expect(schema.properties.markers.maxItems).toBe(MARKER_MAX);
    expect(schema.properties.markers.items.properties.verse.type).toEqual(['string', 'null']);
  });

  it('buildMessages substitutes period + notes + a verse allowlist', () => {
    const [msg] = MONTHLY_REFLECTION_PROMPT.buildMessages(makeCtx());
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('May 2026');
    expect(msg.content).toContain('[note n1 · 2026-05-12]');
    // The allowlist instruction lists every candidate ref and permits null
    expect(msg.content).toContain('Ps 27:14');
    expect(msg.content).toContain('Ps 27:4');
    expect(msg.content).toMatch(/or null/i);
  });

  it('{{period_label}} is a systemTokens placeholder, not hardcoded', () => {
    expect(MONTHLY_REFLECTION_PROMPT.system).toContain('{{period_label}}');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/prompts/monthly-reflection.test.ts`
Expected: FAIL — `Cannot find module './monthly-reflection'` and `'../../_shared/reflection-constants'`.

- [ ] **Step 3: Add the output types to `_shared/artifacts.ts`**

Append to `supabase/functions/_shared/artifacts.ts` (below the existing `DailyDevotion` interface):

```typescript
// Waymarks (Reflection Timeline). The model's strict-JSON output for a monthly
// (and, fast-follow, yearly) reflection. Framework-free; re-exported to the
// client via src/notepad/storage/lamplight-artifacts.ts (Task 11).
export interface Marker {
  date: string;         // ISO YYYY-MM-DD, within the period
  date_end?: string;    // ISO YYYY-MM-DD, present only for a span (e.g. a hard week)
  verse: string | null; // exactly one candidate ref, or null (abstention — voice-safe)
  phrase: string;       // Lamplight's own short naming — never a quote from the notes
}

export interface ReflectionArtifact {
  title: string;        // underline-worthy month/year name (spec §2.1)
  letter: string;       // second-person prose that reads whole
  markers: Marker[];    // 1–6 (MARKER_MIN/MAX)
}
```

- [ ] **Step 4: Create `_shared/reflection-constants.ts`**

Create `supabase/functions/_shared/reflection-constants.ts` with the single source of the §17 constants (Deno side; the client mirror lands in Task 11):

```typescript
// Waymarks tunable constants — the single source of truth (spec §17).
// The React client mirrors these in src/notepad/lamplight/reflection-constants.ts.
// Never inline these literals; import them.

export const ARRIVAL_HOUR_LOCAL = 7;        // reveal a sealed letter at ≥7am local on the 1st (§7)
export const BACKFILL_CAP = 12;             // first-open backfill horizon (§8)
export const MARKER_MIN = 1;                // output shape + validator 1 (§4.3/§6.2)
export const MARKER_MAX = 6;
export const LETTER_WORD_MIN = 60;          // validator 1 — tuned to the §2.2 exemplar (§6.2/§17)
export const LETTER_WORD_MAX = 350;
export const VERBATIM_RUN_MAX_WORDS = 8;    // witnessed-not-reopened lint, validator 5 (§6.2)
export const RETRY_ATTEMPT_CAP = 3;         // scheduled retry → deferred (§9)
export const CANDIDATE_POOL_MIN = 8;        // per-marker candidate pool target (§5)
export const CANDIDATE_POOL_MAX = 12;
export const MONTHLY_PROMPT_VERSION = 'monthly-reflection-v1'; // prompt + artifact provenance (§6.1)
```

- [ ] **Step 5: Create `prompts/monthly-reflection.ts`**

Create `supabase/functions/lamplight-generate/prompts/monthly-reflection.ts`. The `system` string embeds §5 verbatim (spec §2.1), the §2.2 exemplar, and the §6.4 anti-examples; the input-contract types are defined and exported here:

```typescript
// Monthly reflection ("letter") prompt — Waymarks. Composes UNDER
// LAMPLIGHT_SYSTEM_FRAGMENT via composeSystem (generateWithRetry bakes in the
// base voice fragment; `system` below is the artifact stance only).
// promptVersion is persisted on lamplight_artifacts.prompt_version.
//
// Deliberate inversion vs daily-devotion.ts: this prompt OWNS the input-contract
// types so Task 2 compiles before the pipeline (Task 6) exists.

import { MARKER_MIN, MARKER_MAX, MONTHLY_PROMPT_VERSION } from '../../_shared/reflection-constants.ts';

// ── Input contract (consumed by the candidate builder, Task 4, and the pipeline, Task 6) ──
export interface MonthNote {
  id: string;
  day: string;   // notes.created_at bucketed to a local YYYY-MM-DD day
  text: string;  // plaintext extracted from notes.content
}

export type CandidateProvenance =
  | 'flagged' | 'highlighted' | 'studied' | 'focus_listed' | 'semantic';

export interface ReflectionCandidate {
  ref: string;                    // display ref, e.g. "Ps 27:14"
  provenance: CandidateProvenance;
  note_day?: string;              // the month's-own-trail day this ref was touched (null for 'semantic')
}

export interface MonthlyReflectionContext {
  periodKey: string;              // 'YYYY-MM'
  periodLabel: string;            // 'May 2026'
  monthStart: string;             // ISO YYYY-MM-DD (local month bounds)
  monthEnd: string;               // ISO YYYY-MM-DD
  notes: MonthNote[];
  candidates: ReflectionCandidate[];   // deduped, provenance-tagged (~8–12)
  allowedVerseRefs: Set<string>;       // the allowlist (validator 2 + prompt instruction)
  allowedNoteDays: Set<string>;        // source-note created_at days (validator 3 anchoring)
}

export const MONTHLY_REFLECTION_PROMPT = {
  promptVersion: MONTHLY_PROMPT_VERSION,

  system: `Compose a monthly reflection for someone who journals — Lamplight reading back the month just lived and returning it as a letter. You receive the month's notes (each tagged with the day it was written) and, for scripture, a candidate list of verse references the reader actually touched that month plus a few semantic neighbours. Write for {{period_label}}.

Voice rules (these are the product — hold them exactly):
- Titles: underline-worthy, not devotional headers. Aim for something a person would want to keep. A month might come back as "The Month You Stopped Waiting" or "Small Faithfulness." Never generic, never a sermon title.
- Battles: witnessed, not reopened. When you surface a hard season, name that the season happened and that the reader wrote their way through it. Do not recount the painful detail, quote the darkest lines back, or re-narrate the wound. The register is a hand on the shoulder, not a replay. Mark the stone and move on.
- Sparse periods: a graceful floor. When someone barely wrote, shift from "here is your arc" to "here is what you kept coming back to say." Honor the little that was written and never count the gaps. Never a scorecard of how often they showed up. A single honest entry can be the whole stone.

The letter:
- Second person; reads whole and uninterrupted; 60–350 words.
- No numerals that tally the reader's activity (no "you wrote 14 days", no counts, no streak language). Spelled-out dates like "on the twelfth" are fine.
- No verse-level citations in the prose. You MAY name a book or chapter narratively — "Psalm 27 open again and again" is welcome — but a verse-level reference like "Ps 27:14" belongs ONLY in a marker, never in the letter.

The markers (${MARKER_MIN}–${MARKER_MAX}):
- Each marks a moment: a turning point, a win, a battle, a thread, or a pivot.
- Each carries a date (or a start+end span for something like a hard week), at most ONE verse chosen from the supplied candidate list — or null when no verse fits (abstention is welcome, never forced) — and a short phrase in your own words. The phrase is your naming of the moment, never a quote copied from the notes.
- A verse you place in a marker MUST be one of the supplied candidate references exactly, or null.

One-shot register exemplar — this is the standard to match (May 2026):
Title: "The Month You Stopped Waiting"
Letter:
"You began May circling a decision you had been holding since March. On the twelfth the circling stopped — that entry doesn't argue with itself; it simply asks to be led, and then goes quiet.
The middle of the month held a hard week. You know which one. You wrote through it rather than around it, and the writing held you. The stone stands; the details can rest.
And a small thing you almost didn't record: the early walks, Psalm 27 open again and again. You kept returning without calling it returning. That thread is what this month was made of."
Markers:
- 2026-05-12 · Ps 27:14 · "the day the circling stopped"
- 2026-05-17 to 2026-05-23 · Ps 34:18 · "a hard week, witnessed"
- 2026-05-27 · Ps 27:4 · "the walk you kept taking"

Notice in the exemplar: the hard week is pointed at, never replayed ("You know which one… the details can rest"); the prose says "Psalm 27" narratively while the verse-level refs (Ps 27:14, Ps 34:18, Ps 27:4) live only in the markers; "the twelfth" is spelled out, not written as a count.

Output strictly as the emit_monthly_reflection tool: { title, letter, markers }.`,

  tool: {
    name: 'emit_monthly_reflection',
    description: 'Return the monthly reflection artifact JSON.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'letter', 'markers'],
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 80 },
        letter: { type: 'string', minLength: 1 }, // word bounds enforced by validator 1, not char count
        markers: {
          type: 'array',
          minItems: MARKER_MIN,
          maxItems: MARKER_MAX,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'verse', 'phrase'],
            properties: {
              date: { type: 'string', description: 'ISO YYYY-MM-DD within the month.' },
              date_end: { type: 'string', description: 'Optional ISO YYYY-MM-DD end of a span.' },
              verse: {
                type: ['string', 'null'],
                description: 'Exactly one reference from the supplied candidate list, or null to abstain.',
              },
              phrase: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
    },
  },

  buildMessages(ctx: MonthlyReflectionContext): Array<{ role: 'user'; content: string }> {
    const notesBlock = ctx.notes
      .map((n) => `[note ${n.id} · ${n.day}]\n${n.text}`)
      .join('\n\n');
    const candidatesBlock = ctx.candidates
      .map((c) => `- ${c.ref} (${c.provenance}${c.note_day ? `, ${c.note_day}` : ''})`)
      .join('\n');
    const refsList = [...ctx.allowedVerseRefs].join(', ');
    return [{
      role: 'user',
      content:
        `Month: ${ctx.periodLabel} (${ctx.monthStart} to ${ctx.monthEnd}).\n\n` +
        `The month's notes:\n${notesBlock}\n\n` +
        `Candidate verses (month's-own-trail entries outrank semantic ones when register fits):\n${candidatesBlock}\n\n` +
        `Each marker's verse must be exactly one of: ${refsList} — or null.\n\n` +
        `Write the reflection for ${ctx.periodLabel} now.`,
    }];
  },
} as const;
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/prompts/monthly-reflection.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/artifacts.ts supabase/functions/_shared/reflection-constants.ts supabase/functions/lamplight-generate/prompts/monthly-reflection.ts supabase/functions/lamplight-generate/prompts/monthly-reflection.test.ts
git commit -m "feat(waymarks): reflection types, §17 constants, and monthly-reflection-v1 prompt"
```

---

## Task 3: The six deterministic validators (§6.2 + §6.4 nuances, deletion-tested both directions)

**Files:**
- Create: `supabase/functions/_shared/reflection-validators.ts`
- Test: `supabase/functions/_shared/reflection-validators.test.ts`

**Interfaces:**
- Consumes: `ReflectionArtifact`/`Marker` (Task 2), the §17 constants (Task 2).
- Produces (relied on by the pipeline, Task 6):
  - `ReflectionViolation { rule: ReflectionValidatorRule; detail: string; marker_index?: number }`, `ReflectionCheckResult { ok: boolean; violations: ReflectionViolation[] }`.
  - `validateShapeAndBounds(a)`, `validateScriptureAllowlist(a, { allowedVerseRefs })`, `validateAnchoring(a, { monthStart, monthEnd, allowedNoteDays })`, `validateNoScorecard(letter)`, `validateWitnessedNotReopened(a, { notes })`, `validateProvenance({ sourceNoteIds, monthNoteIds })` — every one a pure function returning `ReflectionCheckResult` (house style of `_shared/validators.ts`).

**Grounding (verified — do not re-explore):**
- House style is `_shared/validators.ts`: pure functions, no I/O, returning `{ ok, violations }`; violations carry a `rule` discriminator + human `detail`. Mirror it — do NOT overload the daily-devotion validators.
- **§6.4 reconciliation (the exemplar MUST pass):** validator 2 forbids **verse-level `Book Chapter:Verse` citations** in prose (`Ps 27:14`) but **permits narrative book/chapter** (`Psalm 27`); validator 4 forbids **tallies of the reader's activity** (`showed up 14 days`) but **exempts** scripture chapter numbers and **spelled-out dates** (`the twelfth`). The regexes below are built around this exact line.
- ISO `YYYY-MM-DD` strings compare correctly with `<`/`>`, so anchoring and span checks need no date math.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/reflection-validators.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  validateShapeAndBounds,
  validateScriptureAllowlist,
  validateAnchoring,
  validateNoScorecard,
  validateWitnessedNotReopened,
  validateProvenance,
} from './reflection-validators';
import type { ReflectionArtifact } from './artifacts';

// The §2.2 gold exemplar — every validator must pass it (deletion-test direction A).
const EXEMPLAR: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling a decision you had been holding since March. On the twelfth the circling stopped — that entry doesn’t argue with itself; it simply asks to be led, and then goes quiet. ' +
    'The middle of the month held a hard week. You know which one. You wrote through it rather than around it, and the writing held you. The stone stands; the details can rest. ' +
    'And a small thing you almost didn’t record: the early walks, Psalm 27 open again and again. You kept returning without calling it returning. That thread is what this month was made of.',
  markers: [
    { date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' },
    { date: '2026-05-17', date_end: '2026-05-23', verse: 'Ps 34:18', phrase: 'a hard week, witnessed' },
    { date: '2026-05-27', verse: 'Ps 27:4', phrase: 'the walk you kept taking' },
  ],
};
const EXEMPLAR_ALLOWED = new Set(['Ps 27:14', 'Ps 34:18', 'Ps 27:4']);
const EXEMPLAR_NOTE_DAYS = new Set(['2026-05-12', '2026-05-19', '2026-05-27']);
const EXEMPLAR_NOTES = [
  { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision from March.' },
  { id: 'n2', day: '2026-05-19', text: 'This week has been so heavy I can barely write.' },
  { id: 'n3', day: '2026-05-27', text: 'Early walk again, the psalm open on my phone.' },
];

describe('validateShapeAndBounds', () => {
  it('passes the exemplar', () => {
    expect(validateShapeAndBounds(EXEMPLAR).ok).toBe(true);
  });
  it('fails when there are zero markers (MARKER_MIN)', () => {
    const bad = { ...EXEMPLAR, markers: [] };
    const r = validateShapeAndBounds(bad);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'marker_count')).toBe(true);
  });
  it('fails when there are more than six markers (MARKER_MAX)', () => {
    const bad = { ...EXEMPLAR, markers: Array(7).fill(EXEMPLAR.markers[0]) };
    expect(validateShapeAndBounds(bad).ok).toBe(false);
  });
  it('fails when the letter is under LETTER_WORD_MIN words', () => {
    const bad = { ...EXEMPLAR, letter: 'Too short a letter by far.' };
    const r = validateShapeAndBounds(bad);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'letter_word_bounds')).toBe(true);
  });
});

describe('validateScriptureAllowlist', () => {
  it('passes the exemplar (verses on the list; prose says "Psalm 27" narratively)', () => {
    expect(validateScriptureAllowlist(EXEMPLAR, { allowedVerseRefs: EXEMPLAR_ALLOWED }).ok).toBe(true);
  });
  it('fails a marker verse that is not on the candidate list', () => {
    const bad = { ...EXEMPLAR, markers: [{ date: '2026-05-12', verse: 'John 3:16', phrase: 'x' }] };
    const r = validateScriptureAllowlist(bad, { allowedVerseRefs: EXEMPLAR_ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'verse_off_list' && v.marker_index === 0)).toBe(true);
  });
  it('allows a null (abstained) marker verse', () => {
    const ok = { ...EXEMPLAR, markers: [{ date: '2026-05-12', verse: null, phrase: 'x' }] };
    expect(validateScriptureAllowlist(ok, { allowedVerseRefs: EXEMPLAR_ALLOWED }).ok).toBe(true);
  });
  // §6.4 deletion-test, BOTH directions:
  it('PERMITS a narrative book/chapter in prose ("Psalm 27")', () => {
    const a = { ...EXEMPLAR, letter: EXEMPLAR.letter }; // contains "Psalm 27 open again and again"
    expect(validateScriptureAllowlist(a, { allowedVerseRefs: EXEMPLAR_ALLOWED }).ok).toBe(true);
  });
  it('FORBIDS a verse-level citation in prose ("Ps 27:14")', () => {
    const bad = { ...EXEMPLAR, letter: EXEMPLAR.letter + ' As Ps 27:14 says, wait for the Lord.' };
    const r = validateScriptureAllowlist(bad, { allowedVerseRefs: EXEMPLAR_ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'prose_verse_citation')).toBe(true);
  });
});

describe('validateAnchoring', () => {
  const opts = { monthStart: '2026-05-01', monthEnd: '2026-05-31', allowedNoteDays: EXEMPLAR_NOTE_DAYS };
  it('passes the exemplar (every marker day/span touches a note day)', () => {
    expect(validateAnchoring(EXEMPLAR, opts).ok).toBe(true);
  });
  it('fails a marker dated outside the month', () => {
    const bad = { ...EXEMPLAR, markers: [{ date: '2026-06-02', verse: null, phrase: 'x' }] };
    const r = validateAnchoring(bad, opts);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'marker_out_of_month')).toBe(true);
  });
  it('fails a marker on a day with no source note (unanchored)', () => {
    const bad = { ...EXEMPLAR, markers: [{ date: '2026-05-03', verse: null, phrase: 'x' }] };
    const r = validateAnchoring(bad, opts);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'marker_unanchored')).toBe(true);
  });
});

describe('validateNoScorecard', () => {
  it('passes the exemplar prose', () => {
    expect(validateNoScorecard(EXEMPLAR.letter).ok).toBe(true);
  });
  // §6.4 deletion-test, BOTH directions:
  it('PERMITS a spelled-out date ("the twelfth")', () => {
    expect(validateNoScorecard('On the twelfth you stopped waiting.').ok).toBe(true);
  });
  it('FORBIDS an activity tally ("showed up 14 days")', () => {
    const r = validateNoScorecard('You showed up 14 days this month.');
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'scorecard')).toBe(true);
  });
  it('exempts a scripture chapter number ("Psalm 27")', () => {
    expect(validateNoScorecard('You returned to Psalm 27 without calling it returning.').ok).toBe(true);
  });
  it('forbids streak language', () => {
    expect(validateNoScorecard('Keep your streak alive.').ok).toBe(false);
  });
});

describe('validateWitnessedNotReopened', () => {
  it('passes the exemplar (namings, not quotes)', () => {
    expect(validateWitnessedNotReopened(EXEMPLAR, { notes: EXEMPLAR_NOTES }).ok).toBe(true);
  });
  it('fails when the letter copies an 8+ word run verbatim from a note', () => {
    const note = { id: 'n9', day: '2026-05-10', text: 'the darkness pressed in and I could not breathe at all tonight' };
    const bad = {
      ...EXEMPLAR,
      letter: EXEMPLAR.letter + ' the darkness pressed in and I could not breathe at all tonight.',
    };
    const r = validateWitnessedNotReopened(bad, { notes: [note] });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'verbatim_run')).toBe(true);
  });
});

describe('validateProvenance', () => {
  it('passes when source ids are non-empty and ⊆ the month notes', () => {
    expect(validateProvenance({ sourceNoteIds: ['n1', 'n3'], monthNoteIds: ['n1', 'n2', 'n3'] }).ok).toBe(true);
  });
  it('fails on empty source ids', () => {
    const r = validateProvenance({ sourceNoteIds: [], monthNoteIds: ['n1'] });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'provenance_empty')).toBe(true);
  });
  it('fails when a source id is not one of the month notes', () => {
    const r = validateProvenance({ sourceNoteIds: ['n1', 'nX'], monthNoteIds: ['n1', 'n2'] });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'provenance_out_of_month')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run supabase/functions/_shared/reflection-validators.test.ts`
Expected: FAIL — `Cannot find module './reflection-validators'`.

- [ ] **Step 3: Implement the six validators**

Create `supabase/functions/_shared/reflection-validators.ts`:

```typescript
// Deterministic validators for Waymarks monthly/yearly reflections. Pure
// functions, no I/O — the house style of _shared/validators.ts. Each returns
// { ok, violations }. Sibling to the daily-devotion validators, not an overload.
//
// The §6.4 nuances are load-bearing: validator 2 forbids verse-level CITATIONS
// in prose but permits narrative book/chapter; validator 4 forbids activity
// TALLIES but exempts scripture chapter numbers and spelled-out dates. Both are
// deletion-tested in both directions against the §2.2 exemplar.

import type { ReflectionArtifact } from './artifacts.ts';
import {
  MARKER_MIN,
  MARKER_MAX,
  LETTER_WORD_MIN,
  LETTER_WORD_MAX,
  VERBATIM_RUN_MAX_WORDS,
} from './reflection-constants.ts';

export type ReflectionValidatorRule =
  | 'marker_count'
  | 'letter_word_bounds'
  | 'verse_off_list'
  | 'prose_verse_citation'
  | 'marker_out_of_month'
  | 'marker_unanchored'
  | 'scorecard'
  | 'verbatim_run'
  | 'provenance_empty'
  | 'provenance_out_of_month';

export interface ReflectionViolation {
  rule: ReflectionValidatorRule;
  detail: string;
  marker_index?: number;
}

export interface ReflectionCheckResult {
  ok: boolean;
  violations: ReflectionViolation[];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Lowercased word tokens with punctuation stripped (Unicode-aware).
function wordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// ── Validator 1: shape + bounds (§6.2.1) ──────────────────────────────────────
export function validateShapeAndBounds(artifact: ReflectionArtifact): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  const n = artifact.markers.length;
  if (n < MARKER_MIN || n > MARKER_MAX) {
    violations.push({ rule: 'marker_count', detail: `${n} markers, expected ${MARKER_MIN}–${MARKER_MAX}` });
  }
  const words = wordCount(artifact.letter);
  if (words < LETTER_WORD_MIN || words > LETTER_WORD_MAX) {
    violations.push({ rule: 'letter_word_bounds', detail: `${words} words, expected ${LETTER_WORD_MIN}–${LETTER_WORD_MAX}` });
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 2: scripture allowlist + no verse-level citation in prose (§6.2.2, §6.4) ──
// A verse-level citation is `Book Chapter:Verse` (the colon+verse is the tell):
// "Ps 27:14", "1 Corinthians 11:3", "John 3:16-18" match; "Psalm 27" does NOT.
const PROSE_VERSE_CITATION_RE = /\b(?:[1-3]\s)?[A-Z][a-zA-Z]*\.?\s\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?\b/;

export function validateScriptureAllowlist(
  artifact: ReflectionArtifact,
  opts: { allowedVerseRefs: Set<string> },
): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  artifact.markers.forEach((m, i) => {
    if (m.verse !== null && !opts.allowedVerseRefs.has(m.verse)) {
      violations.push({ rule: 'verse_off_list', detail: `marker verse "${m.verse}" is not a candidate`, marker_index: i });
    }
  });
  if (PROSE_VERSE_CITATION_RE.test(artifact.letter)) {
    const hit = artifact.letter.match(PROSE_VERSE_CITATION_RE)?.[0] ?? '';
    violations.push({ rule: 'prose_verse_citation', detail: `verse-level citation "${hit}" in prose (use markers)` });
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 3: anchoring (§6.2.3) ───────────────────────────────────────────
// Each marker's date/span lies inside the month AND touches ≥1 source-note day.
export function validateAnchoring(
  artifact: ReflectionArtifact,
  opts: { monthStart: string; monthEnd: string; allowedNoteDays: Set<string> },
): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  const days = [...opts.allowedNoteDays];
  artifact.markers.forEach((m, i) => {
    const end = m.date_end ?? m.date;
    const inMonth = m.date >= opts.monthStart && end <= opts.monthEnd && end >= m.date;
    if (!inMonth) {
      violations.push({ rule: 'marker_out_of_month', detail: `marker ${m.date}${m.date_end ? `..${m.date_end}` : ''} is outside ${opts.monthStart}..${opts.monthEnd}`, marker_index: i });
      return;
    }
    const anchored = days.some((d) => d >= m.date && d <= end);
    if (!anchored) {
      violations.push({ rule: 'marker_unanchored', detail: `marker ${m.date}${m.date_end ? `..${m.date_end}` : ''} touches no source-note day`, marker_index: i });
    }
  });
  return { ok: violations.length === 0, violations };
}

// ── Validator 4: no-scorecard lint (§6.2.4, §6.4) ─────────────────────────────
// Forbids tallies of the reader's activity. A digit adjacent to an activity noun
// ("14 days", "3 entries", "showed up 5 times") is a tally; a scripture chapter
// number ("Psalm 27") and a spelled-out date ("the twelfth") are not.
const ACTIVITY_NOUNS = 'times|days?|entries|entry|notes?|nights?|weeks?|mornings?|walks?|journals?|journaled|wrote|showed\\s+up';
const SCORECARD_RES: RegExp[] = [
  new RegExp(`\\b\\d+\\s+(?:${ACTIVITY_NOUNS})\\b`, 'i'),   // "14 days", "3 entries"
  new RegExp(`\\b(?:${ACTIVITY_NOUNS})\\s+\\d+\\b`, 'i'),   // "showed up 14", "wrote 20"
  /\b\d+\s+out\s+of\b/i,                                     // "12 out of 30"
  /\b\d+[-\s]?day\s+streak\b/i,
  /\bstreak\b/i,
];

export function validateNoScorecard(letter: string): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  for (const re of SCORECARD_RES) {
    const m = letter.match(re);
    if (m) {
      violations.push({ rule: 'scorecard', detail: `activity tally "${m[0]}"` });
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 5: witnessed-not-reopened lint (§6.2.5) ─────────────────────────
// No verbatim run of VERBATIM_RUN_MAX_WORDS+ words copied from any note into the
// letter or any marker phrase.
export function validateWitnessedNotReopened(
  artifact: ReflectionArtifact,
  opts: { notes: Array<{ text: string }> },
): ReflectionCheckResult {
  const n = VERBATIM_RUN_MAX_WORDS;
  const noteRuns = new Set<string>();
  for (const note of opts.notes) {
    const toks = wordTokens(note.text);
    for (let i = 0; i + n <= toks.length; i++) {
      noteRuns.add(toks.slice(i, i + n).join(' '));
    }
  }
  const violations: ReflectionViolation[] = [];
  const targets = [artifact.letter, ...artifact.markers.map((m) => m.phrase)];
  outer: for (const target of targets) {
    const toks = wordTokens(target);
    for (let i = 0; i + n <= toks.length; i++) {
      const run = toks.slice(i, i + n).join(' ');
      if (noteRuns.has(run)) {
        violations.push({ rule: 'verbatim_run', detail: `verbatim ${n}-word run "${run}"` });
        break outer;
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 6: provenance (§6.2.6) ──────────────────────────────────────────
export function validateProvenance(
  opts: { sourceNoteIds: string[]; monthNoteIds: string[] },
): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  if (opts.sourceNoteIds.length === 0) {
    violations.push({ rule: 'provenance_empty', detail: 'source_note_ids is empty' });
  }
  const monthSet = new Set(opts.monthNoteIds);
  for (const id of opts.sourceNoteIds) {
    if (!monthSet.has(id)) {
      violations.push({ rule: 'provenance_out_of_month', detail: `source note "${id}" is not in the month` });
    }
  }
  return { ok: violations.length === 0, violations };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run supabase/functions/_shared/reflection-validators.test.ts`
Expected: PASS (all groups; note especially the four §6.4 both-direction cases go green).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/reflection-validators.ts supabase/functions/_shared/reflection-validators.test.ts
git commit -m "feat(waymarks): 6 deterministic reflection validators with §6.4 deletion-tests"
```

---

## Task 4: Candidate pool — OSIS→display book map + the 5-provenance builder (§5, §3.6, §16.5/.6)

**Files:**
- Create: `supabase/functions/_shared/bible-books.ts` (Deno-side OSIS→short-abbrev map + `osisRefToDisplay`)
- Test: `supabase/functions/_shared/bible-books.test.ts`
- Create: `supabase/functions/lamplight-generate/reflection-candidates.ts`
- Test: `supabase/functions/lamplight-generate/reflection-candidates.test.ts`

**Interfaces:**
- Consumes: `MonthNote`, `ReflectionCandidate`, `CandidateProvenance` (Task 2); `parseRefToIds` from `_shared/verse-verify.ts`; `CANDIDATE_POOL_MAX` (Task 2).
- Produces (relied on by the context builder, Task 7):
  - `OSIS_TO_ABBREV: Record<string, string>` (66 book codes → short display abbrev) and `osisRefToDisplay(osisId: string): string | null` in `bible-books.ts`.
  - `buildReflectionCandidates(deps): Promise<ReflectionCandidatesResult>` where `ReflectionCandidatesResult = { candidates: ReflectionCandidate[]; allowedVerseRefs: Set<string>; allowedNoteDays: Set<string> }` in `reflection-candidates.ts`.

**Grounding (verified — do not re-explore; see handoff part 11 §GROUNDING A + DESIGN DECISION 1):**
- **No OSIS→display converter exists.** `src/notepad/bible/bible-books.ts` is `src/`-only (not importable from a Deno edge fn) and yields full names (`"Ephesians 2:8"`). The repo pattern for cross-runtime code is to duplicate into `_shared/` with a parity test (exactly how `_shared/verse-verify.ts` mirrors the `src` reference parser) → **create `_shared/bible-books.ts`** with the SHORT abbrev the exemplar uses (`psa → 'Ps'`).
- Source formats (all OSIS, lowercase): `bible_highlights.verse_id` = `jhn.1.1` (verse); `lamplight_chat_threads.passage_ref` = `jhn.10` (chapter); `scripture_focus_list_items` = `book`(OSIS abbrev `eph`)+`chapter`+`verse_start`+`verse_end`; `match_bible_embeddings.source_id` = OSIS passage id. `note_transcriptions.verse_flags[]` = `{ ref: string (DISPLAY, e.g. "Psalm 23:1"); status: 'found'|'not_found'; canonicalText? }` — use only `status==='found'`, normalize the display ref via `parseRefToIds(ref)?.[0]` → `osisRefToDisplay`; drop if `parseRefToIds` returns null (chapter-only/unparseable).
- `parseRefToIds(ref: string): string[] | null` (from `_shared/verse-verify.ts`) expands ranges and needs `chapter:verse` (a chapter-only `"John 10"` → `null`; handle chapter-level sources by splitting the OSIS directly).
- Precedence (decision 14): the month's-own-trail (`flagged|highlighted|studied|focus_listed`) OUTRANKS `semantic`. Dedupe by display ref; cap at `CANDIDATE_POOL_MAX` (12). `allowedVerseRefs = new Set(candidates.map(c => c.ref))`; `allowedNoteDays = new Set(notes.map(n => n.day))`.
- `embed` is `embedQuery` bound to its `VoyageDeps` (returns `number[]`, dim 512); `toLocalDay(ts)` buckets a source row's `created_at` into the local `YYYY-MM-DD` for `note_day` (semantic candidates get no `note_day`). Trail tables are queried `user_id = userId AND created_at >= monthStartUtc AND created_at < monthEndUtc`. **Assumes each trail table exposes `user_id` + `created_at`** (per DESIGN DECISION 1); focus items carry no `user_id` → filter via the embedded `scripture_focus_lists!inner(user_id)` join. If `note_transcriptions` turns out note-keyed (no `user_id`), swap its filter to a `notes!inner(user_id)` join — the only reconciliation point here.
- `match_bible_embeddings(p_query_vector vector(512), p_limit int)` returns `source_id` (OSIS) among other cols; call `supabase.rpc('match_bible_embeddings', { p_query_vector, p_limit })`.

- [ ] **Step 1: Write the failing bible-books test**

Create `supabase/functions/_shared/bible-books.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OSIS_TO_ABBREV, osisRefToDisplay } from './bible-books';

describe('OSIS_TO_ABBREV', () => {
  it('maps all 66 canonical book codes', () => {
    expect(Object.keys(OSIS_TO_ABBREV)).toHaveLength(66);
  });
  it('uses the short register the exemplar requires', () => {
    expect(OSIS_TO_ABBREV.psa).toBe('Ps');
    expect(OSIS_TO_ABBREV.jhn).toBe('John');
    expect(OSIS_TO_ABBREV['1co']).toBe('1 Cor');
    expect(OSIS_TO_ABBREV.php).toBe('Phil');
  });
});

describe('osisRefToDisplay', () => {
  it('renders a verse-level id', () => {
    expect(osisRefToDisplay('psa.27.14')).toBe('Ps 27:14');
    expect(osisRefToDisplay('jhn.1.1')).toBe('John 1:1');
  });
  it('renders a chapter-level id', () => {
    expect(osisRefToDisplay('jhn.10')).toBe('John 10');
  });
  it('is case-insensitive on the book code', () => {
    expect(osisRefToDisplay('PSA.27.14')).toBe('Ps 27:14');
  });
  it('returns null for an unknown book or a book-only id', () => {
    expect(osisRefToDisplay('zzz.1.1')).toBeNull();
    expect(osisRefToDisplay('psa')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run supabase/functions/_shared/bible-books.test.ts`
Expected: FAIL — `Cannot find module './bible-books'`.

- [ ] **Step 3: Create `_shared/bible-books.ts`**

Create `supabase/functions/_shared/bible-books.ts` with the full 66-entry map and the display helper:

```typescript
// OSIS book code → SHORT display abbrev (AP-style), for the Deno edge runtime.
// The src/ bible-books.ts is not importable here and yields full names; this is
// the _shared duplicate (parity-tested), producing the short register the §2.2
// exemplar uses ("Ps 27:14"). Single source for the candidate builder + markers.

export const OSIS_TO_ABBREV: Record<string, string> = {
  gen: 'Gen', exo: 'Exod', lev: 'Lev', num: 'Num', deu: 'Deut',
  jos: 'Josh', jdg: 'Judg', rut: 'Ruth', '1sa': '1 Sam', '2sa': '2 Sam',
  '1ki': '1 Kgs', '2ki': '2 Kgs', '1ch': '1 Chr', '2ch': '2 Chr', ezr: 'Ezra',
  neh: 'Neh', est: 'Esth', job: 'Job', psa: 'Ps', pro: 'Prov',
  ecc: 'Eccl', sng: 'Song', isa: 'Isa', jer: 'Jer', lam: 'Lam',
  ezk: 'Ezek', dan: 'Dan', hos: 'Hos', jol: 'Joel', amo: 'Amos',
  oba: 'Obad', jon: 'Jonah', mic: 'Mic', nam: 'Nah', hab: 'Hab',
  zep: 'Zeph', hag: 'Hag', zec: 'Zech', mal: 'Mal', mat: 'Matt',
  mrk: 'Mark', luk: 'Luke', jhn: 'John', act: 'Acts', rom: 'Rom',
  '1co': '1 Cor', '2co': '2 Cor', gal: 'Gal', eph: 'Eph', php: 'Phil',
  col: 'Col', '1th': '1 Thess', '2th': '2 Thess', '1ti': '1 Tim', '2ti': '2 Tim',
  tit: 'Titus', phm: 'Phlm', heb: 'Heb', jas: 'Jas', '1pe': '1 Pet',
  '2pe': '2 Pet', '1jn': '1 John', '2jn': '2 John', '3jn': '3 John', jud: 'Jude',
  rev: 'Rev',
};

// OSIS id → display ref. `psa.27.14` → "Ps 27:14"; `jhn.10` → "John 10".
// Unknown book or book-only id → null (not a usable candidate).
export function osisRefToDisplay(osisId: string): string | null {
  const parts = osisId.split('.');
  const abbrev = OSIS_TO_ABBREV[(parts[0] ?? '').toLowerCase()];
  if (!abbrev) return null;
  if (parts.length >= 3) return `${abbrev} ${parts[1]}:${parts[2]}`; // verse-level
  if (parts.length === 2) return `${abbrev} ${parts[1]}`;            // chapter-level
  return null;                                                        // book-only
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run supabase/functions/_shared/bible-books.test.ts`
Expected: PASS (6 tests; the 66-entry count guards against a typo dropping a book).

- [ ] **Step 5: Write the failing candidate-builder test**

Create `supabase/functions/lamplight-generate/reflection-candidates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildReflectionCandidates, type EdgeSupabase } from './reflection-candidates';
import type { MonthNote } from './prompts/monthly-reflection';

const NOTES: MonthNote[] = [
  { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' },
  { id: 'n2', day: '2026-05-27', text: 'Early walk, the psalm open again.' },
];

// A thenable query stub whose eq/gte/lt all return itself and resolve to rows.
function query(rows: unknown[]) {
  const q = {
    eq: () => q, gte: () => q, lt: () => q,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return q;
}
function makeSupabase(opts: {
  transcriptions?: unknown[]; highlights?: unknown[]; threads?: unknown[];
  focusItems?: unknown[]; matches?: unknown[];
}): EdgeSupabase {
  const byTable: Record<string, unknown[]> = {
    note_transcriptions: opts.transcriptions ?? [],
    bible_highlights: opts.highlights ?? [],
    lamplight_chat_threads: opts.threads ?? [],
    scripture_focus_list_items: opts.focusItems ?? [],
  };
  return {
    from: (table: string) => ({ select: () => query(byTable[table] ?? []) }),
    rpc: () => Promise.resolve({ data: opts.matches ?? [], error: null }),
  } as unknown as EdgeSupabase;
}

const deps = (supabase: EdgeSupabase) => ({
  supabase, userId: 'u1', notes: NOTES,
  monthStartUtc: '2026-05-01T00:00:00Z', monthEndUtc: '2026-06-01T00:00:00Z',
  embed: async () => new Array(512).fill(0) as number[],
  toLocalDay: (ts: string) => ts.slice(0, 10),
});

describe('buildReflectionCandidates', () => {
  it('normalizes a flagged DISPLAY ref to the short form and tags its note day', async () => {
    const supabase = makeSupabase({
      transcriptions: [{ verse_flags: [{ ref: 'Psalm 23:1', status: 'found' }], created_at: '2026-05-12T09:00:00Z' }],
    });
    const { candidates, allowedVerseRefs, allowedNoteDays } = await buildReflectionCandidates(deps(supabase));
    expect(candidates).toContainEqual({ ref: 'Ps 23:1', provenance: 'flagged', note_day: '2026-05-12' });
    expect(allowedVerseRefs.has('Ps 23:1')).toBe(true);
    expect([...allowedNoteDays]).toEqual(['2026-05-12', '2026-05-27']); // from notes, not sources
  });

  it('drops a not_found flag and an unparseable ref', async () => {
    const supabase = makeSupabase({
      transcriptions: [{ verse_flags: [
        { ref: 'Psalm 23:1', status: 'not_found' },
        { ref: 'not a reference', status: 'found' },
      ], created_at: '2026-05-12T09:00:00Z' }],
    });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    expect(candidates).toHaveLength(0);
  });

  it('renders each source format (highlight/thread/focus range) to display refs', async () => {
    const supabase = makeSupabase({
      highlights: [{ verse_id: 'jhn.1.1', created_at: '2026-05-12T09:00:00Z' }],
      threads: [{ passage_ref: 'jhn.10', created_at: '2026-05-27T09:00:00Z' }],
      focusItems: [{ book: 'eph', chapter: 2, verse_start: 8, verse_end: 9, created_at: '2026-05-12T09:00:00Z' }],
    });
    const { allowedVerseRefs } = await buildReflectionCandidates(deps(supabase));
    expect(allowedVerseRefs.has('John 1:1')).toBe(true);
    expect(allowedVerseRefs.has('John 10')).toBe(true);
    expect(allowedVerseRefs.has('Eph 2:8-9')).toBe(true);
  });

  // ── Precedence deletion-test (Tier 1), BOTH directions ──
  it('keeps TRAIL provenance when a ref is also a semantic neighbour', async () => {
    const supabase = makeSupabase({
      highlights: [{ verse_id: 'psa.27.14', created_at: '2026-05-12T09:00:00Z' }],
      matches: [{ source_id: 'psa.27.14' }],
    });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    const hit = candidates.filter((c) => c.ref === 'Ps 27:14');
    expect(hit).toHaveLength(1);              // deduped
    expect(hit[0].provenance).toBe('highlighted'); // trail wins
  });
  it('falls back to semantic provenance once the trail source is removed', async () => {
    const supabase = makeSupabase({ matches: [{ source_id: 'psa.27.14' }] });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    expect(candidates.find((c) => c.ref === 'Ps 27:14')?.provenance).toBe('semantic');
  });

  it('caps the pool at CANDIDATE_POOL_MAX and never evicts trail for semantic', async () => {
    const highlights = Array.from({ length: 10 }, (_, i) => ({ verse_id: `psa.1.${i + 1}`, created_at: '2026-05-12T09:00:00Z' }));
    const matches = Array.from({ length: 20 }, (_, i) => ({ source_id: `psa.2.${i + 1}` }));
    const supabase = makeSupabase({ highlights, matches });
    const { candidates } = await buildReflectionCandidates(deps(supabase));
    expect(candidates).toHaveLength(12);
    expect(candidates.filter((c) => c.provenance === 'highlighted')).toHaveLength(10); // all trail kept
    expect(candidates.filter((c) => c.provenance === 'semantic')).toHaveLength(2);     // only the remainder
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/reflection-candidates.test.ts`
Expected: FAIL — `Cannot find module './reflection-candidates'`.

- [ ] **Step 7: Implement the candidate builder**

Create `supabase/functions/lamplight-generate/reflection-candidates.ts`:

```typescript
// Builds the month's verse candidate pool (§5). Five provenances, all
// month-scoped by created_at; the month's-own-trail outranks semantic
// neighbours (decision 14). Output is DISPLAY refs (the allowlist contract) —
// the OSIS↔display conversion is the load-bearing internal detail.

import type { MonthNote, ReflectionCandidate } from './prompts/monthly-reflection.ts';
import { osisRefToDisplay } from '../_shared/bible-books.ts';
import { parseRefToIds } from '../_shared/verse-verify.ts';
import { CANDIDATE_POOL_MAX } from '../_shared/reflection-constants.ts';

// Permissive structural view of the Supabase client: the real client satisfies
// it and hand-rolled test fakes fit without an `as unknown` cast.
// deno-lint-ignore no-explicit-any
export type EdgeSupabase = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };

export interface BuildReflectionCandidatesDeps {
  supabase: EdgeSupabase;
  userId: string;
  notes: MonthNote[];
  monthStartUtc: string; // ISO instant, inclusive
  monthEndUtc: string;   // ISO instant, exclusive
  embed: (text: string) => Promise<number[]>;
  toLocalDay: (ts: string) => string;
}

export interface ReflectionCandidatesResult {
  candidates: ReflectionCandidate[];
  allowedVerseRefs: Set<string>;
  allowedNoteDays: Set<string>;
}

interface VerseFlag { ref: string; status: 'found' | 'not_found'; canonicalText?: string }
interface TranscriptionRow { verse_flags: VerseFlag[] | null; created_at: string }
interface HighlightRow { verse_id: string; created_at: string }
interface ThreadRow { passage_ref: string; created_at: string }
interface FocusItemRow { book: string; chapter: number; verse_start: number; verse_end: number | null; created_at: string }
interface EmbeddingMatchRow { source_id: string }

function focusItemToDisplay(row: FocusItemRow): string | null {
  const base = osisRefToDisplay(`${row.book}.${row.chapter}.${row.verse_start}`);
  if (base === null) return null;
  return row.verse_end !== null && row.verse_end > row.verse_start ? `${base}-${row.verse_end}` : base;
}

export async function buildReflectionCandidates(
  deps: BuildReflectionCandidatesDeps,
): Promise<ReflectionCandidatesResult> {
  const { supabase, userId, notes, monthStartUtc, monthEndUtc, embed, toLocalDay } = deps;
  const trail: ReflectionCandidate[] = [];

  // flagged — note_transcriptions.verse_flags (display refs → normalize to short form)
  const trans: { data: TranscriptionRow[] | null; error: { message: string } | null } =
    await supabase.from('note_transcriptions').select('verse_flags, created_at')
      .eq('user_id', userId).gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (trans.error) throw new Error(`reflection-candidates flagged: ${trans.error.message}`);
  for (const row of trans.data ?? []) {
    const day = toLocalDay(row.created_at);
    for (const flag of row.verse_flags ?? []) {
      if (flag.status !== 'found') continue;
      const osis = parseRefToIds(flag.ref)?.[0];
      const ref = osis ? osisRefToDisplay(osis) : null;
      if (ref) trail.push({ ref, provenance: 'flagged', note_day: day });
    }
  }

  // highlighted — bible_highlights.verse_id (OSIS verse id)
  const hl: { data: HighlightRow[] | null; error: { message: string } | null } =
    await supabase.from('bible_highlights').select('verse_id, created_at')
      .eq('user_id', userId).gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (hl.error) throw new Error(`reflection-candidates highlighted: ${hl.error.message}`);
  for (const row of hl.data ?? []) {
    const ref = osisRefToDisplay(row.verse_id);
    if (ref) trail.push({ ref, provenance: 'highlighted', note_day: toLocalDay(row.created_at) });
  }

  // studied — lamplight_chat_threads.passage_ref (OSIS chapter-level)
  const th: { data: ThreadRow[] | null; error: { message: string } | null } =
    await supabase.from('lamplight_chat_threads').select('passage_ref, created_at')
      .eq('user_id', userId).gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (th.error) throw new Error(`reflection-candidates studied: ${th.error.message}`);
  for (const row of th.data ?? []) {
    const ref = osisRefToDisplay(row.passage_ref);
    if (ref) trail.push({ ref, provenance: 'studied', note_day: toLocalDay(row.created_at) });
  }

  // focus_listed — scripture_focus_list_items joined to the user's lists (items have no user_id)
  const fi: { data: FocusItemRow[] | null; error: { message: string } | null } =
    await supabase.from('scripture_focus_list_items')
      .select('book, chapter, verse_start, verse_end, created_at, scripture_focus_lists!inner(user_id)')
      .eq('scripture_focus_lists.user_id', userId)
      .gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (fi.error) throw new Error(`reflection-candidates focus: ${fi.error.message}`);
  for (const row of fi.data ?? []) {
    const ref = focusItemToDisplay(row);
    if (ref) trail.push({ ref, provenance: 'focus_listed', note_day: toLocalDay(row.created_at) });
  }

  // semantic — match_bible_embeddings neighbours of the month's note text
  const semantic: ReflectionCandidate[] = [];
  const noteText = notes.map((n) => n.text).join('\n\n').trim();
  if (noteText.length > 0) {
    const vector = await embed(noteText);
    const res = await supabase.rpc('match_bible_embeddings', { p_query_vector: vector, p_limit: CANDIDATE_POOL_MAX });
    if (res.error) throw new Error(`reflection-candidates semantic: ${res.error.message}`);
    for (const row of (res.data as EmbeddingMatchRow[] | null) ?? []) {
      const ref = osisRefToDisplay(row.source_id);
      if (ref) semantic.push({ ref, provenance: 'semantic' });
    }
  }

  // Dedupe by display ref, trail before semantic so trail provenance wins and
  // trail refs survive the cap (decision 14). Then cap at the pool max.
  const seen = new Set<string>();
  const candidates: ReflectionCandidate[] = [];
  for (const cand of [...trail, ...semantic]) {
    if (seen.has(cand.ref)) continue;
    seen.add(cand.ref);
    candidates.push(cand);
    if (candidates.length >= CANDIDATE_POOL_MAX) break;
  }

  return {
    candidates,
    allowedVerseRefs: new Set(candidates.map((c) => c.ref)),
    allowedNoteDays: new Set(notes.map((n) => n.day)),
  };
}
```

- [ ] **Step 8: Run it to confirm it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/reflection-candidates.test.ts`
Expected: PASS (all groups; the two precedence cases + the cap case are the Tier-1 deletion-tests).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/bible-books.ts supabase/functions/_shared/bible-books.test.ts supabase/functions/lamplight-generate/reflection-candidates.ts supabase/functions/lamplight-generate/reflection-candidates.test.ts
git commit -m "feat(waymarks): OSIS→display book map + 5-provenance candidate pool with trail>semantic precedence"
```

---

## Task 5: The register judge (Layer 3, §6.3)

**Files:**
- Create: `supabase/functions/lamplight-generate/reflection-judge.ts`
- Test: `supabase/functions/lamplight-generate/reflection-judge.test.ts`

**Interfaces:**
- Consumes: `LLMAdapter`, `ToolSchema` (`_shared/anthropic.ts`); `ReflectionArtifact` (Task 2); `MonthNote` (Task 2).
- Produces (relied on by the pipeline, Task 6): `judgeReflectionRegister(input: ReflectionJudgeInput): Promise<ReflectionJudgeResult>` where `ReflectionJudgeInput = { llm: LLMAdapter; artifact: ReflectionArtifact; notes: MonthNote[]; periodLabel: string }` and `ReflectionJudgeResult = { pass: boolean; reasons: string[] }`.

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING D):**
- `LLMAdapter.generate<T>(input: GenerateInput): Promise<GenerateOutput<T>>` where `GenerateInput = { model: LLMModel; system: string; messages: Array<{ role:'user'|'assistant'; content: string|ContentBlock[] }>; tool: ToolSchema; maxTokens?: number }`, `GenerateOutput<T> = { parsed: T; modelUsed; promptTokens; completionTokens }`. `LLMModel = 'sonnet'|'haiku'|'opus'`.
- The judge is ONE small-model (`'haiku'`) tool-call emitting `{ pass, reasons }` — mirror how daily uses `llm.generate` directly (no `generateWithRetry`). §5 rules travel verbatim into the judge `system`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-generate/reflection-judge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { judgeReflectionRegister } from './reflection-judge';
import type { LLMAdapter, GenerateInput, GenerateOutput } from '../_shared/anthropic';
import type { ReflectionArtifact } from '../_shared/artifacts';

function makeAdapter(verdict: { pass: boolean; reasons: string[] }): { llm: LLMAdapter; calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  const llm: LLMAdapter = {
    async generate<T>(input: GenerateInput): Promise<GenerateOutput<T>> {
      calls.push(input);
      return { parsed: verdict as unknown as T, modelUsed: 'claude-haiku-4-5-20251001', promptTokens: 5, completionTokens: 10 };
    },
    // deno-lint-ignore no-explicit-any
    generateStream: (async () => { throw new Error('unused'); }) as any,
  };
  return { llm, calls };
}

const ARTIFACT: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter: 'You began May circling a decision. On the twelfth the circling stopped. The stone stands; the details can rest.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};
const NOTES = [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }];

describe('judgeReflectionRegister', () => {
  it('calls the small model with a tool and returns the verdict', async () => {
    const { llm, calls } = makeAdapter({ pass: true, reasons: [] });
    const r = await judgeReflectionRegister({ llm, artifact: ARTIFACT, notes: NOTES, periodLabel: 'May 2026' });
    expect(r).toEqual({ pass: true, reasons: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('haiku');
    expect(calls[0].tool.name).toBe('judge_reflection_register');
    expect(calls[0].system).toContain('witnessed, not reopened');
  });

  it('passes through a failing verdict with reasons', async () => {
    const { llm } = makeAdapter({ pass: false, reasons: ['title reads like a sermon header'] });
    const r = await judgeReflectionRegister({ llm, artifact: ARTIFACT, notes: NOTES, periodLabel: 'May 2026' });
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain('title reads like a sermon header');
  });

  it('coerces a missing reasons array to empty', async () => {
    const { llm } = makeAdapter({ pass: true, reasons: undefined as unknown as string[] });
    const r = await judgeReflectionRegister({ llm, artifact: ARTIFACT, notes: NOTES, periodLabel: 'May 2026' });
    expect(r.reasons).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/reflection-judge.test.ts`
Expected: FAIL — `Cannot find module './reflection-judge'`.

- [ ] **Step 3: Implement the judge**

Create `supabase/functions/lamplight-generate/reflection-judge.ts`:

```typescript
// Layer-3 register judge (§6.3): one small-model tool-call that grades a
// candidate reflection against the §5 voice rules the deterministic validators
// can't see (title register, battle-handling given the ACTUAL notes,
// scorecard-feel, exemplar fidelity). Returns { pass, reasons }; the pipeline
// (Task 6) runs it only after the deterministic gates pass.

import type { LLMAdapter, ToolSchema } from '../_shared/anthropic.ts';
import type { ReflectionArtifact } from '../_shared/artifacts.ts';
import type { MonthNote } from './prompts/monthly-reflection.ts';

export interface ReflectionJudgeInput {
  llm: LLMAdapter;
  artifact: ReflectionArtifact;
  notes: MonthNote[];
  periodLabel: string;
}

export interface ReflectionJudgeResult {
  pass: boolean;
  reasons: string[];
}

const JUDGE_SYSTEM = `You are the register guardian for Waymarks — monthly reflections that read a person's month back to them as a letter. You are given the reflection AND the month's raw notes. Judge ONLY whether it holds the register; you do not rewrite.

Fail it if ANY of these are true:
- The title is a devotional/sermon header rather than something underline-worthy a person would want to keep.
- A hard season is REOPENED rather than witnessed: it recounts the painful detail, quotes the darkest lines back, or re-narrates the wound instead of naming that the season happened and was written through.
- The letter reads like a scorecard: it tallies or celebrates how often the person showed up, counts entries/days, or uses streak language.
- The letter drifts from the notes: it invents events the notes don't support, or feels generic enough to belong to any month.
- It abandons the graceful floor for a sparse month (shames the gaps, or manufactures an arc the little writing can't hold).

Pass it if the reflection is faithful to the notes, witnesses without reopening, names without counting, and sounds like a hand on the shoulder. Report concrete reasons for any failure.`;

const JUDGE_TOOL: ToolSchema = {
  name: 'judge_reflection_register',
  description: 'Return whether the reflection holds the Waymarks register, with concrete reasons for any failure.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['pass', 'reasons'],
    properties: {
      pass: { type: 'boolean', description: 'true iff the reflection holds the register.' },
      reasons: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete reasons for a failure; empty when pass is true.',
      },
    },
  },
};

function buildJudgeMessages(
  artifact: ReflectionArtifact,
  notes: MonthNote[],
  periodLabel: string,
): Array<{ role: 'user'; content: string }> {
  const notesBlock = notes.map((n) => `[${n.day}] ${n.text}`).join('\n');
  return [{
    role: 'user',
    content:
      `Month: ${periodLabel}.\n\n` +
      `The reader's raw notes:\n${notesBlock}\n\n` +
      `The reflection to judge:\n${JSON.stringify(artifact, null, 2)}\n\n` +
      `Judge it with the judge_reflection_register tool.`,
  }];
}

export async function judgeReflectionRegister(input: ReflectionJudgeInput): Promise<ReflectionJudgeResult> {
  const { parsed } = await input.llm.generate<ReflectionJudgeResult>({
    model: 'haiku',
    system: JUDGE_SYSTEM,
    messages: buildJudgeMessages(input.artifact, input.notes, input.periodLabel),
    tool: JUDGE_TOOL,
    maxTokens: 512,
  });
  return { pass: parsed.pass === true, reasons: parsed.reasons ?? [] };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/reflection-judge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-generate/reflection-judge.ts supabase/functions/lamplight-generate/reflection-judge.test.ts
git commit -m "feat(waymarks): Layer-3 register judge (haiku) grading against §5 voice rules"
```

---

## Task 6: The monthly reflection pipeline (upsert + off-list repair + judge sequencing, §6.4–6.5)

**Files:**
- Create: `supabase/functions/lamplight-generate/monthly-reflection-pipeline.ts`
- Test: `supabase/functions/lamplight-generate/monthly-reflection-pipeline.test.ts`

**Interfaces:**
- Consumes: `LLMAdapter`, `ToolSchema` (`_shared/anthropic.ts`); `generateWithRetry`, `RetryOutcome` (`_shared/generate-with-retry.ts`); `ReflectionArtifact` (`_shared/artifacts.ts`, Task 2); `MONTHLY_REFLECTION_PROMPT`, `MONTHLY_PROMPT_VERSION`, `MonthNote`, `MonthlyReflectionContext` (`./prompts/monthly-reflection.ts`, Task 2); the 6 validators + `ReflectionViolation` (`./reflection-validators.ts`, Task 3); `judgeReflectionRegister` (`./reflection-judge.ts`, Task 5); `EdgeSupabase` (`./reflection-candidates.ts`, Task 4).
- Produces (relied on by the dispatch, Task 7): `runMonthlyReflectionPipeline(deps)` → `Promise<MonthlyReflectionPipelineResult>`; plus `repairOffListVerses`, `makeMonthlyReflectionValidate`, `formatStricterSuffix` (exported for the test). `MonthlyReflectionPipelineResult` is the `{ ok, ... , usage }` union Task 7's `runGeneration` reads `.usage` from.

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING D + part 13 §TASK 6 decision):**
- `generateWithRetry<TParsed,TViolations>(cfg)` where `cfg = { llm, model, maxTokens, artifactSystem, systemTokens?, messages, tool, validate:(parsed)=>Promise<{ok;violations}>, formatStricter:(violations)=>string, maxAttempts?=2 }` → `RetryOutcome = { ok:true; parsed; modelUsed; promptTokens; completionTokens; attempts } | { ok:false; violations; modelUsed; attempts }`. `maxAttempts` default 2 = ONE stricter retry (the `refining` pass). Flat token fields, no nested `usage`.
- Mirror `daily-devotion-pipeline.ts` precheck/generate/postGeneration split, but the write is an **UPSERT not an insert**, and the idempotency key is `(user_id, type='reflection_recap', period_key)`. **NO `lamplight_usage` write in the pipeline** — Task 7's `runGeneration` records usage from `result.usage`.
- **DESIGN DECISION 2 (verbatim):** the upsert row OMITS `saved_to_notes`, carries NO `updated_at`, and NEVER touches `lamplight_reflection_state`. Those columns are owned by the client (Task 17), not the generator.
- Off-list verse handling is §6.5 abstention: a marker citing a verse outside the candidate allowlist has its `verse` set to `null` (not dropped) — repaired in the validate fn AND again in postGeneration before the upsert.
- `MonthlyReflectionContext` (Task 2) carries `{ periodKey, periodLabel, monthStart, monthEnd, notes: MonthNote[], candidates: ReflectionCandidate[], allowedVerseRefs: Set<string>, allowedNoteDays: Set<string> }`. `ReflectionArtifact` (Task 2) = `{ title: string; letter: string; markers: Marker[] }`, `Marker = { date: string; verse: string | null; phrase: string }`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-generate/monthly-reflection-pipeline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runMonthlyReflectionPipeline, repairOffListVerses } from './monthly-reflection-pipeline';
import type { LLMAdapter, GenerateInput, GenerateOutput } from '../_shared/anthropic';
import type { ReflectionArtifact } from '../_shared/artifacts';
import type { MonthlyReflectionContext } from './prompts/monthly-reflection';
import type { EdgeSupabase } from './reflection-candidates';

// Returns each response in sequence; the last is repeated (so a validator-failing
// artifact is re-served on the stricter retry). generate() serves BOTH the sonnet
// artifact call and the haiku judge call, so a happy path passes [artifact, verdict].
function makeAdapter(responses: unknown[]): { llm: LLMAdapter; calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  let i = 0;
  const llm: LLMAdapter = {
    async generate<U>(input: GenerateInput): Promise<GenerateOutput<U>> {
      calls.push(input);
      const parsed = responses[Math.min(i, responses.length - 1)] as unknown as U;
      i++;
      return { parsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 10, completionTokens: 20 };
    },
    generateStream: (async () => { throw new Error('unused'); }) as unknown as LLMAdapter['generateStream'],
  };
  return { llm, calls };
}

function makeSupabaseMock(opts: {
  existing?: { id: string; body: unknown; model_used: string; prompt_version: string } | null;
  upsertedId?: string;
  upsertError?: { message: string } | null;
} = {}) {
  const existing = opts.existing ?? null;
  const upsertedId = opts.upsertedId ?? 'artifact-1';
  const upsertError = opts.upsertError ?? null;
  const upserts: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      if (table !== 'lamplight_artifacts') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({
            async maybeSingle() { return existing ? { data: existing, error: null } : { data: null, error: null }; },
            async single() { return existing ? { data: existing, error: null } : { data: null, error: { message: 'no row' } }; },
          }) }) }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return { select: () => ({ async single() {
            return upsertError ? { data: null, error: upsertError } : { data: { id: upsertedId }, error: null };
          } }) };
        },
      };
    },
  };
  return { supabase: supabase as unknown as EdgeSupabase, upserts };
}

// Exemplar-grade (§2.2): a 60+ word letter, one in-month marker citing an allowed verse.
// Must clear all 6 validators so the happy path reaches the judge.
const ARTIFACT: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling one decision, turning it over on the drive to work and again before sleep. ' +
    'On the twelfth something in you set it down — not because the answer arrived, but because the circling ' +
    'had done its work and you were ready to stop. The rest of the month you wrote less about it. The stone ' +
    'stands where you left it; the details can rest now.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function makeCtx(over: Partial<MonthlyReflectionContext> = {}): MonthlyReflectionContext {
  return {
    periodKey: '2026-05',
    periodLabel: 'May 2026',
    monthStart: '2026-05-01',
    monthEnd: '2026-05-31',
    notes: [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }],
    candidates: [],
    allowedVerseRefs: new Set(['Ps 27:14']),
    allowedNoteDays: new Set(['2026-05-12']),
    ...over,
  };
}

describe('runMonthlyReflectionPipeline', () => {
  it('generates, judges, then UPSERTs — omitting saved_to_notes and updated_at (DESIGN DECISION 2)', async () => {
    const { llm, calls } = makeAdapter([ARTIFACT, { pass: true, reasons: [] }]);
    const { supabase, upserts } = makeSupabaseMock({ upsertedId: 'artifact-99' });
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: true, cached: false, artifactId: 'artifact-99', usage: { status: 'ok', model_used: 'claude-sonnet-4-6', prompt_tokens: 10, completion_tokens: 20 } });
    // sonnet artifact call, then haiku judge call
    expect(calls[0].model).toBe('sonnet');
    expect(calls[1].model).toBe('haiku');
    expect(upserts).toHaveLength(1);
    const row = upserts[0];
    expect(row.type).toBe('reflection_recap');
    expect(row.period_key).toBe('2026-05');
    expect(row.prompt_version).toBe('monthly-reflection-v1');
    expect(row.source_note_ids).toEqual(['n1']);
    expect(row.source_verses).toEqual(['Ps 27:14']);
    // the two forbidden columns
    expect('saved_to_notes' in row).toBe(false);
    expect(row.updated_at).toBeUndefined();
  });

  it('returns the cached artifact without generating or upserting', async () => {
    const { llm, calls } = makeAdapter([ARTIFACT]);
    const { supabase, upserts } = makeSupabaseMock({ existing: { id: 'existing-1', body: {}, model_used: 'm', prompt_version: 'monthly-reflection-v1' } });
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: true, cached: true, artifactId: 'existing-1', usage: null });
    expect(calls).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it('returns no_notes when the context is null (empty month)', async () => {
    const { llm } = makeAdapter([ARTIFACT]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: null, userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: false, reason: 'no_notes', usage: null });
    expect(upserts).toHaveLength(0);
  });

  it('repairs an off-allowlist verse to null (§6.5) and excludes it from source_verses', async () => {
    const offList: ReflectionArtifact = { ...ARTIFACT, markers: [{ date: '2026-05-12', verse: 'Ps 23:1', phrase: 'the day the circling stopped' }] };
    const { llm } = makeAdapter([offList, { pass: true, reasons: [] }]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result.ok).toBe(true);
    const body = upserts[0].body as ReflectionArtifact;
    expect(body.markers[0].verse).toBeNull();
    expect(upserts[0].source_verses).toEqual([]);
  });

  it('returns validators_failed with an error usage row and does NOT upsert', async () => {
    const tooShort: ReflectionArtifact = { ...ARTIFACT, letter: 'Too short to pass the word floor.' };
    const { llm } = makeAdapter([tooShort]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: false, reason: 'validators_failed', usage: { status: 'error', model_used: 'claude-sonnet-4-6', error_code: 'validators_failed' } });
    expect(upserts).toHaveLength(0);
  });

  it('repairOffListVerses nulls out only the verses outside the allowlist', () => {
    const repaired = repairOffListVerses(
      { ...ARTIFACT, markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'a' }, { date: '2026-05-13', verse: 'Ps 23:1', phrase: 'b' }] },
      new Set(['Ps 27:14']),
    );
    expect(repaired.markers[0].verse).toBe('Ps 27:14');
    expect(repaired.markers[1].verse).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/monthly-reflection-pipeline.test.ts`
Expected: FAIL — `Cannot find module './monthly-reflection-pipeline'`.

- [ ] **Step 3: Implement the pipeline**

Create `supabase/functions/lamplight-generate/monthly-reflection-pipeline.ts`:

```typescript
// Monthly reflection pipeline (§6.4–6.5): precheck → generateWithRetry → postGeneration,
// mirroring daily-devotion-pipeline.ts but with two differences that are DESIGN DECISIONS:
//   (1) the write is an UPSERT keyed on (user_id, type, period_key) — the scheduled sweep,
//       on-demand generation, and backfill can all race to produce the same stone;
//   (2) the upsert row OMITS saved_to_notes and updated_at and never touches
//       lamplight_reflection_state — those are client-owned (Task 17).
// Off-list verses are repaired to null (§6.5 abstention), not dropped, in BOTH the
// validate fn and postGeneration. Usage is NOT written here — Task 7's runGeneration does.

import type { LLMAdapter, ToolSchema } from '../_shared/anthropic.ts';
import type { ReflectionArtifact } from '../_shared/artifacts.ts';
import { generateWithRetry, type RetryOutcome } from '../_shared/generate-with-retry.ts';
import {
  MONTHLY_REFLECTION_PROMPT,
  MONTHLY_PROMPT_VERSION,
  type MonthlyReflectionContext,
} from './prompts/monthly-reflection.ts';
import {
  validateShapeAndBounds,
  validateScriptureAllowlist,
  validateAnchoring,
  validateNoScorecard,
  validateWitnessedNotReopened,
  validateProvenance,
  type ReflectionViolation,
} from './reflection-validators.ts';
import { judgeReflectionRegister } from './reflection-judge.ts';
import type { EdgeSupabase } from './reflection-candidates.ts';

export type ReflectionPipelineViolation = ReflectionViolation | { rule: 'register_judge'; detail: string };

// Local usage shape recorded by Task 7's runGeneration. Field names match the daily
// pipeline's usage object (status / model_used / prompt_tokens / completion_tokens / error_code).
export interface ReflectionUsageRecord {
  status: 'ok' | 'error';
  model_used?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  error_code?: string;
}

export type MonthlyReflectionPipelineResult =
  | { ok: true; cached: boolean; artifactId: string; usage: ReflectionUsageRecord | null }
  | { ok: false; reason: 'no_notes' | 'validators_failed'; usage: ReflectionUsageRecord | null };

export interface RunMonthlyReflectionPipelineDeps {
  llm: LLMAdapter;
  supabase: EdgeSupabase;
  ctx: MonthlyReflectionContext | null;
  userId: string;
  periodKey: string;
}

// §6.5 abstention: a marker whose verse is not in the candidate allowlist keeps its
// phrase/date but loses the citation (verse → null). Pure; called twice.
export function repairOffListVerses(artifact: ReflectionArtifact, allowedVerseRefs: Set<string>): ReflectionArtifact {
  return {
    ...artifact,
    markers: artifact.markers.map((m) =>
      m.verse !== null && !allowedVerseRefs.has(m.verse) ? { ...m, verse: null } : m,
    ),
  };
}

// The generateWithRetry validate fn: repair off-list verses, run the 6 deterministic
// validators, and ONLY if they all pass consult the Layer-3 register judge.
export function makeMonthlyReflectionValidate(ctx: MonthlyReflectionContext, llm: LLMAdapter) {
  return async (raw: ReflectionArtifact): Promise<{ ok: boolean; violations: ReflectionPipelineViolation[] }> => {
    const artifact = repairOffListVerses(raw, ctx.allowedVerseRefs);
    const monthNoteIds = ctx.notes.map((n) => n.id);
    const violations: ReflectionPipelineViolation[] = [
      ...validateShapeAndBounds(artifact),
      ...validateScriptureAllowlist(artifact, { allowedVerseRefs: ctx.allowedVerseRefs }),
      ...validateAnchoring(artifact, { monthStart: ctx.monthStart, monthEnd: ctx.monthEnd, allowedNoteDays: ctx.allowedNoteDays }),
      ...validateNoScorecard(artifact.letter),
      ...validateWitnessedNotReopened(artifact, { notes: ctx.notes }),
      ...validateProvenance({ sourceNoteIds: monthNoteIds, monthNoteIds }),
    ];
    if (violations.length > 0) return { ok: false, violations };

    const verdict = await judgeReflectionRegister({ llm, artifact, notes: ctx.notes, periodLabel: ctx.periodLabel });
    if (!verdict.pass) {
      return { ok: false, violations: verdict.reasons.map((r) => ({ rule: 'register_judge' as const, detail: r })) };
    }
    return { ok: true, violations: [] };
  };
}

export function formatStricterSuffix(violations: ReflectionPipelineViolation[]): string {
  const bullets = violations.map((v) => `- ${v.rule}: ${v.detail}`).join('\n');
  return (
    `The previous attempt broke these rules:\n${bullets}\n\n` +
    `Keep the voice: witnessed not reopened; no counts; verse-level citations only in markers.`
  );
}

// Idempotency + graceful-floor gate. Returns a terminal result (cached / no_notes) OR
// { notCached } to proceed to generation.
async function reflectionPreCheck(args: {
  supabase: EdgeSupabase;
  userId: string;
  periodKey: string;
  ctx: MonthlyReflectionContext | null;
}): Promise<{ notCached: true; promptVersion: string } | MonthlyReflectionPipelineResult> {
  const { supabase, userId, periodKey, ctx } = args;
  const { data: existing } = await supabase
    .from('lamplight_artifacts')
    .select('id, body, model_used, prompt_version')
    .eq('user_id', userId)
    .eq('type', 'reflection_recap')
    .eq('period_key', periodKey)
    .maybeSingle();
  if (existing) return { ok: true, cached: true, artifactId: existing.id, usage: null };
  if (!ctx || ctx.notes.length === 0) return { ok: false, reason: 'no_notes', usage: null };
  return { notCached: true, promptVersion: MONTHLY_PROMPT_VERSION };
}

async function reflectionPostGeneration(args: {
  supabase: EdgeSupabase;
  userId: string;
  periodKey: string;
  ctx: MonthlyReflectionContext;
  outcome: RetryOutcome<ReflectionArtifact, ReflectionPipelineViolation[]>;
}): Promise<MonthlyReflectionPipelineResult> {
  const { supabase, userId, periodKey, ctx, outcome } = args;
  if (!outcome.ok) {
    return { ok: false, reason: 'validators_failed', usage: { status: 'error', model_used: outcome.modelUsed, error_code: 'validators_failed' } };
  }
  const parsed = repairOffListVerses(outcome.parsed, ctx.allowedVerseRefs);
  const sourceVerses = parsed.markers.map((m) => m.verse).filter((v): v is string => v !== null);

  const { data, error } = await supabase
    .from('lamplight_artifacts')
    .upsert(
      {
        user_id: userId,
        type: 'reflection_recap',
        period_key: periodKey,
        title: parsed.title,
        body: parsed,
        source_note_ids: ctx.notes.map((n) => n.id),
        source_verses: sourceVerses,
        model_used: outcome.modelUsed,
        prompt_version: MONTHLY_PROMPT_VERSION,
      },
      { onConflict: 'user_id,type,period_key' },
    )
    .select('id')
    .single();

  if (error) {
    // Lost the race to a concurrent worker — the row exists; re-select and report cached.
    const { data: existing } = await supabase
      .from('lamplight_artifacts')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'reflection_recap')
      .eq('period_key', periodKey)
      .single();
    return { ok: true, cached: true, artifactId: existing?.id ?? '', usage: null };
  }

  return {
    ok: true,
    cached: false,
    artifactId: data?.id ?? '',
    usage: { status: 'ok', model_used: outcome.modelUsed, prompt_tokens: outcome.promptTokens, completion_tokens: outcome.completionTokens },
  };
}

export async function runMonthlyReflectionPipeline(deps: RunMonthlyReflectionPipelineDeps): Promise<MonthlyReflectionPipelineResult> {
  const { llm, supabase, ctx, userId, periodKey } = deps;

  const pre = await reflectionPreCheck({ supabase, userId, periodKey, ctx });
  if (!('notCached' in pre)) return pre;
  if (!ctx) return { ok: false, reason: 'no_notes', usage: null };

  const outcome = await generateWithRetry<ReflectionArtifact, ReflectionPipelineViolation[]>({
    llm,
    model: 'sonnet',
    maxTokens: 2048,
    artifactSystem: MONTHLY_REFLECTION_PROMPT.system,
    systemTokens: { period_label: ctx.periodLabel },
    messages: MONTHLY_REFLECTION_PROMPT.buildMessages(ctx),
    tool: MONTHLY_REFLECTION_PROMPT.tool as unknown as ToolSchema,
    validate: makeMonthlyReflectionValidate(ctx, llm),
    formatStricter: formatStricterSuffix,
  });

  return reflectionPostGeneration({ supabase, userId, periodKey, ctx, outcome });
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/monthly-reflection-pipeline.test.ts`
Expected: PASS (6 tests). The upsert-shape assertions (`saved_to_notes` absent, `updated_at` undefined) are the DESIGN-DECISION-2 deletion-tests; the off-list→null case is the §6.5 deletion-test.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-generate/monthly-reflection-pipeline.ts supabase/functions/lamplight-generate/monthly-reflection-pipeline.test.ts
git commit -m "feat(waymarks): monthly reflection pipeline — upsert idempotency, off-list verse repair, judge sequencing"
```

---

## Task 7: Dispatch + Plus entitlement + the monthly-reflection context builder (§7, §12)

**Files:**
- Edit: `supabase/functions/_shared/entitlement.ts` (add `hasReflectionAccess`)
- Test: `supabase/functions/_shared/entitlement.test.ts` (add a `hasReflectionAccess` block)
- Create: `supabase/functions/lamplight-generate/monthly-reflection-context.ts`
- Test: `supabase/functions/lamplight-generate/monthly-reflection-context.test.ts`
- Edit: `supabase/functions/lamplight-generate/index.ts` (add the `monthly_reflection` dispatch branch)

**Interfaces:**
- Consumes: `LamplightTier` (`_shared/entitlement.ts`); `runMonthlyReflectionPipeline` (Task 6); `buildReflectionCandidates`, `ReflectionCandidate`, `EdgeSupabase` (`./reflection-candidates.ts`, Task 4); `MonthNote`, `MonthlyReflectionContext` (`./prompts/monthly-reflection.ts`, Task 2); `runGeneration`, `lifecycleDeps`, `jsonResp` (existing `index.ts` internals).
- Produces: `hasReflectionAccess({tier,promoActive})`; `isValidPeriodKey`, `localMonthBoundsUtc`, `makeToLocalDay`, `buildMonthlyReflectionContext` (relied on by `index.ts`, and `buildMonthlyReflectionContext` returns the `ctx` Task 6 consumes).

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING D + part 13 §TASK 7 decision):**
- `_shared/entitlement.ts` today (11 lines): `export type LamplightTier = 'plus' | 'lite' | 'none';` and `hasChatAccess({tier,promoActive})` → `promoActive ? true : tier === 'plus'`. `hasReflectionAccess` is identical in shape (DESIGN DECISION 3 — reflections are Plus-only, promo overrides).
- **No `getPromoConfig` helper exists** — promo is an inline `app_config` read (`promoRow?.value === true`), batched with entitlements via `Promise.all` (mirror `lamplight-chat/index.ts` ~L90–93,120).
- `index.ts` already gates ALL kinds on `lamplight_settings.enabled` (opt-in 403). The Plus gate is ADDED ON TOP inside the new branch; the opt-in gate stays. Daily branch builds ctx INSIDE the `runGeneration` callback (part 11 §GROUNDING D L269–274) — mirror that placement.
- `index.ts` is NOT vitest-importable (Deno `serve`), so the testable logic (`isValidPeriodKey` / bounds / context assembly) lives in the NEW `monthly-reflection-context.ts`; the branch wiring is real code verified by build + those unit tests.
- **NOTES-TABLE reconciliation (the ONE gap in this plan):** `loadMonthNotes` reads `notes(id, user_id, content, created_at)` and `extractNoteText(content)` copes with a plain string OR a rich-text JSON doc. **If a daily note-loader already exists (e.g. inside `buildDailyDevotionContext`), match its table name, column names, and text extraction verbatim** — `loadMonthNotes` is kept injectable as the single swap point so this reconciliation touches nothing else.
- `buildReflectionCandidates(deps)` and the `ReflectionCandidate.verseRef` field are Task 4's contract (part 11 §GROUNDING A) — pass the deps object Task 4 defined and read the verse-ref field Task 4 exposes; do not invent a new shape.

- [ ] **Step 1: Write the failing entitlement test**

Add to `supabase/functions/_shared/entitlement.test.ts` (create the file if absent; keep any existing `hasChatAccess` block):

```typescript
import { describe, it, expect } from 'vitest';
import { hasReflectionAccess } from './entitlement';

describe('hasReflectionAccess', () => {
  it('grants access to anyone during a promo', () => {
    expect(hasReflectionAccess({ tier: 'none', promoActive: true })).toBe(true);
    expect(hasReflectionAccess({ tier: 'lite', promoActive: true })).toBe(true);
  });
  it('grants access to Plus outside a promo', () => {
    expect(hasReflectionAccess({ tier: 'plus', promoActive: false })).toBe(true);
  });
  it('denies Lite and None outside a promo', () => {
    expect(hasReflectionAccess({ tier: 'lite', promoActive: false })).toBe(false);
    expect(hasReflectionAccess({ tier: 'none', promoActive: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `hasReflectionAccess`**

Append to `supabase/functions/_shared/entitlement.ts`:

```typescript
// Reflections are a Plus feature (DESIGN DECISION 3); an active promo opens them to all,
// exactly like hasChatAccess.
export function hasReflectionAccess(args: { tier: LamplightTier; promoActive: boolean }): boolean {
  if (args.promoActive) return true;
  return args.tier === 'plus';
}
```

- [ ] **Step 3: Run the entitlement test**

Run: `npx vitest run supabase/functions/_shared/entitlement.test.ts`
Expected: PASS (the 3 new cases + any pre-existing `hasChatAccess` cases).

- [ ] **Step 4: Write the failing context test**

Create `supabase/functions/lamplight-generate/monthly-reflection-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isValidPeriodKey, localMonthBoundsUtc, buildMonthlyReflectionContext } from './monthly-reflection-context';
import type { EdgeSupabase } from './reflection-candidates';

describe('isValidPeriodKey', () => {
  it('accepts YYYY-MM only', () => {
    expect(isValidPeriodKey('2026-05')).toBe(true);
    expect(isValidPeriodKey('2026-5')).toBe(false);
    expect(isValidPeriodKey('2026-05-01')).toBe(false);
    expect(isValidPeriodKey('26-05')).toBe(false);
    expect(isValidPeriodKey('')).toBe(false);
  });
});

describe('localMonthBoundsUtc', () => {
  it('computes UTC bounds and local date strings for a UTC month', () => {
    const b = localMonthBoundsUtc('2026-05', 'UTC');
    expect(b.monthStart).toBe('2026-05-01');
    expect(b.monthEnd).toBe('2026-05-31');
    expect(b.startUtc).toBe('2026-05-01T00:00:00.000Z');
    expect(b.endUtc).toBe('2026-06-01T00:00:00.000Z');
  });
  it('shifts the UTC window for a negative-offset timezone (EDT in May)', () => {
    const b = localMonthBoundsUtc('2026-05', 'America/New_York');
    expect(b.startUtc).toBe('2026-05-01T04:00:00.000Z');
    expect(b.endUtc).toBe('2026-06-01T04:00:00.000Z');
    expect(b.monthEnd).toBe('2026-05-31');
  });
});

describe('buildMonthlyReflectionContext', () => {
  const supabase = {} as unknown as EdgeSupabase;

  it('returns null for an empty month (graceful floor / no_notes upstream)', async () => {
    const ctx = await buildMonthlyReflectionContext(
      supabase,
      { userId: 'u1', periodKey: '2026-05', timezone: 'UTC' },
      { loadMonthNotes: async () => [] },
    );
    expect(ctx).toBeNull();
  });

  it('assembles the context from notes + candidates', async () => {
    const ctx = await buildMonthlyReflectionContext(
      supabase,
      { userId: 'u1', periodKey: '2026-05', timezone: 'UTC' },
      {
        loadMonthNotes: async () => [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }],
        // verseRef is Task 4's ReflectionCandidate field; only that is read here.
        buildCandidates: async () => ({ candidates: [{ verseRef: 'Ps 27:14' }] }) as never,
      },
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.periodLabel).toBe('May 2026');
    expect(ctx!.monthStart).toBe('2026-05-01');
    expect(ctx!.monthEnd).toBe('2026-05-31');
    expect([...ctx!.allowedNoteDays]).toEqual(['2026-05-12']);
    expect([...ctx!.allowedVerseRefs]).toEqual(['Ps 27:14']);
    expect(ctx!.notes).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/monthly-reflection-context.test.ts`
Expected: FAIL — `Cannot find module './monthly-reflection-context'`.

- [ ] **Step 6: Implement the context builder**

Create `supabase/functions/lamplight-generate/monthly-reflection-context.ts`:

```typescript
// Builds the MonthlyReflectionContext for a given (user, period): local month bounds,
// the month's notes bucketed by LOCAL day, the candidate pool (Task 4), and the derived
// allowlists the pipeline's validators need. Returns null for an empty month so the caller
// short-circuits to no_notes. All the vitest-testable logic lives here because index.ts
// (Deno serve) cannot be imported by the node test runner.

import { buildReflectionCandidates, type EdgeSupabase } from './reflection-candidates.ts';
import type { MonthNote, MonthlyReflectionContext } from './prompts/monthly-reflection.ts';

export function isValidPeriodKey(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s);
}

// Offset (ms) between the given IANA zone and UTC at the given instant.
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUtc - at.getTime();
}

// The UTC instant of local wall-midnight on (year, month0, day) in timeZone.
// Single-correction; exact except inside the ~1h DST transition window (acceptable — bounds
// are month-edge, and note bucketing uses makeToLocalDay independently).
function localMidnightUtc(year: number, month0: number, day: number, timeZone: string | null): Date {
  const guess = new Date(Date.UTC(year, month0, day, 0, 0, 0));
  if (!timeZone || timeZone === 'UTC') return guess;
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
}

export function localMonthBoundsUtc(
  periodKey: string,
  timeZone: string | null,
): { startUtc: string; endUtc: string; monthStart: string; monthEnd: string } {
  const [y, m] = periodKey.split('-').map(Number);
  const startUtc = localMidnightUtc(y, m - 1, 1, timeZone);
  const endUtc = localMidnightUtc(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, timeZone);
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
    monthStart: `${periodKey}-01`,
    monthEnd: `${periodKey}-${String(lastDayNum).padStart(2, '0')}`,
  };
}

// Maps an ISO timestamp to the reader's local calendar day ('YYYY-MM-DD').
export function makeToLocalDay(timeZone: string | null): (iso: string) => string {
  if (!timeZone || timeZone === 'UTC') return (iso) => iso.slice(0, 10);
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (iso) => dtf.format(new Date(iso));
}

// RECONCILIATION POINT: a note's body may be a plain string or a rich-text JSON document.
// Collect text nodes regardless of shape. Match the daily note-loader's extraction if one exists.
function extractNoteText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') { parts.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.text === 'string') parts.push(o.text);
      if (Array.isArray(o.children)) o.children.forEach(walk);
      if (Array.isArray(o.content)) o.content.forEach(walk);
    }
  };
  walk(content);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// RECONCILIATION POINT: the `notes` table shape. Kept injectable (deps.loadMonthNotes) so
// tests never touch the DB and so matching the daily loader is a one-line swap.
async function loadMonthNotes(
  supabase: EdgeSupabase,
  args: { userId: string; startUtc: string; endUtc: string },
  toLocalDay: (iso: string) => string,
): Promise<MonthNote[]> {
  const { data } = await supabase
    .from('notes')
    .select('id, content, created_at')
    .eq('user_id', args.userId)
    .gte('created_at', args.startUtc)
    .lt('created_at', args.endUtc)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as Array<{ id: string; content: unknown; created_at: string }>;
  return rows
    .map((r) => ({ id: r.id, day: toLocalDay(r.created_at), text: extractNoteText(r.content) }))
    .filter((n) => n.text.length > 0);
}

function formatPeriodLabel(periodKey: string, timeZone: string | null): string {
  const [y, m] = periodKey.split('-').map(Number);
  const mid = new Date(Date.UTC(y, m - 1, 15));
  return new Intl.DateTimeFormat('en-US', { timeZone: timeZone ?? 'UTC', month: 'long', year: 'numeric' }).format(mid);
}

export interface BuildMonthlyReflectionContextDeps {
  loadMonthNotes?: (
    supabase: EdgeSupabase,
    args: { userId: string; startUtc: string; endUtc: string },
    toLocalDay: (iso: string) => string,
  ) => Promise<MonthNote[]>;
  buildCandidates?: typeof buildReflectionCandidates;
}

export async function buildMonthlyReflectionContext(
  supabase: EdgeSupabase,
  args: { userId: string; periodKey: string; timezone: string | null },
  deps: BuildMonthlyReflectionContextDeps = {},
): Promise<MonthlyReflectionContext | null> {
  const { userId, periodKey, timezone } = args;
  const { startUtc, endUtc, monthStart, monthEnd } = localMonthBoundsUtc(periodKey, timezone);
  const toLocalDay = makeToLocalDay(timezone);

  const load = deps.loadMonthNotes ?? loadMonthNotes;
  const notes = await load(supabase, { userId, startUtc, endUtc }, toLocalDay);
  if (notes.length === 0) return null; // graceful floor → no_notes

  const buildCandidates = deps.buildCandidates ?? buildReflectionCandidates;
  const { candidates } = await buildCandidates({ supabase, userId, periodKey, monthStart, monthEnd, notes });

  return {
    periodKey,
    periodLabel: formatPeriodLabel(periodKey, timezone),
    monthStart,
    monthEnd,
    notes,
    candidates,
    allowedVerseRefs: new Set(candidates.map((c) => c.verseRef)),
    allowedNoteDays: new Set(notes.map((n) => n.day)),
  };
}
```

> **Reconciliation note for the executor:** the `buildCandidates({ supabase, userId, periodKey, monthStart, monthEnd, notes })` call and `c.verseRef` must line up with Task 4's `buildReflectionCandidates` deps + `ReflectionCandidate` shape (part 11 §GROUNDING A). If Task 4 named the deps or the verse-ref field differently, adjust these two lines only.

- [ ] **Step 7: Run it to confirm it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/monthly-reflection-context.test.ts`
Expected: PASS (5 tests). Null-on-empty is the graceful-floor deletion-test.

- [ ] **Step 8: Wire the `monthly_reflection` dispatch branch into `index.ts`**

Add these imports near the existing pipeline imports in `supabase/functions/lamplight-generate/index.ts`:

```typescript
import { runMonthlyReflectionPipeline } from './monthly-reflection-pipeline.ts';
import { buildMonthlyReflectionContext, isValidPeriodKey } from './monthly-reflection-context.ts';
import { hasReflectionAccess, type LamplightTier } from '../_shared/entitlement.ts';
```

Then, inside `handleGenerate` — AFTER the existing `lamplight_settings.enabled` opt-in gate and BEFORE the daily branch — add the reflection branch (the daily `local_date` path becomes the default/else):

```typescript
// --- monthly_reflection (Waymarks) ---
if (body.kind === 'monthly_reflection') {
  const periodKey = String(body.period_key ?? '');
  if (!isValidPeriodKey(periodKey)) return jsonResp({ error: 'bad period_key' }, 400);

  // Plus gate (DESIGN DECISION 3) — added ON TOP of the opt-in gate above.
  const [{ data: ent }, { data: promoRow }] = await Promise.all([
    supabase.from('lamplight_entitlements').select('tier').eq('user_id', userId).maybeSingle(),
    supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
  ]);
  if (!hasReflectionAccess({ tier: (ent?.tier ?? 'none') as LamplightTier, promoActive: promoRow?.value === true })) {
    return jsonResp({ error: 'reflections require Plus' }, 403);
  }

  const { data: settingsRow } = await supabase
    .from('lamplight_settings').select('timezone').eq('user_id', userId).maybeSingle();
  const timezone: string | null = settingsRow?.timezone ?? null;

  const { status, response } = await runGeneration(
    lifecycleDeps,
    { userId, artifactKind: 'monthly_reflection' },
    async () => {
      const ctx = await buildMonthlyReflectionContext(supabase, { userId, periodKey, timezone });
      const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx, userId, periodKey });
      return { response: result, usage: result.usage };
    },
  );
  return jsonResp(response, status);
}
```

Both the on-demand client (Tasks 13–14) and the scheduled sweep (Task 8) post `{ kind: 'monthly_reflection', period_key, ... }`, so this one branch serves both.

- [ ] **Step 9: Type-check the function and commit**

Run: `npx vitest run supabase/functions/_shared/entitlement.test.ts supabase/functions/lamplight-generate/monthly-reflection-context.test.ts` (green), then a Deno type-check of the edge function if the repo has one wired (e.g. `deno check supabase/functions/lamplight-generate/index.ts`) — the branch is real code, verified by compile + the unit tests above.

```bash
git add supabase/functions/_shared/entitlement.ts supabase/functions/_shared/entitlement.test.ts supabase/functions/lamplight-generate/monthly-reflection-context.ts supabase/functions/lamplight-generate/monthly-reflection-context.test.ts supabase/functions/lamplight-generate/index.ts
git commit -m "feat(waymarks): Plus gate + monthly_reflection dispatch + local-month context builder"
```

---

## Task 8: Migration 046 — the reflection cohort, hourly sweep, and claim RPC (§8, §11)

**Files:**
- Create: `supabase/migrations/046_lamplight_reflection_cohort.sql`

**Interfaces:**
- Produces (DB): `select_monthly_reflection_cohort() → table(user_id uuid, period_key text)`; the `lamplight_reflection_sweep` hourly cron job; `claim_lamplight_reflection_jobs(p_limit int) → setof lamplight_jobs`.
- Consumes (DB, existing): `lamplight_entitlements`, `lamplight_settings`, `notes`, `lamplight_artifacts`, `lamplight_jobs` (+ its partial-unique `lamplight_jobs_active_period_uniq` from Task 1/migration 045), `vault.decrypted_secrets`, `cron.schedule`, `net.http_post`.

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING B + part 13 §TASK 8 decision):**
- **Model this migration on `011_lamplight_signal_layer.sql`** — copy its `vault.decrypted_secrets` access pattern and its `net.http_post(...)` call idiom VERBATIM (secret names `embed_fn_url` and `service_role_key`; guard both non-null before posting). §GROUNDING B (part 11 L99–159) holds 011's exact text; mirror it rather than reinventing.
- `claim_lamplight_reflection_jobs` is a **sibling of the existing `claim_lamplight_jobs`** — same body, kind hardcoded to `'monthly_reflection'`, `security definer set search_path=public`, `for update skip locked`, and `revoke execute ... from public, anon, authenticated`.
- "Just-closed month" = the calendar month BEFORE the user's current LOCAL month (hourly sweep is idempotent: the upsert + the `not exists` artifact guard mean it re-fires until the stone exists, then stops; the deferred-job guard stops it after 3 failed attempts). Timezone via `coalesce(lamplight_settings.timezone,'UTC')`.
- The cohort/deferred guard is the scheduled mirror of Task 10's on-demand `clearReflectionJob`; `deferred` = a `lamplight_jobs` row `kind='monthly_reflection'`, `status='failed'`, `attempts>=3` for that `payload->>'period_key'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/046_lamplight_reflection_cohort.sql`:

```sql
-- Waymarks scheduled generation (§8, §11): pick each Plus user whose local month just
-- closed and who has notes there but no reflection yet, and POST the generate function
-- once per hour. Idempotent — the upsert + not-exists guards make re-firing safe.

-- 1. Cohort selector -------------------------------------------------------------
create or replace function public.select_monthly_reflection_cohort()
returns table (user_id uuid, period_key text)
language sql
stable
security definer
set search_path = public
as $$
  with plus_users as (
    select e.user_id, coalesce(s.timezone, 'UTC') as tz
    from lamplight_entitlements e
    left join lamplight_settings s on s.user_id = e.user_id
    where e.tier = 'plus'
  ),
  closed_month as (
    select
      pu.user_id,
      pu.tz,
      to_char(date_trunc('month', (now() at time zone pu.tz)) - interval '1 month', 'YYYY-MM') as period_key,
      date_trunc('month', (now() at time zone pu.tz)) - interval '1 month' as local_start,
      date_trunc('month', (now() at time zone pu.tz))                       as local_end
    from plus_users pu
  )
  select cm.user_id, cm.period_key
  from closed_month cm
  where exists (
    select 1 from notes n
    where n.user_id = cm.user_id
      and (n.created_at at time zone cm.tz) >= cm.local_start
      and (n.created_at at time zone cm.tz) <  cm.local_end
  )
  and not exists (
    select 1 from lamplight_artifacts a
    where a.user_id = cm.user_id and a.type = 'reflection_recap' and a.period_key = cm.period_key
  )
  and not exists (
    select 1 from lamplight_jobs j
    where j.kind = 'monthly_reflection'
      and j.user_id = cm.user_id
      and j.payload->>'period_key' = cm.period_key
      and j.status = 'failed'
      and j.attempts >= 3
  );
$$;

revoke execute on function public.select_monthly_reflection_cohort() from public, anon, authenticated;

-- 2. Hourly sweep ----------------------------------------------------------------
-- MIRROR migration 011's sweep verbatim for the vault + net.http_post idiom.
select cron.schedule(
  'lamplight_reflection_sweep',
  '0 * * * *',
  $cron$
  do $$
  declare
    fn_url   text := (select decrypted_secret from vault.decrypted_secrets where name = 'embed_fn_url');
    svc_key  text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
    target   record;
  begin
    if fn_url is null or svc_key is null then
      return;
    end if;
    for target in select * from public.select_monthly_reflection_cohort() loop
      perform net.http_post(
        url     := fn_url,
        headers := jsonb_build_object('Authorization', 'Bearer ' || svc_key, 'Content-Type', 'application/json'),
        body    := jsonb_build_object('kind', 'monthly_reflection', 'user_id', target.user_id, 'period_key', target.period_key)
      );
    end loop;
  end;
  $$;
  $cron$
);

-- 3. Claim RPC (sibling of claim_lamplight_jobs, kind pinned) ---------------------
create or replace function public.claim_lamplight_reflection_jobs(p_limit int)
returns setof public.lamplight_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update lamplight_jobs j
     set status = 'running', started_at = now()
   where j.id in (
     select id from lamplight_jobs
      where status = 'queued'
        and scheduled_at <= now()
        and kind = 'monthly_reflection'
      order by scheduled_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke execute on function public.claim_lamplight_reflection_jobs(int) from public, anon, authenticated;
```

- [ ] **Step 2: Apply and assert**

Run: `supabase db reset` (applies 001→046 cleanly).
Then assert the objects exist and the cohort is well-formed (psql or `supabase db execute`):

```sql
-- functions exist with the right return shapes
select 1 from pg_proc where proname = 'select_monthly_reflection_cohort';
select 1 from pg_proc where proname = 'claim_lamplight_reflection_jobs';
-- cron job registered
select 1 from cron.job where jobname = 'lamplight_reflection_sweep';
-- cohort runs without error and returns zero rows on an empty DB
select count(*) = 0 as empty_ok from public.select_monthly_reflection_cohort();
```

Expected: each returns `1` / `empty_ok = true`. If the repo has no live vault/pg_cron in local dev, guard the cron `select` behind the same conditional 011 uses, or run only the function-existence asserts locally and rely on the deployed environment for the cron (note which, inline).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/046_lamplight_reflection_cohort.sql
git commit -m "feat(waymarks): migration 046 — reflection cohort selector, hourly sweep, claim RPC"
```

---

## Task 9: Migration 047 — the backfill-targets RPC (§10)

**Files:**
- Create: `supabase/migrations/047_lamplight_reflection_backfill.sql`

**Interfaces:**
- Produces (DB): `list_reflection_backfill_targets() → table(period_key text)` — client-callable, `auth.uid()`-scoped.
- Consumed by: the `listBackfillTargets` adapter (Tasks 11–12) via `supabase.rpc('list_reflection_backfill_targets')`; the sequential backfill loop lives in Task 13's controller.

**Grounding (verified — do not re-explore; handoff part 13 §TASK 9 decision + part 10 §296 boundary call):**
- **Boundary choice (stated per part 10 §296):** the target discovery is a backend `security invoker` RPC (RLS-scoped by `auth.uid()`), NOT folded into the client. The client adapter just calls `rpc(...)`; Task 13 owns the one-at-a-time loop. Rationale: month-bucketing is timezone-correct in SQL and stays server-side; the client only sequences.
- Returns the most recent `BACKFILL_CAP` (= 12, §17) LOCAL months that have ≥1 note but no `reflection_recap` artifact, newest-first, excluding the current still-open month. `limit 12` MUST equal the TS `BACKFILL_CAP` constant.
- Separate migration because 046 is immutable once shipped.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/047_lamplight_reflection_backfill.sql`:

```sql
-- Waymarks backfill discovery (§10): the last 12 local months a Plus reader wrote in but
-- has no reflection for yet. Client-callable and auth.uid()-scoped; RLS applies (security invoker).

create or replace function public.list_reflection_backfill_targets()
returns table (period_key text)
language sql
stable
security invoker
set search_path = public
as $$
  with tz as (
    select coalesce((select timezone from lamplight_settings where user_id = auth.uid()), 'UTC') as zone
  ),
  note_months as (
    select distinct
      to_char(date_trunc('month', (n.created_at at time zone (select zone from tz))), 'YYYY-MM') as period_key
    from notes n
    where n.user_id = auth.uid()
  )
  select nm.period_key
  from note_months nm
  where nm.period_key < to_char(date_trunc('month', (now() at time zone (select zone from tz))), 'YYYY-MM')
    and not exists (
      select 1 from lamplight_artifacts a
      where a.user_id = auth.uid() and a.type = 'reflection_recap' and a.period_key = nm.period_key
    )
  order by nm.period_key desc
  limit 12;
$$;

grant execute on function public.list_reflection_backfill_targets() to authenticated;
```

- [ ] **Step 2: Apply and assert**

Run: `supabase db reset` (now 001→047).
Assert (psql / `supabase db execute`):

```sql
-- function exists and is callable by authenticated
select 1 from pg_proc where proname = 'list_reflection_backfill_targets';
-- returns period_key text, newest-first, capped at 12 (shape check on empty DB)
select count(*) = 0 as empty_ok from public.list_reflection_backfill_targets();
```

Expected: `1` and `empty_ok = true`. (A fuller fixture assert — seed notes across 14 months, expect exactly 12 newest, current month excluded — is worth adding if the repo has a SQL fixture harness.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/047_lamplight_reflection_backfill.sql
git commit -m "feat(waymarks): migration 047 — auth-scoped backfill-targets RPC (cap 12, newest-first)"
```

---

## Task 10: The retry attempt-ledger (`_shared/reflection-jobs.ts`, §11)

**Files:**
- Create: `supabase/functions/_shared/reflection-jobs.ts`
- Test: `supabase/functions/_shared/reflection-jobs.test.ts`
- Edit: `supabase/functions/lamplight-generate/index.ts` (clear a lingering deferred job on fresh success — the on-demand mirror of Task 8's cohort exclusion)

**Interfaces:**
- Produces: `nextReflectionJobState`, `isReflectionJobDeferred` (pure); `recordReflectionJobFailure`, `clearReflectionJob` (thin DB); `RETRY_ATTEMPT_CAP`.
- Consumes: `EdgeSupabase` (`../lamplight-generate/reflection-candidates.ts`, Task 4).
- Additive: Task 7's dispatch works WITHOUT this; the index edit here only layers job-clearing on top.

**Grounding (verified — do not re-explore; handoff part 13 §TASK 10 decision):**
- `deferred` = terminal: a `lamplight_jobs` row `status='failed'` AND `attempts >= RETRY_ATTEMPT_CAP` (= 3, §17). Task 8's cohort SQL excludes exactly these; `clearReflectionJob` is the on-demand mirror (a manual re-run wipes the failed row so the sweep can pick it up again once the block is gone).
- `recordReflectionJobFailure` / `claim_lamplight_reflection_jobs` (Task 8) are consumed by the job-worker that mirrors the DAILY worker. If a daily worker loop exists, extend it for `kind='monthly_reflection'` using these primitives (thin follow-on, non-blocking for MVP). This task ships the ledger + the on-demand clear.
- `RETRY_ATTEMPT_CAP` here MUST equal the client `reflection-constants` value (Task 11).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/reflection-jobs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  nextReflectionJobState,
  isReflectionJobDeferred,
  recordReflectionJobFailure,
  clearReflectionJob,
  RETRY_ATTEMPT_CAP,
} from './reflection-jobs';

describe('nextReflectionJobState (attempt ledger)', () => {
  it('increments attempts and always marks failed', () => {
    expect(nextReflectionJobState({ attempts: 0 })).toEqual({ status: 'failed', attempts: 1, deferred: false });
  });
  // Deferred-boundary deletion-test, both sides of the cap:
  it('does NOT defer when the resulting attempts is 2 (below the cap)', () => {
    expect(nextReflectionJobState({ attempts: 1 })).toEqual({ status: 'failed', attempts: 2, deferred: false });
  });
  it('DOES defer when the resulting attempts reaches 3 (the cap)', () => {
    expect(nextReflectionJobState({ attempts: 2 })).toEqual({ status: 'failed', attempts: 3, deferred: true });
  });
});

describe('isReflectionJobDeferred', () => {
  it('is false below the cap and for any non-failed status', () => {
    expect(isReflectionJobDeferred({ status: 'failed', attempts: 2 })).toBe(false);
    expect(isReflectionJobDeferred({ status: 'queued', attempts: 9 })).toBe(false);
  });
  it('is true only for a failed job at or above the cap', () => {
    expect(isReflectionJobDeferred({ status: 'failed', attempts: RETRY_ATTEMPT_CAP })).toBe(true);
    expect(isReflectionJobDeferred({ status: 'failed', attempts: 4 })).toBe(true);
  });
});

describe('thin DB helpers', () => {
  it('recordReflectionJobFailure writes the incremented failed state and returns it', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supabase = { from: () => ({ update: (row: Record<string, unknown>) => ({ eq: async () => { updates.push(row); return { error: null }; } }) }) } as never;
    const next = await recordReflectionJobFailure(supabase, 'job-1', 2);
    expect(next).toEqual({ status: 'failed', attempts: 3, deferred: true });
    expect(updates[0]).toEqual({ status: 'failed', attempts: 3 });
  });

  it('clearReflectionJob deletes the (user, kind, month) row', async () => {
    const eqs: Array<[string, unknown]> = [];
    const term = { then(res: (v: { error: null }) => void) { res({ error: null }); } };
    const mkEq = (depth: number): { eq: (c: string, v: unknown) => unknown } => ({
      eq: (c, v) => { eqs.push([c, v]); return depth > 1 ? mkEq(depth - 1) : term; },
    });
    const supabase = { from: () => ({ delete: () => mkEq(3) }) } as never;
    await clearReflectionJob(supabase, 'u1', '2026-05');
    expect(eqs).toEqual([['user_id', 'u1'], ['kind', 'monthly_reflection'], ['payload->>period_key', '2026-05']]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run supabase/functions/_shared/reflection-jobs.test.ts`
Expected: FAIL — `Cannot find module './reflection-jobs'`.

- [ ] **Step 3: Implement the ledger**

Create `supabase/functions/_shared/reflection-jobs.ts`:

```typescript
// Retry attempt-ledger for monthly_reflection jobs (§11). Pure state math + two thin DB
// helpers. `deferred` is terminal (failed AND attempts >= cap): Task 8's cohort SQL excludes
// deferred jobs from the scheduled sweep; clearReflectionJob is the on-demand mirror.

import type { EdgeSupabase } from '../lamplight-generate/reflection-candidates.ts';

export const RETRY_ATTEMPT_CAP = 3; // §17 — MUST match the client reflection-constants value.

export interface ReflectionJobState {
  status: 'failed';
  attempts: number;
  deferred: boolean;
}

export function nextReflectionJobState(job: { attempts: number }): ReflectionJobState {
  const attempts = job.attempts + 1;
  return { status: 'failed', attempts, deferred: attempts >= RETRY_ATTEMPT_CAP };
}

export function isReflectionJobDeferred(job: { status: string; attempts: number }): boolean {
  return job.status === 'failed' && job.attempts >= RETRY_ATTEMPT_CAP;
}

export async function recordReflectionJobFailure(
  supabase: EdgeSupabase,
  jobId: string,
  currentAttempts: number,
): Promise<ReflectionJobState> {
  const next = nextReflectionJobState({ attempts: currentAttempts });
  await supabase.from('lamplight_jobs').update({ status: next.status, attempts: next.attempts }).eq('id', jobId);
  return next;
}

export async function clearReflectionJob(
  supabase: EdgeSupabase,
  userId: string,
  periodKey: string,
): Promise<void> {
  await supabase
    .from('lamplight_jobs')
    .delete()
    .eq('user_id', userId)
    .eq('kind', 'monthly_reflection')
    .eq('payload->>period_key', periodKey);
}
```

> If `EdgeSupabase` (Task 4) was typed for `select` only, widen it to include `update`/`delete` (it is the permissive structural view — add the two method shapes), or type these two helpers with a local minimal writer interface. Do not fork a second Supabase type.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run supabase/functions/_shared/reflection-jobs.test.ts`
Expected: PASS (7 tests). The two boundary cases (resulting attempts 2 → not deferred, 3 → deferred) are the deletion-tests for the `>=` cap.

- [ ] **Step 5: Clear a lingering deferred job on fresh on-demand success**

In `supabase/functions/lamplight-generate/index.ts`, import the helper:

```typescript
import { clearReflectionJob } from '../_shared/reflection-jobs.ts';
```

Then in the `monthly_reflection` branch (Task 7), after `runGeneration` returns, wipe any failed job row when a NEW artifact was written (so a past deferral no longer blocks the sweep):

```typescript
// After: const { status, response } = await runGeneration(...);
if (response && (response as { ok?: boolean; cached?: boolean }).ok === true && (response as { cached?: boolean }).cached === false) {
  await clearReflectionJob(supabase, userId, periodKey);
}
return jsonResp(response, status);
```

This is the on-demand mirror of Task 8's SQL exclusion; it is additive (the branch functioned without it).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/reflection-jobs.ts supabase/functions/_shared/reflection-jobs.test.ts supabase/functions/lamplight-generate/index.ts
git commit -m "feat(waymarks): reflection retry attempt-ledger + on-demand deferred-job clear"
```

---

## Task 11: Client types, §17 constants, and adapter interface (Phase D start)

**Files:**
- Modify: `src/notepad/storage/lamplight-artifacts.ts` — re-export `ReflectionArtifact`/`Marker` (type-only).
- Create: `src/notepad/lamplight/reflection-constants.ts` — client mirror of spec §17.
- Create: `src/notepad/lamplight/reflection-constants.test.ts` — drift guard vs the Deno constants.
- Modify: `src/notepad/storage/lamplight-adapter.ts` — reflection result/stream unions + 8 interface methods.

**Interfaces:**
- Produces (relied on by Tasks 12–19): client-visible `ReflectionArtifact`/`Marker`; the §17 constants; `LamplightAdapter` gains `listReflections`, `getReflection`, `generateMonthlyReflection`, `streamMonthlyReflection?`, `getReflectionState`, `setReflectionHidden`, `setReflectionAnnotation`, `listBackfillTargets`; the `MonthlyReflectionGenerateResult`/`MonthlyReflectionStreamEvent` unions + `ReflectionListItem`/`ReflectionRecord`/`ReflectionState` shapes.
- Consumes: the Deno `_shared/artifacts.ts` types (Task 2) via a type-only cross-tree import, exactly as `DailyDevotion` is re-exported today.

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING C + part 10 §CONTRACTS):**
- `lamplight-artifacts.ts` today is one line: `export type { DailyDevotion } from '../../../supabase/functions/_shared/artifacts';` — add the reflection types the same way (relative path across the tree, no `@` alias).
- The §17 values are the SAME as the Deno `_shared/reflection-constants.ts` (Task 2). The single source of truth is spec §17; the drift test imports both and asserts equality.
- `generateMonthlyReflection` mirrors the daily result union `{ ok:true; artifact; cached } | { ok:false; reason:'no_notes'|'validators_failed'|'network' }`. Streaming stays optional (buffered fallback in the controller); MVP does NOT wire a backend stream, so both adapters leave `streamMonthlyReflection` undefined — the union exists for forward-compat.
- The state table is keyed `(user_id, artifact_type, period_key)`, so the state methods take an `artifactType` param (`'reflection_recap'` for monthly; yearly reuses them, fast-follow).

- [ ] **Step 1: Write the failing constants drift-guard test**

Create `src/notepad/lamplight/reflection-constants.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as client from './reflection-constants';
// The Deno shared module (Task 2). It is a leaf constants file — no Deno globals — so it imports
// cleanly under vitest/node. This asserts the client mirror can never silently drift from the edge.
import * as deno from '../../../supabase/functions/_shared/reflection-constants';

describe('client reflection-constants (§17 mirror)', () => {
  it('carries the exact spec §17 values', () => {
    expect(client.ARRIVAL_HOUR_LOCAL).toBe(7);
    expect(client.BACKFILL_CAP).toBe(12);
    expect(client.MARKER_MIN).toBe(1);
    expect(client.MARKER_MAX).toBe(6);
    expect(client.LETTER_WORD_MIN).toBe(60);
    expect(client.LETTER_WORD_MAX).toBe(350);
    expect(client.VERBATIM_RUN_MAX_WORDS).toBe(8);
    expect(client.RETRY_ATTEMPT_CAP).toBe(3);
    expect(client.CANDIDATE_POOL_MIN).toBe(8);
    expect(client.CANDIDATE_POOL_MAX).toBe(12);
    expect(client.MONTHLY_PROMPT_VERSION).toBe('monthly-reflection-v1');
  });

  it('never drifts from the Deno _shared/reflection-constants.ts', () => {
    expect(client.ARRIVAL_HOUR_LOCAL).toBe(deno.ARRIVAL_HOUR_LOCAL);
    expect(client.BACKFILL_CAP).toBe(deno.BACKFILL_CAP);
    expect(client.MARKER_MIN).toBe(deno.MARKER_MIN);
    expect(client.MARKER_MAX).toBe(deno.MARKER_MAX);
    expect(client.LETTER_WORD_MIN).toBe(deno.LETTER_WORD_MIN);
    expect(client.LETTER_WORD_MAX).toBe(deno.LETTER_WORD_MAX);
    expect(client.VERBATIM_RUN_MAX_WORDS).toBe(deno.VERBATIM_RUN_MAX_WORDS);
    expect(client.RETRY_ATTEMPT_CAP).toBe(deno.RETRY_ATTEMPT_CAP);
    expect(client.CANDIDATE_POOL_MIN).toBe(deno.CANDIDATE_POOL_MIN);
    expect(client.CANDIDATE_POOL_MAX).toBe(deno.CANDIDATE_POOL_MAX);
    expect(client.MONTHLY_PROMPT_VERSION).toBe(deno.MONTHLY_PROMPT_VERSION);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/lamplight/reflection-constants.test.ts`
Expected: FAIL — `Cannot find module './reflection-constants'`.

- [ ] **Step 3: Create the client constants mirror**

Create `src/notepad/lamplight/reflection-constants.ts`:

```typescript
// Client mirror of spec §17 (source of truth). Values MUST equal the Deno
// supabase/functions/_shared/reflection-constants.ts — the co-located drift test enforces it.
export const ARRIVAL_HOUR_LOCAL = 7;      // arrival rule: sealed newest month appears at 07:00 local on the 1st (§7)
export const BACKFILL_CAP = 12;           // first-open backfill horizon, in months (§8)
export const MARKER_MIN = 1;              // markers per letter, lower bound (§4.3)
export const MARKER_MAX = 6;              // markers per letter, upper bound (§4.3)
export const LETTER_WORD_MIN = 60;        // letter length floor, words (§6.2)
export const LETTER_WORD_MAX = 350;       // letter length ceiling, words (§6.2)
export const VERBATIM_RUN_MAX_WORDS = 8;  // witnessed-not-reopened lint (§6.2)
export const RETRY_ATTEMPT_CAP = 3;       // scheduled retry → deferred (§9)
export const CANDIDATE_POOL_MIN = 8;      // per-month candidate pool floor (§5)
export const CANDIDATE_POOL_MAX = 12;     // per-month candidate pool ceiling (§5)
export const MONTHLY_PROMPT_VERSION = 'monthly-reflection-v1'; // artifact provenance (§6.1)
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/notepad/lamplight/reflection-constants.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Re-export the artifact types to the client (verify by build)**

In `src/notepad/storage/lamplight-artifacts.ts`, add one line after the existing `DailyDevotion` re-export:

```typescript
export type { DailyDevotion } from '../../../supabase/functions/_shared/artifacts';
// Waymarks (Task 11): monthly reflection artifact shape + its marker, mirroring DailyDevotion.
export type { ReflectionArtifact, Marker } from '../../../supabase/functions/_shared/artifacts';
```

- [ ] **Step 6: Extend the adapter interface + result/stream unions (verify by build)**

In `src/notepad/storage/lamplight-adapter.ts`, import the reflection types alongside the existing `DailyDevotion` import and add the unions + shapes near the daily equivalents:

```typescript
import type { DailyDevotion, ReflectionArtifact } from './lamplight-artifacts';

export type MonthlyReflectionGenerateResult =
  | { ok: true; artifact: ReflectionArtifact; cached: boolean }
  | { ok: false; reason: 'no_notes' | 'validators_failed' | 'network' };

// Forward-compat with a future streaming backend (buffered fallback covers MVP). Mirrors
// DailyDevotionStreamEvent; stage names track the reflection pipeline (notes → candidates → composing).
export type MonthlyReflectionStreamEvent =
  | { kind: 'stage'; stage: 'notes' | 'candidates' | 'composing' }
  | { kind: 'piece'; field: keyof ReflectionArtifact; value: unknown }
  | { kind: 'refining' }
  | { kind: 'done'; artifact: ReflectionArtifact; cached: boolean }
  | { kind: 'error'; reason: 'no_notes' | 'validators_failed' | 'network' };

// The Path row (list view). hiddenAt/annotation are LEFT-JOINed from lamplight_reflection_state.
export interface ReflectionListItem {
  periodKey: string;   // 'YYYY-MM'
  title: string;
  createdAt: string;   // ISO
  hiddenAt: string | null;    // null = visible; non-null → The Path omits the stone (Task 17)
  annotation: string | null;  // the user's words, if any
}

// The letter view (detail). savedToNotes rides on the artifact row (lamplight_artifacts).
export interface ReflectionRecord {
  periodKey: string;
  title: string;
  artifact: ReflectionArtifact;
  createdAt: string;
  savedToNotes: boolean;
}

// Satellite state, natural-keyed (user_id, artifact_type, period_key). Never written by generation.
export interface ReflectionState {
  hiddenAt: string | null;
  annotation: string | null;
  annotationUpdatedAt: string | null;
}
```

Then add these members to the `LamplightAdapter` interface (leave `daily*` members untouched):

```typescript
  // ── Waymarks / monthly reflections ──────────────────────────────────────────
  listReflections(userId: string): Promise<ReflectionListItem[]>;
  getReflection(userId: string, periodKey: string): Promise<ReflectionRecord | null>;
  generateMonthlyReflection(userId: string, periodKey: string): Promise<MonthlyReflectionGenerateResult>;
  streamMonthlyReflection?(
    userId: string,
    periodKey: string,
    onEvent: (event: MonthlyReflectionStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  getReflectionState(
    userId: string,
    artifactType: string,
    periodKey: string,
  ): Promise<ReflectionState | null>;
  setReflectionHidden(
    userId: string,
    artifactType: string,
    periodKey: string,
    hidden: boolean,
  ): Promise<void>;
  setReflectionAnnotation(
    userId: string,
    artifactType: string,
    periodKey: string,
    text: string | null,
  ): Promise<void>;
  listBackfillTargets(userId: string): Promise<string[]>; // period_keys with notes-but-no-artifact, newest-first
```

Run: `npx tsc --noEmit` (or the repo's typecheck script). Expected: PASS — the interface additions compile; the two adapters (Task 12) don't yet implement them, so if `tsc` flags `SupabaseLamplightAdapter`/`FakeLamplightAdapter` as missing members, that is the Task-12 red state — proceed to Task 12. (Optionally add the members as `// @ts-expect-error pending Task 12` stubs, or just accept the known gap and let Task 12 close it.)

- [ ] **Step 7: Commit**

```bash
git add src/notepad/storage/lamplight-artifacts.ts src/notepad/lamplight/reflection-constants.ts src/notepad/lamplight/reflection-constants.test.ts src/notepad/storage/lamplight-adapter.ts
git commit -m "feat(waymarks): client reflection types, §17 constants mirror, and adapter interface"
```

---

## Task 12: Adapter implementations + RLS/CRUD tests

**Files:**
- Modify: `src/notepad/storage/fake-lamplight-adapter.ts` — in-memory reflection store (queue-driven, Map-backed).
- Modify: `src/notepad/storage/supabase-lamplight-adapter.ts` — real reads/writes on `lamplight_artifacts` + `lamplight_reflection_state`, generate via `functions.invoke`, backfill via `rpc`.
- Create: `src/notepad/storage/fake-lamplight-adapter.reflections.test.ts` — always-on unit coverage of the fake.
- Create: `src/notepad/storage/lamplight-reflection-rls.test.ts` — LIVE-DB RLS + CRUD (skip-guarded on env).

**Interfaces:**
- Produces: concrete `LamplightAdapter` reflection methods usable by the controller (Task 13) and hook (Task 14).
- Consumes: Task 11's interface + unions; the `lamplight_reflection_state` table (Task 1); the `monthly_reflection` edge branch (Task 7); the `list_reflection_backfill_targets` RPC (Task 9).

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING C items 5/6/11):**
- Supabase read idiom: `.from('lamplight_artifacts').select(...).eq('user_id',userId).eq('type','reflection_recap').eq('period_key',periodKey).maybeSingle(); if (error) throw error;`.
- Generate idiom: `this.#client.functions.invoke('lamplight-generate', { body: { kind:'monthly_reflection', user_id, period_key } })`, wrapped in try/catch → `{ ok:false, reason:'network' }`, with a narrow shape-check on the returned data.
- **Reconciliation (one honest boundary):** the edge returns the pipeline result `{ ok:true, cached, artifactId, usage }` (Task 6) — it carries `artifactId`, NOT the body. So on `ok:true` the adapter re-reads the body via `getReflection`. If Task 7 is later changed to inline `body` in the HTTP response, use it directly and drop the re-fetch.
- Fake adapter idiom: `Map` keyed `${userId}:${periodKey}`, plus a `queued…Results` array with `__queue…` push helpers and `shift()` on generate (default `{ ok:false, reason:'network' }` when empty); on `ok:true` also writes the map.
- RLS test idiom: reads `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY` + two test users from `process.env`; `const maybeDescribe = haveEnv ? describe : describe.skip`; `beforeAll` signs in two real clients via `signInWithPassword`; asserts real cross-user isolation.

- [ ] **Step 1: Write the failing fake-adapter unit test**

Create `src/notepad/storage/fake-lamplight-adapter.reflections.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakeLamplightAdapter } from './fake-lamplight-adapter';
import type { ReflectionArtifact } from './lamplight-artifacts';

const U = 'user-1';
const artifact: ReflectionArtifact = { title: 'The month you kept showing up', letter: 'You came back.', markers: [] };

describe('FakeLamplightAdapter — reflections', () => {
  it('generate consumes the queue and, on ok, becomes readable via getReflection', async () => {
    const a = new FakeLamplightAdapter();
    a.__queueReflectionResult({ ok: true, artifact, cached: false });
    const res = await a.generateMonthlyReflection(U, '2026-05');
    expect(res).toEqual({ ok: true, artifact, cached: false });
    const rec = await a.getReflection(U, '2026-05');
    expect(rec?.title).toBe(artifact.title);
    expect(rec?.savedToNotes).toBe(false);
  });

  it('generate defaults to a network error when the queue is empty', async () => {
    const a = new FakeLamplightAdapter();
    expect(await a.generateMonthlyReflection(U, '2026-05')).toEqual({ ok: false, reason: 'network' });
  });

  it('listReflections is newest-first and joins hide/annotate state; hidden rows still list', async () => {
    const a = new FakeLamplightAdapter();
    a.__seedReflection(U, { periodKey: '2026-03', title: 'March', artifact, createdAt: '2026-03-01T12:00:00.000Z', savedToNotes: false });
    a.__seedReflection(U, { periodKey: '2026-05', title: 'May', artifact, createdAt: '2026-05-01T12:00:00.000Z', savedToNotes: false });
    await a.setReflectionHidden(U, 'reflection_recap', '2026-03', true);
    await a.setReflectionAnnotation(U, 'reflection_recap', '2026-05', 'my words');
    const list = await a.listReflections(U);
    expect(list.map((r) => r.periodKey)).toEqual(['2026-05', '2026-03']); // newest-first
    expect(list.find((r) => r.periodKey === '2026-03')?.hiddenAt).not.toBeNull();
    expect(list.find((r) => r.periodKey === '2026-05')?.annotation).toBe('my words');
  });

  it('listBackfillTargets returns exactly what was seeded', async () => {
    const a = new FakeLamplightAdapter();
    a.__setBackfillTargets(U, ['2026-04', '2026-02']);
    expect(await a.listBackfillTargets(U)).toEqual(['2026-04', '2026-02']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/storage/fake-lamplight-adapter.reflections.test.ts`
Expected: FAIL — the reflection methods/helpers don't exist on `FakeLamplightAdapter`.

- [ ] **Step 3: Implement the fake adapter methods**

In `src/notepad/storage/fake-lamplight-adapter.ts`, add the reflection state + methods to the class (keep the existing daily fields/methods):

```typescript
import type {
  MonthlyReflectionGenerateResult,
  ReflectionListItem,
  ReflectionRecord,
  ReflectionState,
} from './lamplight-adapter';

// …inside class FakeLamplightAdapter implements LamplightAdapter {

  reflections = new Map<string, ReflectionRecord>();            // `${userId}:${periodKey}`
  reflectionStates = new Map<string, ReflectionState>();        // `${userId}:${artifactType}:${periodKey}`
  backfillTargets = new Map<string, string[]>();                // userId → period_keys
  queuedReflectionResults: MonthlyReflectionGenerateResult[] = [];

  __queueReflectionResult(result: MonthlyReflectionGenerateResult): void {
    this.queuedReflectionResults.push(result);
  }
  __seedReflection(userId: string, record: ReflectionRecord): void {
    this.reflections.set(`${userId}:${record.periodKey}`, record);
  }
  __setBackfillTargets(userId: string, periodKeys: string[]): void {
    this.backfillTargets.set(userId, periodKeys);
  }

  async listReflections(userId: string): Promise<ReflectionListItem[]> {
    const items: ReflectionListItem[] = [];
    for (const [key, rec] of this.reflections) {
      if (!key.startsWith(`${userId}:`)) continue;
      const st = this.reflectionStates.get(`${userId}:reflection_recap:${rec.periodKey}`) ?? null;
      items.push({
        periodKey: rec.periodKey,
        title: rec.title,
        createdAt: rec.createdAt,
        hiddenAt: st?.hiddenAt ?? null,
        annotation: st?.annotation ?? null,
      });
    }
    return items.sort((x, y) => (x.periodKey < y.periodKey ? 1 : -1)); // newest-first
  }

  async getReflection(userId: string, periodKey: string): Promise<ReflectionRecord | null> {
    return this.reflections.get(`${userId}:${periodKey}`) ?? null;
  }

  async generateMonthlyReflection(userId: string, periodKey: string): Promise<MonthlyReflectionGenerateResult> {
    const result = this.queuedReflectionResults.shift() ?? { ok: false as const, reason: 'network' as const };
    if (result.ok) {
      this.reflections.set(`${userId}:${periodKey}`, {
        periodKey,
        title: result.artifact.title,
        artifact: result.artifact,
        createdAt: `${periodKey}-01T12:00:00.000Z`,
        savedToNotes: false,
      });
    }
    return result;
  }

  async getReflectionState(userId: string, artifactType: string, periodKey: string): Promise<ReflectionState | null> {
    return this.reflectionStates.get(`${userId}:${artifactType}:${periodKey}`) ?? null;
  }

  async setReflectionHidden(userId: string, artifactType: string, periodKey: string, hidden: boolean): Promise<void> {
    const key = `${userId}:${artifactType}:${periodKey}`;
    const prev = this.reflectionStates.get(key) ?? { hiddenAt: null, annotation: null, annotationUpdatedAt: null };
    this.reflectionStates.set(key, { ...prev, hiddenAt: hidden ? `${periodKey}-15T00:00:00.000Z` : null });
  }

  async setReflectionAnnotation(userId: string, artifactType: string, periodKey: string, text: string | null): Promise<void> {
    const key = `${userId}:${artifactType}:${periodKey}`;
    const prev = this.reflectionStates.get(key) ?? { hiddenAt: null, annotation: null, annotationUpdatedAt: null };
    this.reflectionStates.set(key, { ...prev, annotation: text, annotationUpdatedAt: text ? `${periodKey}-16T00:00:00.000Z` : null });
  }

  async listBackfillTargets(userId: string): Promise<string[]> {
    return this.backfillTargets.get(userId) ?? [];
  }
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/notepad/storage/fake-lamplight-adapter.reflections.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement the Supabase adapter methods (verify by build)**

In `src/notepad/storage/supabase-lamplight-adapter.ts`, add the methods to `SupabaseLamplightAdapter` (mirror the daily read/generate idioms; `#client` is the existing private field):

```typescript
import type {
  MonthlyReflectionGenerateResult,
  ReflectionListItem,
  ReflectionRecord,
  ReflectionState,
} from './lamplight-adapter';
import type { ReflectionArtifact } from './lamplight-artifacts';

const REFLECTION_TYPE = 'reflection_recap';

  async listReflections(userId: string): Promise<ReflectionListItem[]> {
    const { data: rows, error } = await this.#client
      .from('lamplight_artifacts')
      .select('period_key, title, created_at')
      .eq('user_id', userId)
      .eq('type', REFLECTION_TYPE)
      .order('period_key', { ascending: false });
    if (error) throw error;
    const { data: states, error: stateError } = await this.#client
      .from('lamplight_reflection_state')
      .select('period_key, hidden_at, annotation')
      .eq('user_id', userId)
      .eq('artifact_type', REFLECTION_TYPE);
    if (stateError) throw stateError;
    const byKey = new Map((states ?? []).map((s) => [s.period_key as string, s]));
    return (rows ?? []).map((r) => {
      const st = byKey.get(r.period_key as string);
      return {
        periodKey: r.period_key as string,
        title: r.title as string,
        createdAt: r.created_at as string,
        hiddenAt: (st?.hidden_at as string | null) ?? null,
        annotation: (st?.annotation as string | null) ?? null,
      };
    });
  }

  async getReflection(userId: string, periodKey: string): Promise<ReflectionRecord | null> {
    const { data, error } = await this.#client
      .from('lamplight_artifacts')
      .select('period_key, title, body, created_at, saved_to_notes')
      .eq('user_id', userId)
      .eq('type', REFLECTION_TYPE)
      .eq('period_key', periodKey)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      periodKey: data.period_key as string,
      title: data.title as string,
      artifact: data.body as ReflectionArtifact,
      createdAt: data.created_at as string,
      savedToNotes: (data.saved_to_notes as boolean | null) ?? false,
    };
  }

  async generateMonthlyReflection(userId: string, periodKey: string): Promise<MonthlyReflectionGenerateResult> {
    try {
      const { data, error } = await this.#client.functions.invoke('lamplight-generate', {
        body: { kind: 'monthly_reflection', user_id: userId, period_key: periodKey },
      });
      if (error) return { ok: false, reason: 'network' };
      const d = data as { ok?: boolean; cached?: boolean; reason?: string } | null;
      if (d?.ok === true) {
        // Edge returns artifactId, not body (Task 6) → hydrate via getReflection.
        const record = await this.getReflection(userId, periodKey);
        if (record) return { ok: true, artifact: record.artifact, cached: d.cached === true };
        return { ok: false, reason: 'network' };
      }
      if (d?.ok === false && (d.reason === 'no_notes' || d.reason === 'validators_failed')) {
        return { ok: false, reason: d.reason };
      }
      return { ok: false, reason: 'network' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  async getReflectionState(userId: string, artifactType: string, periodKey: string): Promise<ReflectionState | null> {
    const { data, error } = await this.#client
      .from('lamplight_reflection_state')
      .select('hidden_at, annotation, annotation_updated_at')
      .eq('user_id', userId)
      .eq('artifact_type', artifactType)
      .eq('period_key', periodKey)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      hiddenAt: (data.hidden_at as string | null) ?? null,
      annotation: (data.annotation as string | null) ?? null,
      annotationUpdatedAt: (data.annotation_updated_at as string | null) ?? null,
    };
  }

  async setReflectionHidden(userId: string, artifactType: string, periodKey: string, hidden: boolean): Promise<void> {
    const { error } = await this.#client
      .from('lamplight_reflection_state')
      .upsert(
        { user_id: userId, artifact_type: artifactType, period_key: periodKey, hidden_at: hidden ? new Date().toISOString() : null },
        { onConflict: 'user_id,artifact_type,period_key' },
      );
    if (error) throw error;
  }

  async setReflectionAnnotation(userId: string, artifactType: string, periodKey: string, text: string | null): Promise<void> {
    const { error } = await this.#client
      .from('lamplight_reflection_state')
      .upsert(
        {
          user_id: userId,
          artifact_type: artifactType,
          period_key: periodKey,
          annotation: text,
          annotation_updated_at: text ? new Date().toISOString() : null,
        },
        { onConflict: 'user_id,artifact_type,period_key' },
      );
    if (error) throw error;
  }

  async listBackfillTargets(userId: string): Promise<string[]> {
    const { data, error } = await this.#client.rpc('list_reflection_backfill_targets');
    if (error) throw error;
    return (data ?? []).map((r: { period_key: string }) => r.period_key);
  }
```

> The `setReflection*` upserts touch ONLY `lamplight_reflection_state`, never `lamplight_artifacts` — the structural guarantee that generation state and user state never collide. `saved_to_notes` is a separate concern owned by Task 17. `listBackfillTargets` ignores `userId` at the SQL layer (the RPC is `auth.uid()`-scoped, Task 9); the param is kept for interface symmetry + the fake.

Run: `npx tsc --noEmit`. Expected: PASS — both adapters now satisfy `LamplightAdapter`.

- [ ] **Step 6: Write the LIVE-DB RLS + CRUD test (skip-guarded)**

Create `src/notepad/storage/lamplight-reflection-rls.test.ts`, mirroring `lamplight-rls.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_TEST_URL;
const anon = process.env.SUPABASE_TEST_ANON_KEY;
const userAEmail = process.env.SUPABASE_TEST_USER_A_EMAIL;
const userAPass = process.env.SUPABASE_TEST_USER_A_PASSWORD;
const userBEmail = process.env.SUPABASE_TEST_USER_B_EMAIL;
const userBPass = process.env.SUPABASE_TEST_USER_B_PASSWORD;
const haveEnv = Boolean(url && anon && userAEmail && userAPass && userBEmail && userBPass);
const maybeDescribe = haveEnv ? describe : describe.skip;

maybeDescribe('lamplight_reflection_state RLS + CRUD (live DB)', () => {
  let a: SupabaseClient;
  let b: SupabaseClient;
  let userAId: string;

  beforeAll(async () => {
    a = createClient(url!, anon!);
    b = createClient(url!, anon!);
    const { data: signInA } = await a.auth.signInWithPassword({ email: userAEmail!, password: userAPass! });
    await b.auth.signInWithPassword({ email: userBEmail!, password: userBPass! });
    userAId = signInA.user!.id;
  });

  it('a user cannot read another user’s reflection state', async () => {
    await a.from('lamplight_reflection_state').upsert(
      { user_id: userAId, artifact_type: 'reflection_recap', period_key: '2026-01', annotation: 'private' },
      { onConflict: 'user_id,artifact_type,period_key' },
    );
    const { data: leaked } = await b
      .from('lamplight_reflection_state')
      .select('annotation')
      .eq('user_id', userAId)
      .eq('period_key', '2026-01')
      .maybeSingle();
    expect(leaked).toBeNull(); // RLS filters cross-user selects to zero rows
  });

  it('hide → read-back → clear round-trips for the owner', async () => {
    await a.from('lamplight_reflection_state').upsert(
      { user_id: userAId, artifact_type: 'reflection_recap', period_key: '2026-02', hidden_at: new Date().toISOString() },
      { onConflict: 'user_id,artifact_type,period_key' },
    );
    const { data: hidden } = await a.from('lamplight_reflection_state').select('hidden_at').eq('user_id', userAId).eq('period_key', '2026-02').single();
    expect(hidden!.hidden_at).not.toBeNull();
    await a.from('lamplight_reflection_state').update({ hidden_at: null }).eq('user_id', userAId).eq('period_key', '2026-02');
    const { data: shown } = await a.from('lamplight_reflection_state').select('hidden_at').eq('user_id', userAId).eq('period_key', '2026-02').single();
    expect(shown!.hidden_at).toBeNull();
  });

  it('annotating a reflection does NOT clobber the artifact’s saved_to_notes flag', async () => {
    // Precondition: an artifact row exists for (userA, 'reflection_recap', '2026-03') with saved_to_notes = true.
    await a.from('lamplight_artifacts').update({ saved_to_notes: true }).eq('user_id', userAId).eq('type', 'reflection_recap').eq('period_key', '2026-03');
    await a.from('lamplight_reflection_state').upsert(
      { user_id: userAId, artifact_type: 'reflection_recap', period_key: '2026-03', annotation: 'edited' },
      { onConflict: 'user_id,artifact_type,period_key' },
    );
    const { data: art } = await a.from('lamplight_artifacts').select('saved_to_notes').eq('user_id', userAId).eq('type', 'reflection_recap').eq('period_key', '2026-03').maybeSingle();
    if (art) expect(art.saved_to_notes).toBe(true); // annotate wrote only the satellite table
  });
});
```

- [ ] **Step 7: Run the suites**

Run: `npx vitest run src/notepad/storage/fake-lamplight-adapter.reflections.test.ts src/notepad/storage/lamplight-reflection-rls.test.ts`
Expected: fake suite PASSES (4); RLS suite is SKIPPED locally (no `SUPABASE_TEST_*` env) and runs in the integration environment that provides it — matching the existing `lamplight-rls.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/notepad/storage/fake-lamplight-adapter.ts src/notepad/storage/supabase-lamplight-adapter.ts src/notepad/storage/fake-lamplight-adapter.reflections.test.ts src/notepad/storage/lamplight-reflection-rls.test.ts
git commit -m "feat(waymarks): reflection adapter impls (fake + supabase) with RLS/CRUD tests"
```

---

## Task 13: The reflections controller (state machine + backfill loop)

**Files:**
- Create: `src/notepad/lamplight/reflections-controller.ts`
- Test: `src/notepad/lamplight/reflections-controller.test.ts`

**Interfaces:**
- Produces: `ReflectionsController` (extends `Observable<ReflectionsState>`), `ReflectionsState`, `ReflectionsDeps`, `ReflectionsInputs`, `BACKFILL_STATUS`.
- Consumes: `Observable` base (`../collection/observable`); the adapter unions/records (Task 11).

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING C items 1/2):**
- Copy `todays-lamp-controller.ts` verbatim for the staleness machinery: private `generation` counter, `runAbort: AbortController | null`, `pendingStart`, `isStale(gen)`, `emit(gen,next)`; `setInputs` bumps `++generation` and fires `void run(gen)`; `dispose()` = `generation++; runAbort?.abort(); runAbort = null`.
- `Observable<T>` API: `subscribe(l)`/`getSnapshot()` (arrow props), `protected setState(updater)` with a referential bail. Reconciliation: match how `todays-lamp-controller` calls `super(...)` — if the base takes the initial snapshot in its constructor, `super({ phase: 'idle' })`; if it initializes differently, mirror that exactly.
- Phase mapping (spec §12): on-demand `validators_failed` → `unavailable` ("This one isn't ready yet. Try again."); `no_notes` → `empty` ("Nothing was written here."); `network`/transient → `error`. Buffered path only (MVP has no reflection stream); `refining` stays in the union for the streaming fast-follow.
- The backfill loop is SEQUENTIAL — one period at a time over `listBackfillTargets()` — and a single failed month does not abort the run (§8).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/lamplight/reflections-controller.test.ts` (pure class — no jsdom):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ReflectionsController, type ReflectionsDeps, type ReflectionsState } from './reflections-controller';
import type { ReflectionRecord } from '../storage/lamplight-adapter';

const rec = (periodKey: string): ReflectionRecord => ({
  periodKey, title: 'T', artifact: { title: 'T', letter: 'L', markers: [] },
  createdAt: `${periodKey}-01T00:00:00.000Z`, savedToNotes: false,
});
const track = (c: ReflectionsController): ReflectionsState[] => {
  const seen: ReflectionsState[] = [];
  c.subscribe(() => seen.push(c.getSnapshot()));
  return seen;
};

describe('ReflectionsController', () => {
  it('retrieving → ready when the artifact already exists (no generate)', async () => {
    const deps: ReflectionsDeps = { getExisting: vi.fn().mockResolvedValue(rec('2026-05')), generate: vi.fn(), listBackfillTargets: vi.fn() };
    const c = new ReflectionsController(deps);
    const seen = track(c);
    c.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(c.getSnapshot().phase).toBe('ready'));
    expect(seen.map((s) => s.phase)).toContain('retrieving');
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('generates then re-reads to ready when none exists and autoGenerate is on', async () => {
    const deps: ReflectionsDeps = {
      getExisting: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(rec('2026-05')),
      generate: vi.fn().mockResolvedValue({ ok: true, artifact: rec('2026-05').artifact, cached: false }),
      listBackfillTargets: vi.fn(),
    };
    const c = new ReflectionsController(deps);
    c.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(c.getSnapshot().phase).toBe('ready'));
    expect(deps.generate).toHaveBeenCalledOnce();
  });

  it('maps validators_failed → unavailable and no_notes → empty', async () => {
    const mk = (reason: 'validators_failed' | 'no_notes') => new ReflectionsController({
      getExisting: vi.fn().mockResolvedValue(null),
      generate: vi.fn().mockResolvedValue({ ok: false, reason }),
      listBackfillTargets: vi.fn(),
    });
    const a = mk('validators_failed'); a.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(a.getSnapshot().phase).toBe('unavailable'));
    const b = mk('no_notes'); b.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: true });
    await vi.waitFor(() => expect(b.getSnapshot().phase).toBe('empty'));
  });

  it('a superseded run never overwrites a newer one (generation guard)', async () => {
    let resolveA!: () => void;
    const aHangs = new Promise<null>((r) => { resolveA = () => r(null); });
    const deps: ReflectionsDeps = {
      getExisting: vi.fn().mockReturnValueOnce(aHangs).mockResolvedValue(rec('2026-06')),
      generate: vi.fn(), listBackfillTargets: vi.fn(),
    };
    const c = new ReflectionsController(deps);
    c.setInputs({ userId: 'u', periodKey: '2026-05', autoGenerate: false });
    c.setInputs({ userId: 'u', periodKey: '2026-06', autoGenerate: false });
    await vi.waitFor(() => expect(c.getSnapshot()).toEqual({ phase: 'ready', record: rec('2026-06') }));
    resolveA(); // the stale run resolves late…
    await new Promise((r) => setTimeout(r, 0));
    expect(c.getSnapshot()).toEqual({ phase: 'ready', record: rec('2026-06') }); // …and must not clobber
  });

  it('backfill generates every target sequentially, emits the status line, then idles', async () => {
    const order: string[] = [];
    const deps: ReflectionsDeps = {
      getExisting: vi.fn(),
      generate: vi.fn().mockImplementation(async (_u: string, pk: string) => { order.push(pk); return { ok: true, artifact: rec(pk).artifact, cached: false }; }),
      listBackfillTargets: vi.fn().mockResolvedValue(['2026-04', '2026-03', '2026-02']),
    };
    const c = new ReflectionsController(deps);
    const seen = track(c);
    await c.startBackfill('u');
    expect(order).toEqual(['2026-04', '2026-03', '2026-02']); // strict order = sequential
    expect(seen.some((s) => s.phase === 'backfilling' && s.message === 'Gathering the months behind you…')).toBe(true);
    expect(c.getSnapshot().phase).toBe('idle');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/lamplight/reflections-controller.test.ts`
Expected: FAIL — `Cannot find module './reflections-controller'`.

- [ ] **Step 3: Implement the controller**

Create `src/notepad/lamplight/reflections-controller.ts`:

```typescript
import { Observable } from '../collection/observable';
import type { MonthlyReflectionGenerateResult, ReflectionRecord } from '../storage/lamplight-adapter';

export const BACKFILL_STATUS = 'Gathering the months behind you…'; // §13.6 verbatim (non-numeric progress)

export type ReflectionsState =
  | { phase: 'idle' }
  | { phase: 'retrieving' }
  | { phase: 'generating' }
  | { phase: 'refining' } // reserved for the streaming fast-follow; buffered MVP does not emit it
  | { phase: 'ready'; record: ReflectionRecord }
  | { phase: 'empty' } // no_notes on-demand → "Nothing was written here."
  | { phase: 'unavailable' } // validators_failed on-demand → "This one isn't ready yet. Try again."
  | { phase: 'backfilling'; message: string }
  | { phase: 'error'; reason: string };

export interface ReflectionsDeps {
  getExisting: (userId: string, periodKey: string) => Promise<ReflectionRecord | null>;
  generate: (userId: string, periodKey: string) => Promise<MonthlyReflectionGenerateResult>;
  listBackfillTargets: (userId: string) => Promise<string[]>;
}

export interface ReflectionsInputs {
  userId: string;
  periodKey: string;
  autoGenerate: boolean;
}

export class ReflectionsController extends Observable<ReflectionsState> {
  private readonly deps: ReflectionsDeps;
  private inputs: ReflectionsInputs = { userId: '', periodKey: '', autoGenerate: true };
  private generation = 0;
  private runAbort: AbortController | null = null;
  private pendingStart = false;

  constructor(deps: ReflectionsDeps) {
    super({ phase: 'idle' });
    this.deps = deps;
  }

  setInputs(inputs: ReflectionsInputs): void {
    this.inputs = inputs;
    const gen = ++this.generation;
    void this.run(gen);
  }

  start(): void {
    this.pendingStart = true;
    const gen = ++this.generation;
    void this.run(gen);
  }

  retry(): void {
    this.start();
  }

  dispose(): void {
    this.generation++;
    this.runAbort?.abort();
    this.runAbort = null;
  }

  private isStale(gen: number): boolean {
    return gen !== this.generation;
  }

  private emit(gen: number, next: ReflectionsState): void {
    if (!this.isStale(gen)) this.setState(() => next);
  }

  private async run(gen: number): Promise<void> {
    const startRequested = this.pendingStart;
    this.pendingStart = false;
    this.runAbort?.abort();
    this.runAbort = new AbortController();
    const { userId, periodKey, autoGenerate } = this.inputs;

    if (!userId || !periodKey) {
      this.emit(gen, { phase: 'idle' });
      return;
    }

    this.emit(gen, { phase: 'retrieving' });
    let existing: ReflectionRecord | null;
    try {
      existing = await this.deps.getExisting(userId, periodKey);
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    if (existing) {
      this.emit(gen, { phase: 'ready', record: existing });
      return;
    }
    if (!(autoGenerate || startRequested)) {
      this.emit(gen, { phase: 'idle' });
      return;
    }

    this.emit(gen, { phase: 'generating' });
    let result: MonthlyReflectionGenerateResult;
    try {
      result = await this.deps.generate(userId, periodKey);
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    if (result.ok) {
      const record = await this.deps.getExisting(userId, periodKey); // hydrate createdAt/savedToNotes
      if (this.isStale(gen)) return;
      this.emit(
        gen,
        record
          ? { phase: 'ready', record }
          : {
              phase: 'ready',
              record: {
                periodKey,
                title: result.artifact.title,
                artifact: result.artifact,
                createdAt: `${periodKey}-01T00:00:00.000Z`,
                savedToNotes: false,
              },
            },
      );
      return;
    }
    switch (result.reason) {
      case 'no_notes':
        this.emit(gen, { phase: 'empty' });
        return;
      case 'validators_failed':
        this.emit(gen, { phase: 'unavailable' });
        return;
      default:
        this.emit(gen, { phase: 'error', reason: 'network' });
        return;
    }
  }

  // Path mode: first-open backfill. Sequential (one edge invocation at a time) so we never burst
  // the function. Callers re-read listReflections() once this resolves to paint the new stones.
  async startBackfill(userId: string): Promise<void> {
    const gen = ++this.generation;
    this.runAbort?.abort();
    this.emit(gen, { phase: 'backfilling', message: BACKFILL_STATUS });
    let targets: string[];
    try {
      targets = await this.deps.listBackfillTargets(userId);
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    for (const periodKey of targets) {
      if (this.isStale(gen)) return;
      try {
        await this.deps.generate(userId, periodKey);
      } catch {
        // A single failed/empty month is skipped; the backfill continues (§8).
      }
    }
    if (this.isStale(gen)) return;
    this.emit(gen, { phase: 'idle' });
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/notepad/lamplight/reflections-controller.test.ts`
Expected: PASS (5 tests) — including the generation-guard staleness case (the deletion-test that proves a superseded run cannot clobber a newer one).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/lamplight/reflections-controller.ts src/notepad/lamplight/reflections-controller.test.ts
git commit -m "feat(waymarks): reflections controller state machine + sequential backfill loop"
```

---

## Task 14: The `useReflections` hook

**Files:**
- Create: `src/notepad/hooks/useReflections.ts`
- Test: `src/notepad/hooks/useReflections.test.ts`

**Interfaces:**
- Produces: `useReflections(args: UseReflectionsArgs): UseReflectionsResult`, `UseReflectionsArgs`, `UseReflectionsResult`.
- Consumes: `ReflectionsController` / `ReflectionsDeps` / `ReflectionsState` (Task 13); `LamplightAdapter` (Task 11); React `useMemo`/`useEffect`/`useCallback`/`useSyncExternalStore`.

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING C item 3 — `useTodaysLamp.ts` is the exemplar):**
- `useMemo` builds the deps inline (adapter-bound arrows) + `new ReflectionsController(deps)`, keyed `[adapter]` — a stable adapter keeps ONE controller for the component's life; a new adapter (rare) rebuilds.
- `useSyncExternalStore(controller.subscribe, controller.getSnapshot)` — both are arrow props on `Observable`, safe to pass by reference (no re-subscribe churn).
- `setInputs` effect keyed `[controller, userId, periodKey, autoGenerate]`. **Path mode:** when `periodKey` is `undefined` (the list view uses the hook only for `backfill()`), the effect returns early — the controller never retrieves a phantom detail and stays `idle`.
- Cleanup-only effect `() => () => controller.dispose()` keyed `[controller]`.
- `start`/`retry`/`backfill` = `useCallback` passthroughs; `backfill` → `controller.startBackfill(userId)` (returns the promise so callers can `await` then repaint).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/hooks/useReflections.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useReflections } from './useReflections';
import { FakeLamplightAdapter } from '../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../storage/lamplight-artifacts';

const artifact: ReflectionArtifact = {
  title: 'The month you kept showing up',
  letter: 'You came back to the same handful of verses more than once.',
  markers: [{ date: '2026-05-04', verse: 'Psalm 42:5', phrase: 'you asked why you were downcast' }],
};

describe('useReflections', () => {
  it('detail mode: retrieves an existing reflection into ready', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedReflection('u', {
      periodKey: '2026-05', title: artifact.title, artifact,
      createdAt: '2026-05-01T12:00:00.000Z', savedToNotes: false,
    });
    const { result } = renderHook(() => useReflections({ adapter, userId: 'u', periodKey: '2026-05' }));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    expect(result.current.state).toMatchObject({ phase: 'ready', record: { periodKey: '2026-05' } });
  });

  it('detail mode: generates when none exists and autoGenerate is on (default)', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    const { result } = renderHook(() => useReflections({ adapter, userId: 'u', periodKey: '2026-06' }));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  });

  it('detail mode: autoGenerate=false stays idle until start()', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    const { result } = renderHook(() =>
      useReflections({ adapter, userId: 'u', periodKey: '2026-06', autoGenerate: false }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  });

  it('path mode: no periodKey stays idle; backfill() walks the seeded targets and paints stones', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__setBackfillTargets('u', ['2026-04', '2026-03']);
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    adapter.__queueReflectionResult({ ok: true, artifact, cached: false });
    const { result } = renderHook(() => useReflections({ adapter, userId: 'u' }));
    expect(result.current.state.phase).toBe('idle');
    await act(async () => { await result.current.backfill(); });
    expect(await adapter.listReflections('u')).toHaveLength(2); // both months now have artifact rows
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/hooks/useReflections.test.ts`
Expected: FAIL — `Cannot find module './useReflections'`.

- [ ] **Step 3: Implement the hook**

Create `src/notepad/hooks/useReflections.ts`:

```typescript
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  ReflectionsController,
  type ReflectionsDeps,
  type ReflectionsState,
} from '../lamplight/reflections-controller';
import type { LamplightAdapter } from '../storage/lamplight-adapter';

export interface UseReflectionsArgs {
  adapter: LamplightAdapter;
  userId: string;
  /** Detail mode when set ('YYYY-MM'). Omitted → Path mode (list); the hook is used only for backfill(). */
  periodKey?: string;
  /** Detail mode: retrieve-or-generate on mount. Ignored in Path mode. Default true. */
  autoGenerate?: boolean;
}

export interface UseReflectionsResult {
  state: ReflectionsState;
  start: () => void;
  retry: () => void;
  backfill: () => Promise<void>;
}

export function useReflections({
  adapter,
  userId,
  periodKey,
  autoGenerate = true,
}: UseReflectionsArgs): UseReflectionsResult {
  const controller = useMemo(() => {
    const deps: ReflectionsDeps = {
      getExisting: (uid, pk) => adapter.getReflection(uid, pk),
      generate: (uid, pk) => adapter.generateMonthlyReflection(uid, pk),
      listBackfillTargets: (uid) => adapter.listBackfillTargets(uid),
    };
    return new ReflectionsController(deps);
  }, [adapter]);

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    if (!periodKey) return; // Path mode: no detail to retrieve — controller stays idle.
    controller.setInputs({ userId, periodKey, autoGenerate });
  }, [controller, userId, periodKey, autoGenerate]);

  useEffect(() => () => controller.dispose(), [controller]);

  const start = useCallback(() => controller.start(), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const backfill = useCallback(() => controller.startBackfill(userId), [controller, userId]);

  return { state, start, retry, backfill };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/notepad/hooks/useReflections.test.ts`
Expected: PASS (4 tests) — detail retrieve, detail generate, deferred start, and Path-mode backfill.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/hooks/useReflections.ts src/notepad/hooks/useReflections.test.ts
git commit -m "feat(waymarks): useReflections hook (detail retrieve/generate + path backfill)"
```

---

## Task 15: Routes + `WaymarksReflections` (The Path)

**Files:**
- Edit: `src/App.tsx` (two lazy imports + a nested route block)
- Create: `src/notepad/components/waymarks/waymarks.css` (palette/type tokens — §13.5 — grain, dark mode, reduced-motion)
- Create: `src/notepad/components/waymarks/Stone.tsx` (the equal-dignity ellipse stone; reused by Tasks 16/18)
- Create: `src/notepad/components/waymarks/WaymarksReflections.tsx` (The Path)
- Create: `src/notepad/components/waymarks/WaymarksLockedPreview.tsx` (the invitation — §13.4)
- Create: `src/notepad/components/waymarks/waymarks-routes.tsx` (the connectors — the ONLY app-wiring seam)
- Test: `src/notepad/components/waymarks/WaymarksReflections.test.tsx`

**Interfaces:**
- Produces: `WaymarksReflections({ adapter, userId, canAccess })`, `Stone`, `WaymarksLockedPreview`, and the route connectors `WaymarksReflectionsRoute`/`WaymarksPeriodDetailRoute`.
- Consumes: `useReflections` (Task 14); `LamplightAdapter`/`ReflectionListItem` (Task 11); `react-router-dom` `Link`.

**Grounding (verified — do not re-explore; handoff part 11 §GROUNDING C items 8/9/12 + §13.5 palette + decision 6):**
- The components are **prop-driven and pure** (`{ adapter, userId, canAccess }`) so they unit-test with `FakeLamplightAdapter` + `MemoryRouter`. ALL app wiring is isolated to `waymarks-routes.tsx`, which resolves `adapter`/`userId`/`canAccess` exactly as `Notepad.tsx` does (item 12: `new SupabaseLamplightAdapter(supabase)` guarded on `supabase`; the signed-in user id; `useLamplightEntitlement().hasAccess('reflections')` — item 9). **Those three imports are the only integration seam; confirm their exact module paths against `Notepad.tsx` during execution — everything else is complete.**
- `App.tsx` mirrors the existing `/notebook/notes` nesting under `LocalNotepadLayout` (item 8): `/notebook/reflections` (index → The Path) + `/notebook/reflections/:periodKey` (→ detail, Task 16), both lazy-loaded like `NotepadWorkspace`.
- **Decision 6 (equal dignity):** every stone is the SAME ellipse (rx 58 × ry 30) — NEVER sized, numbered, or ordered by note volume. Only a small deterministic rotation (from the period key) distinguishes them. Year dividers are **plain year labels** for MVP (the `cairn` yearly-grouping visual is fast-follow, deliberately NOT built here).
- `listReflections` already returns newest-first and left-joins hide/annotate state; The Path filters `hiddenAt !== null` out of the walk and reveals them under the "Hidden stones" foot affordance (Task 17 wires "Restore this stone.").
- Copy is verbatim §13.6; palette/type via the CSS custom properties in `waymarks.css`.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/components/waymarks/WaymarksReflections.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, userId: string, periodKey: string) {
  a.__seedReflection(userId, {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}
const renderPath = (a: FakeLamplightAdapter, canAccess = true) =>
  render(
    <MemoryRouter>
      <WaymarksReflections adapter={a} userId="u" canAccess={canAccess} />
    </MemoryRouter>,
  );

describe('WaymarksReflections (The Path)', () => {
  it('renders visible stones newest-first with plain year dividers', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, 'u', '2025-11'); seed(a, 'u', '2026-01'); seed(a, 'u', '2026-05');
    renderPath(a);
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    const may = screen.getByText('May 2026');
    const jan = screen.getByText('January 2026');
    // newest-first: May 2026 appears before January 2026 in document order
    expect(may.compareDocumentPosition(jan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits hidden stones from the walk but reveals them under "Hidden stones"', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, 'u', '2026-04'); seed(a, 'u', '2026-05');
    await a.setReflectionHidden('u', 'reflection_recap', '2026-04', true);
    renderPath(a);
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.queryByText('April 2026')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hidden stones' }));
    expect(screen.getByText('April 2026')).toBeInTheDocument();
  });

  it('shows the invitation (not a paywall) for a never-subscribed user with no stones', async () => {
    const a = new FakeLamplightAdapter();
    renderPath(a, false);
    await waitFor(() => expect(screen.getByText('See your own months marked')).toBeInTheDocument());
  });

  it('backfills missing months on first open, then repaints the new stone', async () => {
    const a = new FakeLamplightAdapter();
    a.__setBackfillTargets('u', ['2026-03']);
    a.__queueReflectionResult({ ok: true, artifact: art, cached: false });
    renderPath(a);
    await waitFor(() => expect(screen.getByText('March 2026')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/components/waymarks/WaymarksReflections.test.tsx`
Expected: FAIL — `Cannot find module './WaymarksReflections'`.

- [ ] **Step 3: Create the palette/type stylesheet**

Create `src/notepad/components/waymarks/waymarks.css` (single source of truth for the §13.5 tokens; SVG fills read the same CSS variables):

```css
/* Waymarks — The Path. Palette + type locked to §13.5 (mirrors src/index.css tokens). */
.wm-root {
  --wm-plaster: #F0ECE8;
  --wm-umber: #3A3426;
  --wm-gold: #C49A78;
  --wm-silica: #8A8B90;
  --wm-hairline: #CECCCA;
  --wm-stone-1: #DCCFBF;
  --wm-stone-2: #D3C6B4;
  --wm-stone-3: #CBBBA5;
  --wm-stone-stroke: #A89A87;
  --wm-letter: #FAF7F3;
  --wm-serif: 'Cormorant Garamond', Georgia, serif;
  --wm-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --wm-caption: Georgia, 'Times New Roman', serif;

  position: relative;
  min-height: 100%;
  padding: 2.5rem 1.25rem 4rem;
  background: var(--wm-plaster);
  color: var(--wm-umber);
  font-family: var(--wm-sans);
  overflow-x: hidden;
}
@media (prefers-color-scheme: dark) {
  .wm-root {
    --wm-plaster: #0a0a0a;
    --wm-umber: #efedee;
    --wm-gold: #c4b5a0;
    --wm-silica: #7d7e83;
    --wm-hairline: #2a2622;
    --wm-stone-1: #2a2620;
    --wm-stone-2: #322d26;
    --wm-stone-3: #3a342c;
    --wm-stone-stroke: #6b6153;
    --wm-letter: #141210;
  }
}
/* Fine grain over the whole surface — paper in light, stone in dark. */
.wm-root::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}
.wm-root > * { position: relative; } /* keep content above the grain */

.wm-title { font-family: var(--wm-serif); font-style: italic; font-weight: 500; line-height: 1.15; }
.wm-label { font-family: var(--wm-sans); text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.72rem; color: var(--wm-silica); }
.wm-caption { font-family: var(--wm-caption); font-style: italic; color: var(--wm-silica); }

.wm-path { list-style: none; margin: 2rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 1.75rem; }
.wm-year { font-family: var(--wm-serif); font-style: italic; font-size: 1.25rem; color: var(--wm-silica); border-top: 1px solid var(--wm-hairline); padding-top: 1rem; }
.wm-path__node { display: flex; }
.wm-stone-link { display: inline-flex; flex-direction: column; align-items: center; gap: 0.35rem; text-decoration: none; color: inherit; }
.wm-stone { display: block; }
.wm-stone__seal { opacity: 0.22; animation: wm-seal-pulse 6s ease-in-out infinite; }

.wm-hidden { margin-top: 3rem; border-top: 1px solid var(--wm-hairline); padding-top: 1rem; }
.wm-hidden__toggle { background: none; border: none; cursor: pointer; padding: 0.25rem 0; }
.wm-hidden__list { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }

.wm-locked { max-width: 32rem; margin: 0 auto; text-align: center; }
.wm-locked__title { font-size: 2rem; margin: 0.5rem 0 1rem; }
.wm-locked__body { font-size: 1.05rem; line-height: 1.6; display: block; margin-bottom: 2rem; }
.wm-locked__example { list-style: none; display: flex; justify-content: center; gap: 0.5rem; padding: 0; margin: 0 0 2rem; }
.wm-locked__node { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; }
.wm-locked__cta { display: inline-block; color: var(--wm-gold); text-decoration: none; border-bottom: 1px solid var(--wm-gold); padding-bottom: 2px; }

@keyframes wm-seal-pulse { 0%, 100% { opacity: 0.22; } 50% { opacity: 0.34; } }
@keyframes wm-fade-in { from { opacity: 0; } to { opacity: 1; } }
.wm-fade { animation: wm-fade-in 0.6s ease both; }
@media (prefers-reduced-motion: reduce) {
  .wm-stone__seal { animation: none; }
  .wm-fade { animation: none; }
}
```

- [ ] **Step 4: Create the Stone**

Create `src/notepad/components/waymarks/Stone.tsx` (pure SVG — the caller supplies the interactive wrapper so we never nest a button inside a link):

```tsx
export interface StoneProps {
  /** Accessible name, e.g. 'May 2026'. */
  label: string;
  /** Small deterministic tilt, degrees (−5..+5). */
  rotation?: number;
  /** One of --wm-stone-1/2/3. */
  fillVar?: string;
  /** Arrival: unopened newest month shows the seal motif (Task 18). */
  sealed?: boolean;
  /** Opening ceremony: the seal reads broken (Task 16). */
  broken?: boolean;
}

export function Stone({ label, rotation = 0, fillVar = '--wm-stone-1', sealed = false, broken = false }: StoneProps) {
  return (
    <svg
      className="wm-stone"
      width="128"
      height="72"
      viewBox="0 0 128 72"
      role="img"
      aria-label={label}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <title>{label}</title>
      {/* Equal dignity (decision 6): identical rx/ry for every stone, regardless of content. */}
      <ellipse cx="64" cy="36" rx="58" ry="30" fill={`var(${fillVar})`} stroke="var(--wm-stone-stroke)" strokeWidth="1" />
      {sealed && !broken && (
        <g>
          <circle className="wm-stone__seal" cx="64" cy="36" r="9" fill="none" stroke="var(--wm-gold)" strokeWidth="1" />
          <circle cx="64" cy="36" r="4.5" fill="var(--wm-gold)" />
        </g>
      )}
      {broken && <line x1="64" y1="26" x2="64" y2="46" stroke="var(--wm-gold)" strokeWidth="1" opacity="0.5" />}
    </svg>
  );
}
```

- [ ] **Step 5: Create the locked preview (the invitation — §13.4)**

Create `src/notepad/components/waymarks/WaymarksLockedPreview.tsx`:

```tsx
import './waymarks.css';
import { Stone } from './Stone';

// §13.4 — an invitation, NOT a paywall: an evocative paragraph, a ghosted (labeled) example path,
// and ONE quiet affordance. No counts, no feature grid, no "unlock N months".
const EXAMPLE_MONTHS = ['January', 'February', 'March'];

export function WaymarksLockedPreview() {
  return (
    <div className="wm-root">
      <div className="wm-locked">
        <p className="wm-label">The Path</p>
        <h1 className="wm-title wm-locked__title">A path made of the months you’ve kept</h1>
        <p className="wm-locked__body wm-caption">
          Each month you write, Lamplight sets down a stone — a quiet letter about where you walked
          and the verses that walked with you. Over time they become a path you can turn around and see.
        </p>
        <ul className="wm-locked__example" aria-hidden="true">
          {EXAMPLE_MONTHS.map((m, i) => (
            <li key={m} className="wm-locked__node" style={{ opacity: 0.35 }}>
              <Stone label={`${m} — example`} rotation={(i - 1) * 4} fillVar={`--wm-stone-${(i % 3) + 1}`} />
              <span className="wm-caption">{m}</span>
            </li>
          ))}
        </ul>
        {/* Upgrade affordance — confirm the app's Plus-upgrade route during execution (seam). */}
        <a className="wm-locked__cta wm-label" href="/settings/lamplight">See your own months marked</a>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create The Path**

Create `src/notepad/components/waymarks/WaymarksReflections.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './waymarks.css';
import { Stone } from './Stone';
import { WaymarksLockedPreview } from './WaymarksLockedPreview';
import { useReflections } from '../../hooks/useReflections';
import type { LamplightAdapter, ReflectionListItem } from '../../storage/lamplight-adapter';

export interface WaymarksReflectionsProps {
  adapter: LamplightAdapter;
  userId: string;
  canAccess: boolean;
}

const STONE_FILLS = ['--wm-stone-1', '--wm-stone-2', '--wm-stone-3'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Deterministic tilt from the period key — a stone never jitters between renders.
function rotationFor(periodKey: string): number {
  let h = 0;
  for (const ch of periodKey) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return (h % 11) - 5; // −5..+5 deg
}
function monthLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}
const yearOf = (periodKey: string) => periodKey.slice(0, 4);

type Row =
  | { type: 'year'; year: string }
  | { type: 'stone'; item: ReflectionListItem; index: number };

export function WaymarksReflections({ adapter, userId, canAccess }: WaymarksReflectionsProps) {
  const [items, setItems] = useState<ReflectionListItem[] | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const { state, backfill } = useReflections({ adapter, userId }); // Path mode (no periodKey)

  const reload = useCallback(async () => {
    setItems(await adapter.listReflections(userId));
  }, [adapter, userId]);

  useEffect(() => { void reload(); }, [reload]);

  // First Plus open backfills the months behind you, then repaints (§8). listBackfillTargets is
  // the artifact-table checklist, so after the first pass it returns [] and this is a cheap no-op.
  useEffect(() => {
    if (!canAccess) return;
    let alive = true;
    void (async () => {
      await backfill();
      if (alive) await reload();
    })();
    return () => { alive = false; };
  }, [canAccess, backfill, reload]);

  if (items === null) {
    return (
      <div className="wm-root">
        <p className="wm-caption">Finding your path…</p>
      </div>
    );
  }

  const visible = items.filter((i) => i.hiddenAt === null);
  const hidden = items.filter((i) => i.hiddenAt !== null);

  // Never subscribed and nothing to show → the invitation. (Task 19 adds the downgrade branch:
  // !canAccess but visible.length > 0 keeps the stones readable with a quiet head-note.)
  if (!canAccess && visible.length === 0) {
    return <WaymarksLockedPreview />;
  }

  const rows: Row[] = [];
  let lastYear = '';
  visible.forEach((item, index) => {
    const y = yearOf(item.periodKey);
    if (y !== lastYear) { rows.push({ type: 'year', year: y }); lastYear = y; }
    rows.push({ type: 'stone', item, index });
  });

  return (
    <div className="wm-root">
      <header>
        <p className="wm-label">The Path</p>
        <h1 className="wm-title" style={{ fontSize: '2rem', margin: '0.25rem 0 0' }}>
          The months you’ve walked
        </h1>
        {state.phase === 'backfilling' && (
          <p className="wm-caption" aria-live="polite">{state.message}</p>
        )}
      </header>

      <ol className="wm-path" aria-label="Your reflections, newest first">
        {rows.map((row) =>
          row.type === 'year' ? (
            <li key={`year-${row.year}`} className="wm-year" aria-hidden="true">{row.year}</li>
          ) : (
            <li
              key={row.item.periodKey}
              className="wm-path__node"
              style={{ marginLeft: `${((row.index % 5) - 2) * 16}px` }} // gentle meander
            >
              <Link
                to={`/notebook/reflections/${row.item.periodKey}`}
                className="wm-stone-link"
                aria-label={`${monthLabel(row.item.periodKey)}${row.item.annotation ? ', annotated' : ''}`}
              >
                <Stone
                  label={monthLabel(row.item.periodKey)}
                  rotation={rotationFor(row.item.periodKey)}
                  fillVar={STONE_FILLS[row.index % STONE_FILLS.length]}
                />
                <span className="wm-caption">{monthLabel(row.item.periodKey)}</span>
              </Link>
            </li>
          ),
        )}
      </ol>

      {hidden.length > 0 && (
        <div className="wm-hidden">
          <button
            type="button"
            className="wm-hidden__toggle wm-label"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
          >
            Hidden stones
          </button>
          {showHidden && (
            <ul className="wm-hidden__list">
              {hidden.map((item) => (
                <li key={item.periodKey} className="wm-hidden__item wm-caption">
                  {monthLabel(item.periodKey)}
                  {/* Task 17 adds the "Restore this stone." action here. */}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create the route connectors (the wiring seam)**

Create `src/notepad/components/waymarks/waymarks-routes.tsx`. These three imports are the ONLY app-specific wiring — confirm each module path against `Notepad.tsx` (part 11 §GROUNDING C items 9/12) during execution:

```tsx
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';                       // SAME client import Notepad.tsx uses (seam)
import { SupabaseLamplightAdapter } from '../../storage/supabase-lamplight-adapter';
import { useLamplightEntitlement } from '../../lamplight/useLamplightEntitlement'; // seam (item 9)
import { useAuthUserId } from '@/auth/useAuthUserId';            // the signed-in user id — mirror Notepad's source (seam)
import { WaymarksReflections } from './WaymarksReflections';
import { WaymarksPeriodDetail } from './WaymarksPeriodDetail';   // Task 16

function useWaymarksConnection() {
  const adapter = useMemo(() => (supabase ? new SupabaseLamplightAdapter(supabase) : null), []);
  const userId = useAuthUserId();
  const { hasAccess } = useLamplightEntitlement();
  return { adapter, userId, canAccess: hasAccess('reflections') };
}

export function WaymarksReflectionsRoute() {
  const { adapter, userId, canAccess } = useWaymarksConnection();
  if (!adapter || !userId) return null; // logged-out / no client → mirror Notepad's null-guard
  return <WaymarksReflections adapter={adapter} userId={userId} canAccess={canAccess} />;
}

export function WaymarksPeriodDetailRoute() {
  const { adapter, userId, canAccess } = useWaymarksConnection();
  if (!adapter || !userId) return null;
  return <WaymarksPeriodDetail adapter={adapter} userId={userId} canAccess={canAccess} />;
}
```

- [ ] **Step 8: Wire the routes into `App.tsx`**

Add the two lazy imports beside the existing ones (mirror the `NotepadWorkspace` lazy pattern, item 8):

```tsx
const WaymarksReflectionsRoute = lazy(() =>
  import('@/notepad/components/waymarks/waymarks-routes').then((m) => ({ default: m.WaymarksReflectionsRoute })),
);
const WaymarksPeriodDetailRoute = lazy(() =>
  import('@/notepad/components/waymarks/waymarks-routes').then((m) => ({ default: m.WaymarksPeriodDetailRoute })),
);
```

Add the nested route block beside the `/notebook/notes` route (same `LocalNotepadLayout` parent, item 8):

```tsx
<Route path="/notebook/reflections" element={<LocalNotepadLayout />}>
  <Route index element={<WaymarksReflectionsRoute />} />
  <Route path=":periodKey" element={<WaymarksPeriodDetailRoute />} />
</Route>
```

- [ ] **Step 9: Run the test + typecheck**

Run: `npx vitest run src/notepad/components/waymarks/WaymarksReflections.test.tsx`
Expected: PASS (4 tests). Then `npx tsc --noEmit` — expect PASS **except** a known unresolved import of `./WaymarksPeriodDetail` in `waymarks-routes.tsx` (created in Task 16). Either land Step 7's `WaymarksPeriodDetailRoute` + its App route in Task 16, or add a `// @ts-expect-error pending Task 16` on that import; close the gap in Task 16. The three seam imports (`@/lib/supabase`, `useLamplightEntitlement`, `useAuthUserId`) must resolve to the real modules `Notepad.tsx` uses.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/notepad/components/waymarks/waymarks.css src/notepad/components/waymarks/Stone.tsx src/notepad/components/waymarks/WaymarksReflections.tsx src/notepad/components/waymarks/WaymarksLockedPreview.tsx src/notepad/components/waymarks/waymarks-routes.tsx src/notepad/components/waymarks/WaymarksReflections.test.tsx
git commit -m "feat(waymarks): The Path route + equal-dignity stones + locked invitation"
```

---

## Task 16: `WaymarksPeriodDetail` — the opened stone (letter + markers + ceremony)

**Files:**
- Edit: `src/notepad/components/waymarks/waymarks.css` (append the detail/letter/marker/ceremony/affordance classes)
- Create: `src/notepad/components/waymarks/ReflectionLetter.tsx` (title + letter paragraphs + the "Your words" aside)
- Create: `src/notepad/components/waymarks/MarkerPath.tsx` ("THE MOMENTS, MARKED")
- Create: `src/notepad/components/waymarks/WaymarksPeriodDetail.tsx` (the detail route body + opening ceremony)
- Test: `src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx`

**Interfaces:**
- Produces: `WaymarksPeriodDetail({ adapter, userId, canAccess })`, `ReflectionLetter`, `MarkerPath`. **Closes the Task-15 tsc gap** — creating `WaymarksPeriodDetail.tsx` makes `waymarks-routes.tsx`'s `import { WaymarksPeriodDetail } from './WaymarksPeriodDetail'` resolve.
- Consumes: `useReflections` (Task 14, detail mode); `Stone` (Task 15); `ReflectionArtifact`/`Marker` (`../../storage/lamplight-artifacts`, Task 2 re-export); `LamplightAdapter`/`ReflectionRecord`/`ReflectionState` (Task 11); `usePrefersReducedMotion` (`../../hooks/use-prefers-reduced-motion` — seam, item 10); `react-router-dom` `useParams`/`Link`.

**Grounding (verified — do not re-explore; handoff part 16 BOUNDARY DECISIONS 2/3/4 + part 12 decision 9):**
- Prop-driven and pure (`{ adapter, userId, canAccess }`) + `const { periodKey = '' } = useParams()` so the component unit-tests with `FakeLamplightAdapter` + `MemoryRouter`/`Routes`. `canAccess` is accepted for connector parity (the Task-15 `WaymarksPeriodDetailRoute` passes all three); the detail body does **not** gate on it — annotate/hide/save stay available on downgrade (decision 1). Detail mode: `useReflections({ adapter, userId, periodKey })` (autoGenerate defaults true — an unopened month generates on first visit).
- **Opening ceremony (decision 9):** when `state.phase === 'ready'` and the stone has not been opened and reduced-motion is **off**, render a tappable seal cover — a `<button>` "Break the seal" wrapping `<Stone sealed />` (Stone.tsx's caller-supplies-the-wrapper contract; never nest a button in a link). Click → `markOpened(periodKey); setOpened(true)`. With reduced-motion **on**, skip the ceremony and show the letter directly under a `wm-fade` crossfade (which reduced-motion neutralises to an instant swap). "Opened" has **no DB column** → persist in `localStorage` under `wm-opened:<periodKey>` via the local `hasBeenOpened`/`markOpened` helpers, so the seal never replays. MVP-clean, no migration.
- **Annotation is a separate aside (decision 3, §17):** `ReflectionLetter` renders the user's `annotation` (loaded from `getReflectionState(userId, 'reflection_recap', periodKey)`) as a distinct "Your words" block — it NEVER replaces `artifact.letter`. Task 16 renders it read-only; Task 17 makes it editable.
- **Static affordances (decision 2):** the dashed "＋ Add your words." box and the "Save to notes · Hide this stone" footer render as **static visual elements with real §13.6 copy and NO onClick handlers**. Task 17 replaces this exact region with adapter-wired controls.
- `monthLabel`/`rotationFor` are duplicated here as tiny pure deterministic helpers (identical to `WaymarksReflections`'s) rather than rewriting Task 15 — safe to extract to a shared `waymarks-format.ts` in a later cleanup. Phase copy is verbatim §13.6.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WaymarksPeriodDetail } from './WaymarksPeriodDetail';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const artifact: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling one decision, turning it over on the drive to work and again before sleep.\n\n' +
    'On the twelfth something in you set it down — not because the answer arrived, but because you were ready to stop.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function seedReady(a: FakeLamplightAdapter, periodKey = '2026-05') {
  a.__seedReflection('u', {
    periodKey, title: artifact.title, artifact,
    createdAt: `${periodKey}-31T09:00:00.000Z`, savedToNotes: false,
  });
}

// jsdom has no matchMedia; usePrefersReducedMotion reads it. Stub per-test.
function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  })) as unknown as typeof window.matchMedia;
}

const renderDetail = (a: FakeLamplightAdapter, periodKey = '2026-05', canAccess = true) =>
  render(
    <MemoryRouter initialEntries={[`/notebook/reflections/${periodKey}`]}>
      <Routes>
        <Route
          path="/notebook/reflections/:periodKey"
          element={<WaymarksPeriodDetail adapter={a} userId="u" canAccess={canAccess} />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('WaymarksPeriodDetail (the opened stone)', () => {
  beforeEach(() => {
    localStorage.clear();
    setReducedMotion(false);
  });

  it('shows the seal, then reveals the letter + markers when broken', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderDetail(a);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Break the seal' })).toBeInTheDocument());
    // Letter is still sealed.
    expect(screen.queryByText(artifact.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }));
    expect(screen.getByText(artifact.title)).toBeInTheDocument();
    expect(screen.getByText('THE MOMENTS, MARKED')).toBeInTheDocument();
    expect(screen.getByText('Ps 27:14')).toBeInTheDocument();
    // The affordances render as static copy (Task 17 wires them).
    expect(screen.getByText('＋ Add your words.')).toBeInTheDocument();
    expect(screen.getByText('Save to notes · Hide this stone')).toBeInTheDocument();
    // Opened is persisted so the ceremony never replays.
    expect(localStorage.getItem('wm-opened:2026-05')).toBe('1');
  });

  it('reveals the letter directly when the stone was already opened', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    localStorage.setItem('wm-opened:2026-05', '1');
    renderDetail(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Break the seal' })).not.toBeInTheDocument();
  });

  it('skips the ceremony under reduced motion and shows the letter directly', async () => {
    setReducedMotion(true);
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderDetail(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Break the seal' })).not.toBeInTheDocument();
  });

  it('renders the user annotation as a separate "Your words" aside, not in place of the letter', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    await a.setReflectionAnnotation('u', 'reflection_recap', '2026-05', 'I remember the drive.');
    localStorage.setItem('wm-opened:2026-05', '1');
    renderDetail(a);
    await waitFor(() => expect(screen.getByText('Your words')).toBeInTheDocument());
    expect(screen.getByText('I remember the drive.')).toBeInTheDocument();
    // The original letter is still present alongside it.
    expect(screen.getByText(artifact.title)).toBeInTheDocument();
  });

  it('shows the empty-month copy when the month has nothing written', async () => {
    const a = new FakeLamplightAdapter();
    a.__queueReflectionResult({ ok: false, reason: 'no_notes' }); // → controller phase 'empty'
    renderDetail(a);
    await waitFor(() => expect(screen.getByText('Nothing was written here.')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: '← The Path' })).toBeInTheDocument();
  });

  it('shows the retry affordance when the stone is not ready', async () => {
    const a = new FakeLamplightAdapter();
    a.__queueReflectionResult({ ok: false, reason: 'network' }); // → phase 'unavailable' | 'error'
    renderDetail(a);
    await waitFor(() => expect(screen.getByText("This one isn't ready yet. Try again.")).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx`
Expected: FAIL — `Cannot find module './WaymarksPeriodDetail'`.

- [ ] **Step 3: Append the detail/letter/marker styles to `waymarks.css`**

Append to `src/notepad/components/waymarks/waymarks.css` (same §13.5 tokens; the letter sits on `--wm-letter`):

```css
/* ── Detail (the opened stone) ─────────────────────────────────────────────── */
.wm-detail { max-width: 40rem; margin: 0 auto; }
.wm-back { display: inline-block; margin-bottom: 1.5rem; color: var(--wm-silica); text-decoration: none; }
.wm-back:hover { color: var(--wm-umber); }
.wm-detail__status { margin-top: 3rem; text-align: center; }
.wm-detail__actions { margin-top: 1rem; display: flex; gap: 1rem; justify-content: center; align-items: center; }
.wm-detail__retry { background: none; border: 1px solid var(--wm-hairline); border-radius: 999px; padding: 0.4rem 1.1rem; cursor: pointer; color: var(--wm-umber); font: inherit; }

/* Opening ceremony — a tappable seal cover. */
.wm-seal-cover { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; margin: 3rem auto 0; background: none; border: none; cursor: pointer; padding: 1.5rem; }
.wm-seal-cover:hover .wm-stone__seal { opacity: 0.4; }

/* The letter. */
.wm-letter { background: var(--wm-letter); border: 1px solid var(--wm-hairline); border-radius: 4px; padding: 2.5rem 2rem; }
.wm-letter__title { font-size: 1.9rem; margin: 0 0 1.5rem; }
.wm-letter__body { font-size: 1.05rem; line-height: 1.7; margin: 0 0 1.1rem; }
.wm-annotation { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--wm-hairline); }
.wm-annotation__text { font-size: 1rem; line-height: 1.6; margin: 0.35rem 0 0; }

/* The markers. */
.wm-markers { margin-top: 2.5rem; }
.wm-markers__head { margin: 0 0 1rem; }
.wm-markers__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1.5rem; }
.wm-marker { display: flex; flex-direction: column; gap: 0.35rem; border-left: 2px solid var(--wm-hairline); padding-left: 1rem; }
.wm-marker__date { color: var(--wm-silica); }
.wm-marker__verse { font-size: 1.2rem; }
.wm-marker__phrase { font-size: 1rem; }

/* Affordances — static in Task 16, wired in Task 17. */
.wm-annotate { margin-top: 2.5rem; border: 1px dashed var(--wm-hairline); border-radius: 4px; padding: 1.1rem 1.25rem; }
.wm-annotate__prompt { display: block; }
.wm-detail__footer { margin-top: 1.5rem; text-align: center; }
```

- [ ] **Step 4: Create `ReflectionLetter`**

Create `src/notepad/components/waymarks/ReflectionLetter.tsx`:

```tsx
import './waymarks.css';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

export interface ReflectionLetterProps {
  artifact: ReflectionArtifact;
  /** The user's own note on this month (§17) — rendered as a SEPARATE aside, never replacing the letter. */
  annotation?: string | null;
}

// The letter is prose with blank-line paragraph breaks; split on 2+ newlines.
export function ReflectionLetter({ artifact, annotation }: ReflectionLetterProps) {
  const paragraphs = artifact.letter.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const hasAnnotation = typeof annotation === 'string' && annotation.trim().length > 0;
  return (
    <article className="wm-letter">
      <h1 className="wm-title wm-letter__title">{artifact.title}</h1>
      {paragraphs.map((p, i) => (
        <p key={i} className="wm-letter__body">{p}</p>
      ))}
      {hasAnnotation && (
        <aside className="wm-annotation" aria-label="Your words">
          <p className="wm-label">Your words</p>
          <p className="wm-annotation__text wm-caption">{annotation}</p>
        </aside>
      )}
    </article>
  );
}
```

- [ ] **Step 5: Create `MarkerPath`**

Create `src/notepad/components/waymarks/MarkerPath.tsx`:

```tsx
import './waymarks.css';
import type { Marker } from '../../storage/lamplight-artifacts';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-05-12' → 'May 12'. Pure, local to the marker path.
function markerDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${MONTHS_SHORT[Number(m) - 1] ?? ''} ${Number(d)}`;
}

export interface MarkerPathProps {
  markers: Marker[];
}

export function MarkerPath({ markers }: MarkerPathProps) {
  if (markers.length === 0) return null;
  return (
    <section className="wm-markers" aria-label="The moments, marked">
      <p className="wm-label wm-markers__head">THE MOMENTS, MARKED</p>
      <ol className="wm-markers__list">
        {markers.map((m, i) => (
          <li key={i} className="wm-marker">
            <span className="wm-marker__date wm-label">
              {markerDate(m.date)}{m.date_end ? ` – ${markerDate(m.date_end)}` : ''}
            </span>
            {m.verse && <span className="wm-marker__verse wm-title">{m.verse}</span>}
            <span className="wm-marker__phrase wm-caption">{m.phrase}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 6: Create `WaymarksPeriodDetail`**

Create `src/notepad/components/waymarks/WaymarksPeriodDetail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import './waymarks.css';
import { Stone } from './Stone';
import { ReflectionLetter } from './ReflectionLetter';
import { MarkerPath } from './MarkerPath';
import { useReflections } from '../../hooks/useReflections';
import { usePrefersReducedMotion } from '../../hooks/use-prefers-reduced-motion'; // seam (item 10)
import type { LamplightAdapter } from '../../storage/lamplight-adapter';

export interface WaymarksPeriodDetailProps {
  adapter: LamplightAdapter;
  userId: string;
  /** Accepted for connector parity; the detail body never gates on it (decision 1). */
  canAccess: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}
function rotationFor(periodKey: string): number {
  let h = 0;
  for (const ch of periodKey) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return (h % 11) - 5;
}

// "Opened" has no DB column (decision 4) — persist it in localStorage so the seal
// ceremony plays exactly once per stone.
const openedKey = (periodKey: string) => `wm-opened:${periodKey}`;
function hasBeenOpened(periodKey: string): boolean {
  try { return localStorage.getItem(openedKey(periodKey)) === '1'; } catch { return false; }
}
function markOpened(periodKey: string): void {
  try { localStorage.setItem(openedKey(periodKey), '1'); } catch { /* private mode — ceremony just replays */ }
}

export function WaymarksPeriodDetail({ adapter, userId }: WaymarksPeriodDetailProps) {
  const { periodKey = '' } = useParams();
  const reduce = usePrefersReducedMotion();
  const { state, retry } = useReflections({ adapter, userId, periodKey });
  const [opened, setOpened] = useState(() => hasBeenOpened(periodKey));
  const [annotation, setAnnotation] = useState<string | null>(null);

  // Load the satellite annotation state (§17 aside) once we know the period.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await adapter.getReflectionState(userId, 'reflection_recap', periodKey);
      if (alive) setAnnotation(s?.annotation ?? null); // getReflectionState → ReflectionState | null
    })();
    return () => { alive = false; };
  }, [adapter, userId, periodKey]);

  const back = (
    <Link to="/notebook/reflections" className="wm-back wm-label">← The Path</Link>
  );

  // Non-ready phases (§13.6 copy). retrieving/generating/refining stream a quiet caption.
  if (state.phase !== 'ready') {
    let body: JSX.Element;
    if (state.phase === 'empty') {
      body = <p className="wm-caption">Nothing was written here.</p>;
    } else if (state.phase === 'unavailable' || state.phase === 'error') {
      body = (
        <div>
          <p className="wm-caption">This one isn't ready yet. Try again.</p>
          <div className="wm-detail__actions">
            <button type="button" className="wm-detail__retry" onClick={retry}>Try again</button>
          </div>
        </div>
      );
    } else {
      const msg = state.phase === 'retrieving' ? 'Turning to this month…' : 'Composing what this month held…';
      body = <p className="wm-caption" aria-live="polite">{msg}</p>;
    }
    return (
      <div className="wm-root wm-detail">
        {back}
        <div className="wm-detail__status">{body}</div>
      </div>
    );
  }

  const { artifact } = state.record;

  // Opening ceremony (decision 9): seal cover until broken, unless reduced motion.
  if (!opened && !reduce) {
    return (
      <div className="wm-root wm-detail">
        {back}
        <button
          type="button"
          className="wm-seal-cover"
          onClick={() => { markOpened(periodKey); setOpened(true); }}
        >
          <Stone label={monthLabel(periodKey)} rotation={rotationFor(periodKey)} sealed />
          <span className="wm-label">Break the seal</span>
        </button>
      </div>
    );
  }

  return (
    <div className="wm-root wm-detail">
      {back}
      <div className="wm-fade">
        <ReflectionLetter artifact={artifact} annotation={annotation} />
        <MarkerPath markers={artifact.markers} />

        {/* Static in Task 16 — Task 17 replaces this region with the annotate textarea. */}
        <div className="wm-annotate wm-annotate--static">
          <span className="wm-annotate__prompt wm-caption">＋ Add your words.</span>
        </div>
        {/* Static in Task 16 — Task 17 wires Save / Hide to the adapter. */}
        <footer className="wm-detail__footer">
          <span className="wm-label">Save to notes · Hide this stone</span>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run the test + typecheck**

Run: `npx vitest run src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx`
Expected: PASS (6 tests). Then `npx tsc --noEmit` — expect PASS, and the Task-15 gap is now **closed** (`waymarks-routes.tsx` resolves `./WaymarksPeriodDetail`). If Task 15 left a `// @ts-expect-error pending Task 16` on that import, delete it now (the annotation would otherwise become an unused-directive error). Confirm `usePrefersReducedMotion` resolves at `src/notepad/hooks/use-prefers-reduced-motion` (item 10 seam); if it lives elsewhere, fix the one import path.

- [ ] **Step 8: Commit**

```bash
git add src/notepad/components/waymarks/waymarks.css src/notepad/components/waymarks/ReflectionLetter.tsx src/notepad/components/waymarks/MarkerPath.tsx src/notepad/components/waymarks/WaymarksPeriodDetail.tsx src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx
git commit -m "feat(waymarks): the opened stone — letter, markers, seal ceremony"
```

---

## Task 17: Wire the stone's controls — annotate, hide, save-to-notes (+ the 9th adapter method)

**Files:**
- Edit: `src/notepad/storage/lamplight-adapter.ts` (interface + 9th method)
- Edit: `src/notepad/storage/fake-lamplight-adapter.ts` (impl)
- Edit: `src/notepad/storage/supabase-lamplight-adapter.ts` (impl)
- Edit: `src/notepad/components/waymarks/WaymarksPeriodDetail.tsx` (static affordances → adapter-wired; `onSaveToNotes?` prop; `useNavigate`)
- Edit: `src/notepad/components/waymarks/WaymarksReflections.tsx` (the "Restore this stone." action)
- Edit: `src/notepad/components/waymarks/waymarks-routes.tsx` (wire `onSaveToNotes` → the note collection's `createNote`)
- Edit: `src/notepad/components/waymarks/waymarks.css` (textarea + action-button classes)
- Edit: `src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx` (retarget the one static-footer assertion)
- Create: `src/notepad/storage/fake-lamplight-adapter.saved-to-notes.test.ts` (NO jsdom)
- Create: `src/notepad/components/waymarks/WaymarksPeriodDetail.wiring.test.tsx` (jsdom)
- Create: `src/notepad/components/waymarks/WaymarksReflections.restore.test.tsx` (jsdom)

**Interfaces:**
- Produces: `LamplightAdapter.setReflectionSavedToNotes(userId, periodKey, saved): Promise<void>` (9th method — owns `saved_to_notes`; NO artifactType). `WaymarksPeriodDetail` gains optional `onSaveToNotes?(record: ReflectionRecord)`. `WaymarksReflections` gains the restore action.
- Consumes: `setReflectionAnnotation`/`setReflectionHidden`/`getReflectionState`/`getReflection` (Task 11/12); `ReflectionRecord` (Task 11); `react-router-dom` `useNavigate`; the app note collection's `createNote` (Notepad seam).

**Grounding (verified — do not re-explore; handoff part 18 §TASK 17 + CONTRACTS):**
- 9th method takes `(userId, periodKey, saved)` — **NO artifactType**. `saved_to_notes` lives on the `lamplight_artifacts` row (Task 6 pipeline OMITS it, DESIGN DECISION 2), so Task 17 is its sole owner.
- `getReflectionState → ReflectionState | null` — every read null-guards (`s?.annotation ?? null`). Wiring re-reads state after `setReflectionAnnotation` to refresh the "Your words" aside.
- Annotate vs save-to-notes are independent columns/tables — annotating must never clobber `saved_to_notes` (deletion-tested). Hide/annotate/save do NOT gate on `canAccess` (decision 1).
- The Task-16 detail body already destructures `{ adapter, userId }`, holds `annotation` state, and renders the STATIC `＋ Add your words.` + `Save to notes · Hide this stone` region. Task 17 replaces exactly that region and retargets the single Task-16 assertion pinning the static string.
- The note-insert on save is the ONE integration seam: connector calls the app's existing note collection `createNote` (Notepad.tsx:322). The adapter flag-flip is owned+tested here; the note write reuses existing code (confirm the collection hook path against `Notepad.tsx` during execution).

- [ ] **Step 1: Write the failing tests** (three files) + retarget the Task-16 assertion.

(a) Create `src/notepad/storage/fake-lamplight-adapter.saved-to-notes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeLamplightAdapter } from './fake-lamplight-adapter';
import type { ReflectionArtifact } from './lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, savedToNotes: boolean) {
  a.__seedReflection('u', {
    periodKey: '2026-05', title: 'T', artifact: art,
    createdAt: '2026-05-31T09:00:00.000Z', savedToNotes,
  });
}

describe('FakeLamplightAdapter.setReflectionSavedToNotes', () => {
  it('flips saved_to_notes on the artifact record', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, false);
    await a.setReflectionSavedToNotes('u', '2026-05', true);
    expect((await a.getReflection('u', '2026-05'))?.savedToNotes).toBe(true);
  });

  it('is a no-op when the reflection does not exist', async () => {
    const a = new FakeLamplightAdapter();
    await a.setReflectionSavedToNotes('u', '2026-05', true); // no throw
    expect(await a.getReflection('u', '2026-05')).toBeNull();
  });

  // Deletion test: annotating must NOT clobber saved_to_notes (separate tables).
  it('leaves saved_to_notes intact when the annotation state is updated', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, true);
    await a.setReflectionAnnotation('u', 'reflection_recap', '2026-05', 'a later thought');
    expect((await a.getReflection('u', '2026-05'))?.savedToNotes).toBe(true);
  });
});
```

(b) Create `src/notepad/components/waymarks/WaymarksPeriodDetail.wiring.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WaymarksPeriodDetail } from './WaymarksPeriodDetail';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';
import type { ReflectionRecord } from '../../storage/lamplight-adapter';

const artifact: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter: 'You began May circling one decision.\n\nOn the twelfth you set it down.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function seedReady(a: FakeLamplightAdapter, periodKey = '2026-05') {
  a.__seedReflection('u', {
    periodKey, title: artifact.title, artifact,
    createdAt: `${periodKey}-31T09:00:00.000Z`, savedToNotes: false,
  });
}

// jsdom has no matchMedia; usePrefersReducedMotion reads it.
function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  })) as unknown as typeof window.matchMedia;
}

// Detail route + a sentinel Path route so we can assert navigation on hide.
const renderWired = (
  a: FakeLamplightAdapter,
  onSaveToNotes?: (r: ReflectionRecord) => void | Promise<void>,
  periodKey = '2026-05',
) =>
  render(
    <MemoryRouter initialEntries={[`/notebook/reflections/${periodKey}`]}>
      <Routes>
        <Route path="/notebook/reflections" element={<div>PATH</div>} />
        <Route
          path="/notebook/reflections/:periodKey"
          element={<WaymarksPeriodDetail adapter={a} userId="u" canAccess onSaveToNotes={onSaveToNotes} />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('WaymarksPeriodDetail (wired affordances)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('wm-opened:2026-05', '1'); // skip the seal so the letter is live
    setReducedMotion(false);
  });

  it('saves an annotation and renders it in the "Your words" aside', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderWired(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I remember the drive.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save your words' }));
    await waitFor(() => expect(screen.getByText('Your words')).toBeInTheDocument());
    expect(screen.getByText('I remember the drive.')).toBeInTheDocument();
    expect((await a.getReflectionState('u', 'reflection_recap', '2026-05'))?.annotation).toBe('I remember the drive.');
  });

  it('saves to notes: flips the flag, calls the seam, and disables the button', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    const onSaveToNotes = vi.fn();
    renderWired(a, onSaveToNotes);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save to notes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved to notes' })).toBeDisabled());
    expect(onSaveToNotes).toHaveBeenCalledTimes(1);
    expect((await a.getReflection('u', '2026-05'))?.savedToNotes).toBe(true);
  });

  it('hides the stone and navigates back to The Path', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderWired(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Hide this stone' }));
    await waitFor(() => expect(screen.getByText('PATH')).toBeInTheDocument());
    expect((await a.getReflectionState('u', 'reflection_recap', '2026-05'))?.hiddenAt).not.toBeNull();
  });
});
```

(c) Create `src/notepad/components/waymarks/WaymarksReflections.restore.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, periodKey: string) {
  a.__seedReflection('u', {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}

describe('WaymarksReflections restore', () => {
  it('restores a hidden stone back onto the path', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-04'); seed(a, '2026-05');
    await a.setReflectionHidden('u', 'reflection_recap', '2026-04', true);
    render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.queryByText('April 2026')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hidden stones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore this stone.' }));
    // Hidden list empties and April returns to the visible path.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Hidden stones' })).not.toBeInTheDocument());
    expect(screen.getAllByText('April 2026').length).toBeGreaterThan(0);
  });
});
```

(d) In `src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx`, retarget the one static-footer assertion (the affordances are now real controls):

```diff
-    expect(screen.getByText('Save to notes · Hide this stone')).toBeInTheDocument();
+    expect(screen.getByRole('button', { name: 'Save to notes' })).toBeInTheDocument();
+    expect(screen.getByRole('button', { name: 'Hide this stone' })).toBeInTheDocument();
```

- [ ] **Step 2: Run them to confirm they fail** — Run: `npx vitest run src/notepad/storage/fake-lamplight-adapter.saved-to-notes.test.ts src/notepad/components/waymarks/WaymarksPeriodDetail.wiring.test.tsx src/notepad/components/waymarks/WaymarksReflections.restore.test.tsx` · Expected: FAIL — `a.setReflectionSavedToNotes is not a function`; no `Save your words`/`Save to notes`/`Hide this stone` buttons; no `Restore this stone.` button.

- [ ] **Step 3: Add the 9th method to the `LamplightAdapter` interface** — Edit `src/notepad/storage/lamplight-adapter.ts`, immediately AFTER the `listBackfillTargets(...)` member:

```ts
  /** Flip the artifact-row saved_to_notes flag (client-owned; no artifactType — it lives on the artifact, not the satellite state). */
  setReflectionSavedToNotes(userId: string, periodKey: string, saved: boolean): Promise<void>;
```

- [ ] **Step 4: Implement it in both adapters** —

Edit `src/notepad/storage/fake-lamplight-adapter.ts` (add the method to the class):

```ts
  async setReflectionSavedToNotes(userId: string, periodKey: string, saved: boolean): Promise<void> {
    const key = `${userId}:${periodKey}`;
    const rec = this.reflections.get(key);
    if (rec) this.reflections.set(key, { ...rec, savedToNotes: saved });
  }
```

Edit `src/notepad/storage/supabase-lamplight-adapter.ts` (add the method; reuses the REFLECTION_TYPE idiom):

```ts
  async setReflectionSavedToNotes(userId: string, periodKey: string, saved: boolean): Promise<void> {
    const { error } = await this.#client
      .from('lamplight_artifacts')
      .update({ saved_to_notes: saved })
      .eq('user_id', userId)
      .eq('type', REFLECTION_TYPE)
      .eq('period_key', periodKey);
    if (error) throw error;
  }
```

- [ ] **Step 5: Wire `WaymarksPeriodDetail.tsx`** — five edits:

(i) imports — add `useNavigate` and the `ReflectionRecord` type:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
```
```tsx
import type { LamplightAdapter, ReflectionRecord } from '../../storage/lamplight-adapter';
```

(ii) props — add the optional save-to-notes seam:

```tsx
export interface WaymarksPeriodDetailProps {
  adapter: LamplightAdapter;
  userId: string;
  /** Accepted for connector parity; the detail body never gates on it (decision 1). */
  canAccess: boolean;
  /** Save-to-notes seam: the connector inserts the letter as a note (Notepad's collection.createNote). */
  onSaveToNotes?: (record: ReflectionRecord) => void | Promise<void>;
}
```

(iii) destructure — `export function WaymarksPeriodDetail({ adapter, userId, onSaveToNotes }: WaymarksPeriodDetailProps) {`

(iv) after the existing annotation `useEffect`, add the unconditional hooks + handlers (all top-level, before the `const back = (…)`):

```tsx
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [savedToNotes, setSavedToNotes] = useState(false);

  // Keep the textarea in sync with the loaded annotation; reflect the persisted saved flag.
  useEffect(() => { setDraft(annotation ?? ''); }, [annotation]);
  useEffect(() => { if (state.phase === 'ready') setSavedToNotes(state.record.savedToNotes); }, [state]);

  const saveAnnotation = async () => {
    await adapter.setReflectionAnnotation(userId, 'reflection_recap', periodKey, draft.trim() || null);
    const s = await adapter.getReflectionState(userId, 'reflection_recap', periodKey);
    setAnnotation(s?.annotation ?? null); // null-guard: getReflectionState → ReflectionState | null
  };
  const hide = async () => {
    await adapter.setReflectionHidden(userId, 'reflection_recap', periodKey, true);
    navigate('/notebook/reflections');
  };
  const saveToNotes = async () => {
    if (state.phase !== 'ready') return; // narrows state.record for TS
    await adapter.setReflectionSavedToNotes(userId, periodKey, true);
    await onSaveToNotes?.(state.record);
    setSavedToNotes(true);
  };
```

(v) replace the STATIC region (the two `{/* Static in Task 16 … */}` blocks) with the wired controls:

```tsx
        <div className="wm-annotate">
          <span className="wm-annotate__prompt wm-caption">＋ Add your words.</span>
          <textarea
            className="wm-annotate__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            aria-label="Your words"
            placeholder="A line for yourself, kept beside the letter."
          />
          <div className="wm-annotate__actions">
            <button type="button" className="wm-annotate__save wm-label" onClick={() => void saveAnnotation()}>
              Save your words
            </button>
          </div>
        </div>
        <footer className="wm-detail__footer wm-detail__actions">
          <button
            type="button"
            className="wm-detail__save wm-label"
            onClick={() => void saveToNotes()}
            disabled={savedToNotes}
          >
            {savedToNotes ? 'Saved to notes' : 'Save to notes'}
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="wm-detail__hide wm-label" onClick={() => void hide()}>
            Hide this stone
          </button>
        </footer>
```

- [ ] **Step 6: Wire the "Restore this stone." action in `WaymarksReflections.tsx`** — two edits:

(i) after the existing `reload` useCallback, add:

```tsx
  const restore = useCallback(async (periodKey: string) => {
    await adapter.setReflectionHidden(userId, 'reflection_recap', periodKey, false);
    await reload();
  }, [adapter, userId, reload]);
```

(ii) replace the hidden `<li>`'s `{/* Task 17 adds the "Restore this stone." action here. */}` comment with:

```tsx
                  {' '}
                  <button
                    type="button"
                    className="wm-linkbtn wm-label"
                    onClick={() => void restore(item.periodKey)}
                  >
                    Restore this stone.
                  </button>
```

- [ ] **Step 7: Append the wired-affordance styles to `waymarks.css`:**

```css
/* ── Wired affordances (Task 17) ───────────────────────────────────────────── */
.wm-annotate__input { display: block; width: 100%; margin-top: 0.6rem; padding: 0.6rem 0.7rem; border: 1px solid var(--wm-hairline); border-radius: 4px; background: var(--wm-letter); color: var(--wm-umber); font: inherit; resize: vertical; }
.wm-annotate__actions { margin-top: 0.6rem; display: flex; justify-content: flex-end; }
.wm-annotate__save, .wm-detail__save, .wm-detail__hide { background: none; border: none; padding: 0.3rem 0.4rem; cursor: pointer; color: var(--wm-umber); font: inherit; }
.wm-detail__save:disabled { color: var(--wm-silica); cursor: default; }
.wm-linkbtn { background: none; border: none; padding: 0; cursor: pointer; color: var(--wm-gold); font: inherit; }
```

- [ ] **Step 8: Wire the save-to-notes seam in `waymarks-routes.tsx`** — add the `ReflectionRecord` type import + the note-collection seam, and pass `onSaveToNotes` from `WaymarksPeriodDetailRoute`:

```tsx
import type { ReflectionRecord } from '../../storage/lamplight-adapter';
// Seam — the SAME note collection Notepad.tsx uses for createNote (Notepad.tsx:322).
// Confirm the exact hook + module path during execution.
import { useNoteCollection } from '@/notepad/storage/note-collection';
```
```tsx
export function WaymarksPeriodDetailRoute() {
  const { adapter, userId, canAccess } = useWaymarksConnection();
  const collection = useNoteCollection(); // seam (sibling of item 12)
  if (!adapter || !userId) return null;

  // Save-to-notes seam: reuse Notepad's existing note-create path, then write the letter into
  // the new note. The adapter flag-flip (setReflectionSavedToNotes) is owned + tested in Task 17;
  // this insert reuses existing collection code — confirm the create/populate API during execution.
  const handleSaveToNotes = async (record: ReflectionRecord) => {
    const note = await collection.createNote('root', 'devotion');
    await collection.updateNoteContent(note.id, `# ${record.title}\n\n${record.artifact.letter}`);
  };

  return (
    <WaymarksPeriodDetail
      adapter={adapter}
      userId={userId}
      canAccess={canAccess}
      onSaveToNotes={handleSaveToNotes}
    />
  );
}
```

- [ ] **Step 9: Run the tests + typecheck** — Run: `npx vitest run src/notepad/storage/fake-lamplight-adapter.saved-to-notes.test.ts src/notepad/components/waymarks/WaymarksPeriodDetail.wiring.test.tsx src/notepad/components/waymarks/WaymarksReflections.restore.test.tsx src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx` · Expected: PASS. Then `npx tsc --noEmit` — expect PASS. (`useNoteCollection`/`updateNoteContent` are the confirm-during-execution seam; if the real collection API differs, adjust only that handler.)

- [ ] **Step 10: Commit**

```bash
git add src/notepad/storage/lamplight-adapter.ts src/notepad/storage/fake-lamplight-adapter.ts src/notepad/storage/supabase-lamplight-adapter.ts src/notepad/storage/fake-lamplight-adapter.saved-to-notes.test.ts src/notepad/components/waymarks/WaymarksPeriodDetail.tsx src/notepad/components/waymarks/WaymarksReflections.tsx src/notepad/components/waymarks/waymarks-routes.tsx src/notepad/components/waymarks/waymarks.css src/notepad/components/waymarks/WaymarksPeriodDetail.test.tsx src/notepad/components/waymarks/WaymarksPeriodDetail.wiring.test.tsx src/notepad/components/waymarks/WaymarksReflections.restore.test.tsx
git commit -m "feat(waymarks): wire annotate, hide, restore, and save-to-notes controls"
```

---

## Task 18: Arrival — the pure time rule, the gold-dot badge, the invitation card, the sealed head-stone

**Files:**
- Create: `src/notepad/lamplight/arrival.ts` (pure `hasArrived`)
- Create: `src/notepad/lamplight/arrival.test.ts` (NO jsdom — pure)
- Create: `src/notepad/lamplight/arrival-badge.tsx` (`useArrivalDot` hook + `ArrivalDot`)
- Edit: `src/notepad/components/waymarks/WaymarksReflections.tsx` (seal the newest unopened stone at the Path head — decision 12)
- Create: `src/notepad/components/waymarks/WaymarksReflections.arrival.test.tsx` (jsdom)
- Edit: `src/components/sections/Notepad.tsx` (gold arrival dot on the 🕯 Lamplight tab, ~L224)
- Edit: `src/components/sections/notepad/mobile/LamplightMobileView.tsx` (same dot on the mobile dock)
- Edit: `src/notepad/components/lamplight/LamplightTabPanel.tsx` (a one-line invitation card → The Path)

**Interfaces:**
- Produces: `hasArrived(now: Date, periodKey: string, timezone: string): boolean`; `useArrivalDot(adapter, userId, timezone?)` + `<ArrivalDot />`; sealed newest stone on the Path.
- Consumes: `ARRIVAL_HOUR_LOCAL` (client constants, same dir); `listReflections` (arrival existence, caller's job); `hasArrived`; Task-16 localStorage `wm-opened:<periodKey>` (duplicated 2-line read).

**Grounding (verified — do not re-explore; handoff part 18 §TASK 18 + part 12 decision 12):**
- `hasArrived` is PURE time math — no tz lib. `Intl.DateTimeFormat('en-CA', { timeZone, year/month/day/hour numeric, hour12:false }).formatToParts(now)` yields local Y/M/D/H; compare the tuple to `[nextYear, nextMonth, 1, ARRIVAL_HOUR_LOCAL]`. `ARRIVAL_HOUR_LOCAL=7`. Arrival = local now ≥ 07:00 on the 1st of the month FOLLOWING `periodKey` (December → next January). **Date IS allowed in vitest** (the Date ban is only for Workflow scripts). Artifact-existence is the caller's job (via `listReflections`); the helper is pure time.
- Gold dot literal `#C49A78` (the tab lives OUTSIDE `.wm-root`, so no `--wm-gold` var). Badge/card kept minimal — **NO §13.6 verbatim string exists for the card; do NOT invent heavy copy.** Mirror any existing daily-lamp badge markup on the tab during execution (optional grep `Notepad.tsx` ~L224).
- Decision 12: only the NEWEST visible stone renders `sealed` when unopened; older backfilled stones never seal. `Stone` already accepts `sealed` (Task 15).

- [ ] **Step 1: Write the failing tests** —

(a) Create `src/notepad/lamplight/arrival.test.ts` (NO jsdom):

```ts
import { describe, it, expect } from 'vitest';
import { hasArrived } from './arrival';

describe('hasArrived (07:00 local on the 1st of the following month)', () => {
  it('is true exactly at 07:00 on the 1st of the next month (boundary, arrived)', () => {
    expect(hasArrived(new Date('2026-06-01T07:00:00Z'), '2026-05', 'UTC')).toBe(true);
  });
  it('is false one minute before 07:00 on the 1st (boundary, not yet)', () => {
    expect(hasArrived(new Date('2026-06-01T06:59:00Z'), '2026-05', 'UTC')).toBe(false);
  });
  it('is false on the last instant of the covered month', () => {
    expect(hasArrived(new Date('2026-05-31T23:59:00Z'), '2026-05', 'UTC')).toBe(false);
  });
  it('is true well into a later month', () => {
    expect(hasArrived(new Date('2026-07-15T00:00:00Z'), '2026-05', 'UTC')).toBe(true);
  });
  it('rolls December over into the next January (both directions)', () => {
    expect(hasArrived(new Date('2027-01-01T07:00:00Z'), '2026-12', 'UTC')).toBe(true);
    expect(hasArrived(new Date('2026-12-31T23:59:00Z'), '2026-12', 'UTC')).toBe(false);
  });
  it('respects the reader timezone, not just the UTC instant', () => {
    // 10:30Z is 06:30 in America/New_York (EDT) → not arrived there yet…
    expect(hasArrived(new Date('2026-06-01T10:30:00Z'), '2026-05', 'America/New_York')).toBe(false);
    // …11:30Z is 07:30 EDT → arrived.
    expect(hasArrived(new Date('2026-06-01T11:30:00Z'), '2026-05', 'America/New_York')).toBe(true);
  });
});
```

(b) Create `src/notepad/components/waymarks/WaymarksReflections.arrival.test.tsx` (jsdom):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, periodKey: string) {
  a.__seedReflection('u', {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}

describe('WaymarksReflections newest-stone seal (decision 12)', () => {
  beforeEach(() => localStorage.clear());

  it('seals exactly one stone — the newest unopened head of the path', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-04'); seed(a, '2026-05');
    const { container } = render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(container.querySelectorAll('.wm-stone__seal')).toHaveLength(1);
  });

  it('does not seal the newest stone once it has been opened', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-05');
    localStorage.setItem('wm-opened:2026-05', '1');
    const { container } = render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(container.querySelectorAll('.wm-stone__seal')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail** — Run: `npx vitest run src/notepad/lamplight/arrival.test.ts src/notepad/components/waymarks/WaymarksReflections.arrival.test.tsx` · Expected: FAIL — `Cannot find module './arrival'`; and the newest stone is not yet sealed (0 seals, expected 1).

- [ ] **Step 3: Create the pure arrival rule** — `src/notepad/lamplight/arrival.ts`:

```ts
import { ARRIVAL_HOUR_LOCAL } from './reflection-constants';

// A reflection covers `periodKey` (YYYY-MM). Its stone "arrives" — appears on the Path with a
// fresh seal — at ARRIVAL_HOUR_LOCAL on the FIRST day of the FOLLOWING month, in the reader's own
// timezone. Pure time math (no library); the existence of the artifact is the caller's concern.
export function hasArrived(now: Date, periodKey: string, timezone: string): boolean {
  const [y, m] = periodKey.split('-').map(Number);
  const arrivalYear = m === 12 ? y + 1 : y;   // December rolls into next January
  const arrivalMonth = m === 12 ? 1 : m + 1;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let localHour = get('hour');
  if (localHour === 24) localHour = 0; // some engines emit '24' for local midnight under hour12:false

  const nowTuple = [get('year'), get('month'), get('day'), localHour];
  const arrivalTuple = [arrivalYear, arrivalMonth, 1, ARRIVAL_HOUR_LOCAL];
  for (let i = 0; i < 4; i++) {
    if (nowTuple[i] > arrivalTuple[i]) return true;
    if (nowTuple[i] < arrivalTuple[i]) return false;
  }
  return true; // exactly equal → arrived
}
```

- [ ] **Step 4: Create the arrival badge** — `src/notepad/lamplight/arrival-badge.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { hasArrived } from './arrival';
import type { LamplightAdapter } from '../storage/lamplight-adapter';

// Same key WaymarksPeriodDetail writes (Task 16 `wm-opened:<periodKey>`); a 2-line read, safe to
// extract to a shared opened-store in a later cleanup.
function isOpened(periodKey: string): boolean {
  try { return localStorage.getItem(`wm-opened:${periodKey}`) === '1'; } catch { return false; }
}

// The gold arrival dot shows when the newest reflection has arrived (past 07:00 local on the 1st of
// the following month) AND the reader has not yet broken its seal. Existence + newest come from
// listReflections; hasArrived is the pure time gate.
export function useArrivalDot(adapter: LamplightAdapter, userId: string, timezone?: string): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    void (async () => {
      const items = await adapter.listReflections(userId);
      const newest = items.filter((i) => i.hiddenAt === null)[0];
      const arrived = !!newest && hasArrived(new Date(), newest.periodKey, tz) && !isOpened(newest.periodKey);
      if (alive) setShow(arrived);
    })();
    return () => { alive = false; };
  }, [adapter, userId, timezone]);
  return show;
}

// A small gold dot (#C49A78) — the arrival cue on the Lamplight tab. Inline-styled so it needs no
// new stylesheet; mirror the existing daily-lamp badge placement when mounting it.
export function ArrivalDot() {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-block', width: 6, height: 6, marginLeft: 4, borderRadius: '50%', background: '#C49A78', verticalAlign: 'middle' }}
    />
  );
}
```

- [ ] **Step 5: Seal the newest unopened stone in `WaymarksReflections.tsx`** — two edits:

(i) add a local opened-read near the other helpers (`monthLabel`/`rotationFor`):

```tsx
// Same key WaymarksPeriodDetail writes (Task 16 `wm-opened:<periodKey>`); duplicated 2-line read.
function hasBeenOpened(periodKey: string): boolean {
  try { return localStorage.getItem(`wm-opened:${periodKey}`) === '1'; } catch { return false; }
}
```

(ii) pass `sealed` to the path `<Stone>` (decision 12 — only the head stone, only while unopened):

```tsx
                <Stone
                  label={monthLabel(row.item.periodKey)}
                  rotation={rotationFor(row.item.periodKey)}
                  fillVar={STONE_FILLS[row.index % STONE_FILLS.length]}
                  sealed={row.index === 0 && !hasBeenOpened(row.item.periodKey)}
                />
```

- [ ] **Step 6: Add the gold arrival dot to the Lamplight tab (seam edits)** — in `src/components/sections/Notepad.tsx`, near the `🕯 Lamplight` tab button (~L224), and in `src/components/sections/notepad/mobile/LamplightMobileView.tsx` on the mobile dock item. Notepad already derives the Lamplight adapter + signed-in userId (Task 15 grounding item 12); reuse them:

```tsx
import { useArrivalDot, ArrivalDot } from '@/notepad/lamplight/arrival-badge';
// …inside the component (adapter/userId as Notepad already has them):
const showArrival = useArrivalDot(lamplightAdapter, userId);
// …on the 🕯 Lamplight tab button, after the label (mirror the existing daily-lamp badge markup):
{showArrival && <ArrivalDot />}
```

*(Confirm the adapter/userId identifiers Notepad already holds during execution; the dot is presentational and non-gating.)*

- [ ] **Step 7: Add the one-line invitation card to `LamplightTabPanel.tsx` (seam edit)** — near the top of the panel body, a single quiet link to The Path (minimal copy — no §13.6 string exists for this):

```tsx
import { Link } from 'react-router-dom';
// …near the top of the panel body:
<Link to="/notebook/reflections" className="wm-label" style={{ display: 'inline-block', marginBottom: '0.75rem', color: '#C49A78', textDecoration: 'none' }}>
  Your path of months is here →
</Link>
```

*(Confirm `Link` is in-router at this mount point during execution; if not, use the app's existing tab-navigation affordance.)*

- [ ] **Step 8: Run the tests + typecheck** — Run: `npx vitest run src/notepad/lamplight/arrival.test.ts src/notepad/components/waymarks/WaymarksReflections.arrival.test.tsx` · Expected: PASS. Then `npx tsc --noEmit` — expect PASS. (`useArrivalDot` uses real `new Date()` and is thin glue over the tested `hasArrived`; the badge/card seams are presentational — not unit-tested.)

- [ ] **Step 9: Commit**

```bash
git add src/notepad/lamplight/arrival.ts src/notepad/lamplight/arrival.test.ts src/notepad/lamplight/arrival-badge.tsx src/notepad/components/waymarks/WaymarksReflections.tsx src/notepad/components/waymarks/WaymarksReflections.arrival.test.tsx src/components/sections/Notepad.tsx src/components/sections/notepad/mobile/LamplightMobileView.tsx src/notepad/components/lamplight/LamplightTabPanel.tsx
git commit -m "feat(waymarks): arrival rule, gold-dot tab badge, invitation card, sealed head-stone"
```

---

## Task 19: Downgrade-readable Path + locked-preview purity (SMALL)

**Files:**
- Edit: `src/notepad/components/waymarks/WaymarksReflections.tsx` (downgrade branch + quiet head-note)
- Create: `src/notepad/components/waymarks/WaymarksReflections.downgrade.test.tsx` (jsdom)

**Interfaces:**
- Produces: a downgrade-readable Path (a lapsed-Plus reader keeps their stones) + a quiet head-note; no entitlement change.
- Consumes: existing `WaymarksLockedPreview` (Task 15); `canAccess`/`visible` (Task 15 component state).

**Grounding (verified — do not re-explore; handoff part 18 §TASK 19 + decision 1):**
- Keep the never-subscribed branch `if (!canAccess && visible.length === 0) return <WaymarksLockedPreview/>;`. ADD `const downgraded = !canAccess && visible.length > 0;` → render the NORMAL Path (stones readable/clickable) PLUS a quiet `wm-caption` head-note; do NOT return LockedPreview. Detail annotate/hide/save still work (they don't gate on canAccess — decision 1). The Task-15 backfill effect already early-returns when `!canAccess`, so no new stones generate — consistent with the head-note.
- Head-note copy (verbatim): **"Your path is here whenever you return. New stones resume the moment you're back."**
- Gate stays `hasAccess('reflections')` — NO entitlement change. `WaymarksLockedPreview` already has no digits and no paywall vocabulary; the purity test locks that in.

- [ ] **Step 1: Write the failing test** — `src/notepad/components/waymarks/WaymarksReflections.downgrade.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { WaymarksLockedPreview } from './WaymarksLockedPreview';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, periodKey: string) {
  a.__seedReflection('u', {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}

describe('WaymarksReflections downgrade (lapsed Plus keeps the path)', () => {
  it('keeps stones readable with a quiet head-note and NO paywall CTA when downgraded', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-05');
    render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess={false} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.getByText(/Your path is here whenever you return\./)).toBeInTheDocument();
    // Not the locked invitation — no upgrade CTA.
    expect(screen.queryByText('See your own months marked')).not.toBeInTheDocument();
  });
});

describe('WaymarksLockedPreview is an invitation, not a paywall', () => {
  it('shows no numbers and no paywall vocabulary', () => {
    const { container } = render(<WaymarksLockedPreview />);
    expect(container.textContent ?? '').not.toMatch(/\d/);
    expect(container.textContent ?? '').not.toMatch(/unlock|upgrade to|paywall|\$/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — Run: `npx vitest run src/notepad/components/waymarks/WaymarksReflections.downgrade.test.tsx` · Expected: the downgrade test FAILS (no head-note yet); the locked-preview purity test already PASSES (it locks in an existing §13.4 invariant).

- [ ] **Step 3: Add the downgrade branch + head-note to `WaymarksReflections.tsx`** — after the `visible`/`hidden` derivation (and the never-subscribed early return), add:

```tsx
  const downgraded = !canAccess && visible.length > 0;
```

and in the `<header>`, after the `<h1>…The months you've walked</h1>` and before the `backfilling` caption, add:

```tsx
        {downgraded && (
          <p className="wm-caption">
            Your path is here whenever you return. New stones resume the moment you're back.
          </p>
        )}
```

- [ ] **Step 4: Run it to confirm it passes** — Run: `npx vitest run src/notepad/components/waymarks/WaymarksReflections.downgrade.test.tsx` · Expected: PASS (2). Then `npx tsc --noEmit` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/components/waymarks/WaymarksReflections.tsx src/notepad/components/waymarks/WaymarksReflections.downgrade.test.tsx
git commit -m "feat(waymarks): keep the path readable on downgrade; lock in locked-preview purity"
```

---

## Phase E: Voice eval (Tier 3, offline, non-gating) — `reflection-voice-eval.test.ts`

**Files:**
- Create: `supabase/functions/lamplight-generate/reflection-voice-eval.test.ts` (vitest, NO jsdom)

**Interfaces:**
- Consumes (co-located, duplicated from Task 6's `monthly-reflection-pipeline.test.ts`): `makeAdapter`, `makeSupabaseMock`, `ARTIFACT`, `makeCtx`; `runMonthlyReflectionPipeline` (Task 6); the 6 validators (`../_shared/reflection-validators`) + bounds constants (`../_shared/reflection-constants`); `LLMAdapter`/`GenerateInput`/`GenerateOutput` (`../_shared/anthropic`), `ReflectionArtifact` (`../_shared/artifacts`), `MonthlyReflectionContext` (`./prompts/monthly-reflection`), `EdgeSupabase` (`./reflection-candidates`).

**Grounding (verified — do not re-explore; handoff part 18 §PHASE E + Task-6 test L1447–1591):**
- The pipeline upserts ONLY when all 6 deterministic validators AND the judge pass, so `result.ok === true` IS the guardrail gate. The generated artifact lands in `upserts[0].body as ReflectionArtifact` (NOT on the result). `makeAdapter([artifact, { pass: true, reasons: [] }])` serves the sonnet artifact then the haiku judge; `calls[1].model==='haiku'`.
- **Assert GUARDRAILS (bounds, allowlist, anchoring), never exact prose** — that keeps voice drift a warning, not a build break. Non-gating (Tier 3, run on demand/nightly).
- Every fixture is validator-clean by construction (reuses the exemplar register or fresh prose with no metrics / no advice / no 8+-word verbatim note-run). Fixture #1 = the §2.2 exemplar verbatim.

- [ ] **Step 1: Write the eval** — Create `supabase/functions/lamplight-generate/reflection-voice-eval.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runMonthlyReflectionPipeline } from './monthly-reflection-pipeline';
import type { LLMAdapter, GenerateInput, GenerateOutput } from '../_shared/anthropic';
import type { ReflectionArtifact } from '../_shared/artifacts';
import type { MonthlyReflectionContext } from './prompts/monthly-reflection';
import type { EdgeSupabase } from './reflection-candidates';
import {
  validateShapeAndBounds,
  validateScriptureAllowlist,
  validateAnchoring,
  validateNoScorecard,
  validateWitnessedNotReopened,
  validateProvenance,
} from '../_shared/reflection-validators';
import { MARKER_MIN, MARKER_MAX, LETTER_WORD_MIN, LETTER_WORD_MAX } from '../_shared/reflection-constants';

// ── Co-located test doubles (verbatim from monthly-reflection-pipeline.test.ts, Task 6) ──────────
function makeAdapter(responses: unknown[]): { llm: LLMAdapter; calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  let i = 0;
  const llm: LLMAdapter = {
    async generate<U>(input: GenerateInput): Promise<GenerateOutput<U>> {
      calls.push(input);
      const parsed = responses[Math.min(i, responses.length - 1)] as unknown as U;
      i++;
      return { parsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 10, completionTokens: 20 };
    },
    generateStream: (async () => { throw new Error('unused'); }) as unknown as LLMAdapter['generateStream'],
  };
  return { llm, calls };
}

function makeSupabaseMock(opts: { upsertedId?: string } = {}) {
  const upsertedId = opts.upsertedId ?? 'artifact-1';
  const upserts: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      if (table !== 'lamplight_artifacts') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({
            async maybeSingle() { return { data: null, error: null }; },
            async single() { return { data: null, error: { message: 'no row' } }; },
          }) }) }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return { select: () => ({ async single() { return { data: { id: upsertedId }, error: null }; } }) };
        },
      };
    },
  };
  return { supabase: supabase as unknown as EdgeSupabase, upserts };
}

// §2.2 exemplar (verbatim from Task 6): 60+ word letter, one in-month marker citing an allowed verse.
const ARTIFACT: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling one decision, turning it over on the drive to work and again before sleep. ' +
    'On the twelfth something in you set it down — not because the answer arrived, but because the circling ' +
    'had done its work and you were ready to stop. The rest of the month you wrote less about it. The stone ' +
    'stands where you left it; the details can rest now.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function makeCtx(over: Partial<MonthlyReflectionContext> = {}): MonthlyReflectionContext {
  return {
    periodKey: '2026-05',
    periodLabel: 'May 2026',
    monthStart: '2026-05-01',
    monthEnd: '2026-05-31',
    notes: [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }],
    candidates: [],
    allowedVerseRefs: new Set(['Ps 27:14']),
    allowedNoteDays: new Set(['2026-05-12']),
    ...over,
  };
}

// A month-neutral variant of the exemplar letter (same validator-clean register), for fixtures set
// in other months so the prose doesn't name the wrong month.
const NEUTRAL_LETTER =
  'You began the month circling one decision, turning it over on the drive to work and again before sleep. ' +
  'On the twelfth something in you set it down — not because the answer arrived, but because the circling ' +
  'had done its work and you were ready to stop. The rest of the month you wrote less about it. The stone ' +
  'stands where you left it; the details can rest now.';

// ── Fixtures: each artifact+ctx must clear all 6 validators + the judge (→ result.ok). ───────────
interface VoiceFixture { name: string; artifact: ReflectionArtifact; ctx: MonthlyReflectionContext; }

const FIXTURES: VoiceFixture[] = [
  {
    name: 'the §2.2 exemplar (fixture #1)',
    artifact: ARTIFACT,
    ctx: makeCtx(),
  },
  {
    name: 'a different month (August), same reflective register',
    artifact: {
      title: 'The Month You Stopped Waiting',
      letter: NEUTRAL_LETTER,
      markers: [{ date: '2026-08-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
    },
    ctx: makeCtx({
      periodKey: '2026-08', periodLabel: 'August 2026',
      monthStart: '2026-08-01', monthEnd: '2026-08-31',
      notes: [{ id: 'n1', day: '2026-08-12', text: 'I keep circling this decision.' }],
      allowedNoteDays: new Set(['2026-08-12']),
    }),
  },
  {
    name: 'an abstained marker (verse: null) — no citation forced',
    artifact: {
      ...ARTIFACT,
      markers: [{ date: '2026-05-12', verse: null, phrase: 'the day the circling stopped' }],
    },
    ctx: makeCtx(),
  },
  {
    name: 'a marker that spans several days (date_end)',
    artifact: {
      ...ARTIFACT,
      markers: [{ date: '2026-05-12', date_end: '2026-05-15', verse: 'Ps 27:14', phrase: 'the days the circling slowed and stopped' }],
    },
    ctx: makeCtx({
      notes: [
        { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' },
        { id: 'n2', day: '2026-05-15', text: 'Quieter today. The loop is losing its grip.' },
      ],
      allowedNoteDays: new Set(['2026-05-12', '2026-05-15']),
    }),
  },
  {
    name: 'a heavier month in a plainer register (grief, single marker)',
    artifact: {
      title: 'The Month the Waiting Room Was Quiet',
      letter:
        'September opened in a waiting room, in the particular quiet that arrives when the ordinary noise of a day ' +
        'stops mattering all at once. You did not have words for it and you did not go looking for any. What you ' +
        'reached for instead was an old and stubborn certainty — that there is a shelter which does not depend on ' +
        'the news being good. You sat down inside it and let the long afternoon be long.',
      markers: [{ date: '2026-09-08', verse: 'Ps 46:1', phrase: 'the quiet that fell in the waiting room' }],
    },
    ctx: makeCtx({
      periodKey: '2026-09', periodLabel: 'September 2026',
      monthStart: '2026-09-01', monthEnd: '2026-09-30',
      notes: [{ id: 'n1', day: '2026-09-08', text: 'The results came back and the waiting room went very still.' }],
      allowedVerseRefs: new Set(['Ps 46:1']),
      allowedNoteDays: new Set(['2026-09-08']),
    }),
  },
  {
    name: 'an ordinary, uneventful month (rest, single marker)',
    artifact: {
      title: 'The Month Nothing Needed Fixing',
      letter:
        'February asked very little of you, and for once you let that be enough. There was a day in the middle of ' +
        'it that held nothing worth reporting — no crisis and no triumph, only the ordinary work of being alive and ' +
        'awake to it. You noticed, almost in passing, that you were not restless. Something in you had stopped ' +
        'needing the day to prove itself, and had finally learned to rest.',
      markers: [{ date: '2026-02-17', verse: 'Ps 131:2', phrase: 'a soul quieted like a weaned child' }],
    },
    ctx: makeCtx({
      periodKey: '2026-02', periodLabel: 'February 2026',
      monthStart: '2026-02-01', monthEnd: '2026-02-28',
      notes: [{ id: 'n1', day: '2026-02-17', text: 'Nothing happened today and I was grateful for it.' }],
      allowedVerseRefs: new Set(['Ps 131:2']),
      allowedNoteDays: new Set(['2026-02-17']),
    }),
  },
  {
    name: 'two moments marked in one month (multi-marker)',
    artifact: {
      title: 'The Month That Turned Twice',
      letter:
        'March had two hinges in it. Early on there was a hard conversation you had put off for a year, and when it ' +
        'finally came it was smaller than the dread had promised. Then, near the end, an ordinary evening when nothing ' +
        'was required of you and you noticed you felt light. You did not manufacture either one. They simply arrived, ' +
        'a week and a half apart, and you were awake enough to catch them both.',
      markers: [
        { date: '2026-03-06', verse: 'Ps 27:14', phrase: 'the conversation that was smaller than the dread' },
        { date: '2026-03-19', verse: 'Ps 16:11', phrase: 'an ordinary evening that came out light' },
      ],
    },
    ctx: makeCtx({
      periodKey: '2026-03', periodLabel: 'March 2026',
      monthStart: '2026-03-01', monthEnd: '2026-03-31',
      notes: [
        { id: 'n1', day: '2026-03-06', text: 'Finally had the talk. Not as bad as I feared.' },
        { id: 'n2', day: '2026-03-19', text: 'Nice quiet evening. Felt oddly light.' },
      ],
      allowedVerseRefs: new Set(['Ps 27:14', 'Ps 16:11']),
      allowedNoteDays: new Set(['2026-03-06', '2026-03-19']),
    }),
  },
];

describe('reflection voice eval (Tier 3, offline, non-gating — guardrails only, never prose)', () => {
  for (const fx of FIXTURES) {
    it(`upserts a guardrail-clean artifact for: ${fx.name}`, async () => {
      const { llm, calls } = makeAdapter([fx.artifact, { pass: true, reasons: [] }]);
      const { supabase, upserts } = makeSupabaseMock({ upsertedId: 'x' });
      const result = await runMonthlyReflectionPipeline({
        llm, supabase, ctx: fx.ctx, userId: 'u', periodKey: fx.ctx.periodKey,
      });

      // The pipeline upserts ONLY when all six validators AND the judge pass — so result.ok is
      // itself the guardrail gate. (Voice drift is a warning, not a failure: we assert structure only.)
      expect(result.ok).toBe(true);
      expect(calls[1].model).toBe('haiku'); // the judge was consulted

      const body = upserts[0].body as ReflectionArtifact;
      expect(body.markers.length).toBeGreaterThanOrEqual(MARKER_MIN);
      expect(body.markers.length).toBeLessThanOrEqual(MARKER_MAX);
      const words = body.letter.trim().split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(LETTER_WORD_MIN);
      expect(words).toBeLessThanOrEqual(LETTER_WORD_MAX);
      for (const m of body.markers) {
        if (m.verse !== null) expect(fx.ctx.allowedVerseRefs.has(m.verse)).toBe(true);
        expect(m.date >= fx.ctx.monthStart && m.date <= fx.ctx.monthEnd).toBe(true);
        if (m.date_end) {
          expect(m.date_end >= fx.ctx.monthStart && m.date_end <= fx.ctx.monthEnd).toBe(true);
        }
      }
    });
  }

  it('all six deterministic validators pass on the §2.2 exemplar (fixture #1)', () => {
    const { artifact, ctx } = FIXTURES[0];
    expect(validateShapeAndBounds(artifact).ok).toBe(true);
    expect(validateScriptureAllowlist(artifact, { allowedVerseRefs: ctx.allowedVerseRefs }).ok).toBe(true);
    expect(
      validateAnchoring(artifact, {
        monthStart: ctx.monthStart, monthEnd: ctx.monthEnd, allowedNoteDays: ctx.allowedNoteDays,
      }).ok,
    ).toBe(true);
    expect(validateNoScorecard(artifact.letter).ok).toBe(true);
    expect(validateWitnessedNotReopened(artifact, { notes: ctx.notes.map((n) => ({ text: n.text })) }).ok).toBe(true);
    expect(
      validateProvenance({
        sourceNoteIds: ctx.notes.map((n) => n.id),
        monthNoteIds: ctx.notes.map((n) => n.id),
      }).ok,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it** — Run: `npx vitest run supabase/functions/lamplight-generate/reflection-voice-eval.test.ts` · Expected: PASS (8: 7 fixtures + the validator sweep). If any fixture's `result.ok` is false, the offending artifact tripped a real validator against its ctx — tighten THAT fixture (dates within month, verse in allowlist, letter 60–350 words, no metrics/advice), do not weaken the assertions.

- [ ] **Step 3: Commit** *(non-gating — voice drift is a warning, not a build break; the eval asserts guardrails only)*

```bash
git add supabase/functions/lamplight-generate/reflection-voice-eval.test.ts
git commit -m "test(waymarks): tier-3 offline voice eval — guardrail invariants across reflection fixtures"
```

---

<!-- PLAN COMPLETE -->



