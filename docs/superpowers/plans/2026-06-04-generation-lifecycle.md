# Generation Lifecycle Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a single coordinator seam — `runGeneration(deps, meta, body)` — that owns the cross-cutting concerns of every billable Lamplight generation (quota gate, usage recording, error classification), so those concerns live in ONE node-testable module instead of being smeared across 6 inline call sites in 3 layers.

**Architecture:** A decorator/HOF wraps a per-kind "body" that returns DATA (`GenerationOutcome { response, usage }`), never side effects. `runGeneration` checks quota, runs the body, records exactly one usage row from `outcome.usage` (or an error row on quota-block / throw), and returns `{ status, response }`. The three pipelines stop recording usage themselves; they instead surface a `usage: UsageCore | null` field on their result types. `index.ts` shrinks from a fat dispatcher with inline recording to thin per-kind bodies wrapped by `runGeneration`. A schema migration makes `lamplight_usage.model` nullable so pre-model failures (quota block, context-build throw) can record honestly instead of attributing a fictional model.

**Tech Stack:** TypeScript ~5.9, Deno (edge function runtime, source imports use `.ts` extensions), Vitest (node env, test imports omit extensions), Supabase (Postgres migrations).

**Behavior changes (intentional, called out so reviewers don't flag them as regressions):**
1. Quota-exceeded now records an `error` usage row (`error_code: 'quota_exceeded'`) — today it records nothing.
2. Context-build throws (e.g. `buildDailyDevotionContext`) now record an `error` usage row, because context building moves INSIDE the wrapped body — today they bubble straight to a 500 with no telemetry.
3. Pre-model failures (quota block, context throw) record `model: null` instead of the fictional `'claude-haiku-4-5-20251001'`.
4. Smoke-test `validators_failed` (a returned `ok:false`, not a throw) now records NOTHING — today the throwaway smoke path always recorded a generic `ok` row. Smoke is slated for deletion; this is acceptable.

**Out of scope (explicit non-goals):** token accumulation across retries (failed attempts still record `tokens 0`); rewiring `UsageLeaderboard.tsx` (it hardcodes a model for cost display — separate follow-up); deleting the smoke-test pipeline.

**Test runner:** `npx vitest run` runs the whole suite. To run one file: `npx vitest run <path>`.

---

### Task 1: Widen `UsageRow.model` to nullable + add `UsageCore` type

A pre-model failure has no model. The usage row must be able to say so (`model: null`) instead of inventing one. `UsageCore` is the per-call payload the lifecycle merges `user_id` + `artifact_kind` onto, so pipelines and the lifecycle never restate identity fields.

**Files:**
- Modify: `supabase/functions/_shared/usage.ts:4-12`
- Test: `supabase/functions/_shared/usage.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('recordLamplightUsage', ...)` block in `supabase/functions/_shared/usage.test.ts`, after the existing `'does not throw on insert error'` test (before the closing `});` of the describe):

```ts
  it('accepts a null model (pre-model failure) and inserts it verbatim', async () => {
    const nullModelRow: UsageRow = {
      user_id: 'u1',
      model: null,
      artifact_kind: 'daily_devotion',
      tokens_in: 0,
      tokens_out: 0,
      status: 'error',
      error_code: 'quota_exceeded',
    };
    const insert = vi.fn(async () => ({ error: null }));
    await recordLamplightUsage(fakeSupabase(insert), nullModelRow);
    expect(insert).toHaveBeenCalledWith(nullModelRow);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/usage.test.ts`
Expected: FAIL — TypeScript rejects `model: null` because `UsageRow.model` is `string` (the test won't compile / `tsc` error surfaced by vitest).

- [ ] **Step 3: Widen the type and add `UsageCore`**

In `supabase/functions/_shared/usage.ts`, replace lines 4-12:

```ts
export interface UsageRow {
  user_id: string;
  model: string;
  artifact_kind: string;
  tokens_in: number;
  tokens_out: number;
  status: 'ok' | 'error';
  error_code?: string | null;
}
```

with:

```ts
export interface UsageRow {
  user_id: string;
  // null when no model ran (quota block, context-build throw). A fictional
  // model id would corrupt cost attribution — null is the honest value.
  model: string | null;
  artifact_kind: string;
  tokens_in: number;
  tokens_out: number;
  status: 'ok' | 'error';
  error_code?: string | null;
}

// The per-call usage payload, minus the identity fields the lifecycle owns.
// Pipelines build a UsageCore; runGeneration merges user_id + artifact_kind.
export type UsageCore = Omit<UsageRow, 'user_id' | 'artifact_kind'>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/_shared/usage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/usage.ts supabase/functions/_shared/usage.test.ts
git commit -m "feat(usage): allow null model + add UsageCore payload type"
```

---

### Task 2: Null-safe cost estimate

`estCostCents` must accept the new `model: null` and treat it as \$0 (no model ran, no spend to attribute).

**Files:**
- Modify: `src/admin/lamplight-cost.ts:12-15`
- Test: `src/admin/lamplight-cost.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('lamplight-cost', ...)` block in `src/admin/lamplight-cost.test.ts`, after the `'unknown model defaults to 0 cents'` test:

```ts
  it('null model (no model ran) defaults to 0 cents', () => {
    expect(estCostCents(null, 9_999_999, 9_999_999)).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/lamplight-cost.test.ts`
Expected: FAIL — TypeScript rejects `null` because the first param is `string`.

- [ ] **Step 3: Make the signature null-tolerant**

In `src/admin/lamplight-cost.ts`, replace lines 12-15:

```ts
export function estCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICE_PER_M_TOKENS_CENTS[model] ?? { in: 0, out: 0 };
  return Math.round((tokensIn * p.in + tokensOut * p.out) / 1_000_000);
}
```

with:

```ts
export function estCostCents(model: string | null, tokensIn: number, tokensOut: number): number {
  const p = (model && PRICE_PER_M_TOKENS_CENTS[model]) || { in: 0, out: 0 };
  return Math.round((tokensIn * p.in + tokensOut * p.out) / 1_000_000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/admin/lamplight-cost.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/admin/lamplight-cost.ts src/admin/lamplight-cost.test.ts
git commit -m "feat(admin): estCostCents tolerates null model"
```

---

### Task 3: Migration — make `lamplight_usage.model` nullable

The `model text not null` constraint (migration 015) blocks `model: null` rows. Drop the NOT NULL. This is a non-destructive, online-safe DDL (relaxing a constraint never rewrites the table and takes only a brief `ACCESS EXCLUSIVE` lock to update the catalog).

**Files:**
- Create: `supabase/migrations/022_lamplight_usage_nullable_model.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/022_lamplight_usage_nullable_model.sql`:

```sql
-- 022_lamplight_usage_nullable_model.sql
--
-- Allow lamplight_usage.model to be NULL. Pre-model failures (quota block,
-- context-build throw) now record an honest NULL model instead of a fictional
-- model id, so cost attribution stays correct. See generation-lifecycle.ts.

alter table public.lamplight_usage
  alter column model drop not null;
```

- [ ] **Step 2: Verify migration applies cleanly (manual)**

Run (local Supabase): `supabase db reset` (or apply 022 against a scratch DB).
Expected: migration applies with no error; `\d public.lamplight_usage` shows `model` column WITHOUT `not null`.

If a local Supabase stack is not available in this environment, this step is verified at deploy time — note it in the PR description and proceed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_lamplight_usage_nullable_model.sql
git commit -m "feat(db): make lamplight_usage.model nullable (migration 022)"
```

---

### Task 4: Create the `runGeneration` coordinator seam (TDD, dead code until Task 6)

Build the module and its tests in isolation. Nothing calls it yet — it is additive dead code, so the suite stays green. The body returns data; the lifecycle owns quota, recording, and error classification.

**Files:**
- Create: `supabase/functions/_shared/generation-lifecycle.ts`
- Test: `supabase/functions/_shared/generation-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/generation-lifecycle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runGeneration, type GenerationLifecycleDeps } from './generation-lifecycle';
import type { UsageRow } from './usage';

function makeDeps(over: Partial<GenerationLifecycleDeps> = {}): {
  deps: GenerationLifecycleDeps;
  recorded: UsageRow[];
} {
  const recorded: UsageRow[] = [];
  const deps: GenerationLifecycleDeps = {
    checkQuota: async () => ({ ok: true }),
    recordUsage: async (row) => {
      recorded.push(row);
    },
    classifyError: () => 'unknown',
    ...over,
  };
  return { deps, recorded };
}

const meta = { userId: 'u1', artifactKind: 'daily_devotion' };

describe('runGeneration', () => {
  it('quota blocked: returns 429, records an error row with model:null, does NOT run body', async () => {
    const { deps, recorded } = makeDeps({
      checkQuota: async () => ({ ok: false, reason: 'user_quota' }),
    });
    let bodyRan = false;
    const out = await runGeneration(deps, meta, async () => {
      bodyRan = true;
      return { response: { ok: true }, usage: null };
    });
    expect(bodyRan).toBe(false);
    expect(out.status).toBe(429);
    expect(out.response).toEqual({ error: 'quota_exceeded', reason: 'user_quota' });
    await Promise.resolve(); // drain fire-and-forget record
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      user_id: 'u1',
      artifact_kind: 'daily_devotion',
      model: null,
      tokens_in: 0,
      tokens_out: 0,
      status: 'error',
      error_code: 'quota_exceeded',
    });
  });

  it('success with usage: returns 200 with body response and records the merged usage row', async () => {
    const { deps, recorded } = makeDeps();
    const out = await runGeneration(deps, meta, async () => ({
      response: { ok: true, artifact_id: 'a1' },
      usage: { model: 'claude-sonnet-4-6', tokens_in: 10, tokens_out: 20, status: 'ok' },
    }));
    expect(out.status).toBe(200);
    expect(out.response).toEqual({ ok: true, artifact_id: 'a1' });
    await Promise.resolve();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      user_id: 'u1',
      artifact_kind: 'daily_devotion',
      model: 'claude-sonnet-4-6',
      tokens_in: 10,
      tokens_out: 20,
      status: 'ok',
    });
  });

  it('success with usage:null: returns 200 and records NOTHING (cache hit / no_notes)', async () => {
    const { deps, recorded } = makeDeps();
    const out = await runGeneration(deps, meta, async () => ({
      response: { ok: true, cached: true },
      usage: null,
    }));
    expect(out.status).toBe(200);
    await Promise.resolve();
    expect(recorded).toHaveLength(0);
  });

  it('body throws: records an error row with classifyError(err) and rethrows', async () => {
    const { deps, recorded } = makeDeps({
      classifyError: () => 'no_embedding',
    });
    const boom = new Error('embedding missing');
    await expect(
      runGeneration(deps, meta, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    await Promise.resolve();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      user_id: 'u1',
      artifact_kind: 'daily_devotion',
      model: null,
      tokens_in: 0,
      tokens_out: 0,
      status: 'error',
      error_code: 'no_embedding',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/generation-lifecycle.test.ts`
Expected: FAIL — module `./generation-lifecycle` does not exist.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/generation-lifecycle.ts`:

```ts
// Coordinator seam for billable Lamplight generation. Wraps a per-kind body
// with the cross-cutting concerns that were previously smeared across index.ts
// and each pipeline: the quota gate, single-site usage recording, and error
// classification. The body returns DATA (a GenerationOutcome), never side
// effects — so this module is node-unit-testable with plain fakes.
//
// What it does NOT own: HTTP/CORS, auth, payload validation, opt-in gating.
// Those stay in the edge function shell (index.ts).

import type { UsageRow, UsageCore } from './usage.ts';

export interface GenerationOutcome {
  response: unknown;
  // The usage to record for this call, or null to record nothing (cache hit,
  // no_notes — a path that incurred no model spend).
  usage: UsageCore | null;
}

export interface GenerationLifecycleDeps {
  checkQuota: (userId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  recordUsage: (row: UsageRow) => Promise<void>;
  classifyError: (err: unknown) => string;
}

export interface GenerationMeta {
  userId: string;
  artifactKind: string;
}

export async function runGeneration(
  deps: GenerationLifecycleDeps,
  meta: GenerationMeta,
  body: () => Promise<GenerationOutcome>,
): Promise<{ status: number; response: unknown }> {
  // Fire-and-forget recording, single site. A usage-table outage must never
  // break the primary work path.
  const record = (core: UsageCore) => {
    void deps
      .recordUsage({ ...core, user_id: meta.userId, artifact_kind: meta.artifactKind })
      .catch(() => {});
  };

  const quota = await deps.checkQuota(meta.userId);
  if (!quota.ok) {
    record({ model: null, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'quota_exceeded' });
    return { status: 429, response: { error: 'quota_exceeded', reason: quota.reason } };
  }

  try {
    const outcome = await body();
    if (outcome.usage) record(outcome.usage);
    return { status: 200, response: outcome.response };
  } catch (err) {
    record({ model: null, tokens_in: 0, tokens_out: 0, status: 'error', error_code: deps.classifyError(err) });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/_shared/generation-lifecycle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/generation-lifecycle.ts supabase/functions/_shared/generation-lifecycle.test.ts
git commit -m "feat(lamplight): add runGeneration coordinator seam"
```

---

### Task 5: Surface `usage` on the three pipeline result types (additive — pipelines still record internally)

Each pipeline gains a `usage: UsageCore | null` field on every arm of its result union, populated from the real model + tokens it already has in scope. This task is purely ADDITIVE: the internal `recordLamplightUsage` calls STAY (removed in Task 6), so behavior is unchanged and the suite stays green. The new field is unused until Task 6 wires `index.ts`.

**Files:**
- Modify: `supabase/functions/lamplight-generate/pipeline.ts` (smoke)
- Modify: `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts`
- Modify: `supabase/functions/lamplight-generate/connection-why-pipeline.ts`
- Test: `supabase/functions/lamplight-generate/pipeline.test.ts`
- Test: `supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts`
- Test: `supabase/functions/lamplight-generate/connection-why-pipeline.test.ts`

#### 5a — Smoke pipeline

- [ ] **Step 1: Write the failing test**

In `supabase/functions/lamplight-generate/pipeline.test.ts`, extend the `'happy path'` test (lines 41-49) to assert the new field:

```ts
  it('happy path: validators pass on first attempt', async () => {
    const { llm } = adapterThatReturns([cleanArtifact]);
    const result = await runSmokeTestPipeline({ llm, ctx: makeCtx() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.artifact.sections).toHaveLength(1);
      expect(result.usage).toEqual({
        model: 'claude-sonnet-4-6',
        tokens_in: 10,
        tokens_out: 20,
        status: 'ok',
      });
    }
  });
```

And extend the `'no_notes short-circuit'` test (lines 79-91) — add inside its `if (!result.ok)` block:

```ts
      expect(result.usage).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/pipeline.test.ts`
Expected: FAIL — `result.usage` is not a property on the result type (compile error / undefined).

- [ ] **Step 3: Implement on the smoke pipeline**

In `supabase/functions/lamplight-generate/pipeline.ts`:

(a) Add the import after line 5 (`import type { LLMAdapter } ...`):

```ts
import type { UsageCore } from '../_shared/usage.ts';
```

(b) Add `usage` to both arms of `PipelineResult` (lines 49-65). In the `ok: true` arm, after `retrieval: { ... };` add a line; in the `ok: false` arm, after `attempts: number;` add a line. The two arms become:

```ts
export type PipelineResult =
  | {
      ok: true;
      artifact: SmokeTestArtifact;
      model_used: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
      retrieval: { note_neighbors: number; bible_passages: number; reranked: boolean };
    }
  | {
      ok: false;
      reason: 'no_notes' | 'validators_failed';
      violations?: { citation: CitationViolation[]; content: ContentRuleViolation[] };
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    };
```

(c) The `no_notes` early return (line 76) — add `usage: null`:

```ts
    return { ok: false, reason: 'no_notes', prompt_version: promptVersion, attempts: 0, usage: null };
```

(d) Capture tokens from the adapter. Replace line 93:

```ts
    const { parsed, modelUsed } = await args.llm.generate<SmokeTestArtifact>({
```

with:

```ts
    const { parsed, modelUsed, promptTokens, completionTokens } = await args.llm.generate<SmokeTestArtifact>({
```

(e) The success return (lines 114-125) — add `usage`:

```ts
      return {
        ok: true,
        artifact: parsed,
        model_used: modelUsed,
        prompt_version: promptVersion,
        attempts,
        usage: { model: modelUsed, tokens_in: promptTokens ?? 0, tokens_out: completionTokens ?? 0, status: 'ok' },
        retrieval: {
          note_neighbors: ctx.notes.length,
          bible_passages: ctx.passages.length,
          reranked: ctx.rerankUsed,
        },
      };
```

(f) The `validators_failed` final return (lines 130-137) — add `usage: null` (smoke records nothing on failure; see plan header behavior change #4):

```ts
  return {
    ok: false,
    reason: 'validators_failed',
    violations: lastViolations!,
    model_used: lastModelUsed,
    prompt_version: promptVersion,
    attempts,
    usage: null,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/pipeline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-generate/pipeline.ts supabase/functions/lamplight-generate/pipeline.test.ts
git commit -m "feat(lamplight): surface usage on smoke pipeline result"
```

#### 5b — Daily-devotion pipeline

- [ ] **Step 1: Write the failing test**

In `supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts`, extend the `'happy path'` test. After line 168 (`expect(result.artifact.scripture.ref).toBe('Psalm 23:4');`), inside the `if (result.ok)` block, add:

```ts
      expect(result.usage).toEqual({
        model: 'claude-sonnet-4-6',
        tokens_in: 10,
        tokens_out: 20,
        status: 'ok',
      });
```

And in the `'idempotency'` test, inside its `if (result.ok)` block (after line 122), add:

```ts
      expect(result.usage).toBeNull();
```

And in the `'hard-fail'` test, inside its `if (!result.ok)` block (after line 320), add:

```ts
      expect(result.usage).toEqual({
        model: 'claude-sonnet-4-6',
        tokens_in: 0,
        tokens_out: 0,
        status: 'error',
        error_code: 'validators_failed',
      });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts`
Expected: FAIL — `result.usage` not on the result type.

- [ ] **Step 3: Implement on the daily-devotion pipeline**

In `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts`:

(a) Add `UsageCore` to the usage import (line 24). Replace:

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
```

with:

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
import type { UsageCore } from '../_shared/usage.ts';
```

(b) Add `usage: UsageCore | null;` to both arms of `DailyDevotionPipelineResult` (lines 43-61) — after `cached: boolean;` in the `ok:true` arm and after `attempts: number;` in the `ok:false` arm:

```ts
export type DailyDevotionPipelineResult =
  | {
      ok: true;
      artifact: DailyDevotion;
      artifact_id: string;
      model_used: string;
      prompt_version: string;
      attempts: number;
      cached: boolean;
      usage: UsageCore | null;
      retrieval?: { note_neighbors: number; bible_passages: number; reranked: boolean };
    }
  | {
      ok: false;
      reason: 'no_notes' | 'validators_failed';
      violations?: { citation: CitationViolation[]; content: ContentRuleViolation[] };
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    };
```

(c) Idempotency cache-hit return (lines 80-90) — add `usage: null` before the closing brace:

```ts
  if (existing.data) {
    return {
      ok: true,
      artifact: existing.data.body as DailyDevotion,
      artifact_id: existing.data.id as string,
      model_used: (existing.data.model_used as string) ?? 'claude-sonnet-4-6',
      prompt_version: (existing.data.prompt_version as string) ?? promptVersion,
      attempts: 0,
      cached: true,
      usage: null,
    };
  }
```

(d) `no_notes` return (line 93) — add `usage: null`:

```ts
    return { ok: false, reason: 'no_notes', prompt_version: promptVersion, attempts: 0, usage: null };
```

(e) Race-path cached return (lines 177-185) — add `usage` (real tokens were spent here, even though `cached:true`):

```ts
        return {
          ok: true,
          artifact: refetch.data.body as DailyDevotion,
          artifact_id: refetch.data.id as string,
          model_used: (refetch.data.model_used as string) ?? modelUsed,
          prompt_version: (refetch.data.prompt_version as string) ?? promptVersion,
          attempts,
          cached: true,
          usage: { model: modelUsed, tokens_in: promptTokens ?? 0, tokens_out: completionTokens ?? 0, status: 'ok' },
        };
```

(f) Fresh-success return (lines 196-209) — add `usage`:

```ts
      return {
        ok: true,
        artifact: parsed,
        artifact_id: insertRes.data.id as string,
        model_used: modelUsed,
        prompt_version: promptVersion,
        attempts,
        cached: false,
        usage: { model: modelUsed, tokens_in: promptTokens ?? 0, tokens_out: completionTokens ?? 0, status: 'ok' },
        retrieval: {
          note_neighbors: ctx.notes.length,
          bible_passages: ctx.passages.length,
          reranked: ctx.rerankUsed,
        },
      };
```

(g) `validators_failed` final return (lines 224-231) — add `usage`:

```ts
  return {
    ok: false,
    reason: 'validators_failed',
    violations: lastViolations!,
    model_used: lastModelUsed,
    prompt_version: promptVersion,
    attempts,
    usage: { model: lastModelUsed, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'validators_failed' },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts`
Expected: PASS (all 7 tests). The `usageInserts` assertions still pass — internal recording is untouched in this task.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-generate/daily-devotion-pipeline.ts supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts
git commit -m "feat(lamplight): surface usage on daily-devotion pipeline result"
```

#### 5c — Connection-why pipeline

- [ ] **Step 1: Write the failing test**

In `supabase/functions/lamplight-generate/connection-why-pipeline.test.ts`, extend `'cache miss generates, validates, upserts'`. After line 126 (inside `if (result.ok)`), add:

```ts
      expect(result.usage).toEqual({
        model: 'claude-haiku-4-5-20251001',
        tokens_in: 100,
        tokens_out: 20,
        status: 'ok',
      });
```

And in `'cache hit returns cached why without LLM call'`, inside its `if (result.ok)` block (after line 107), add:

```ts
      expect(result.usage).toBeNull();
```

And in `'hard fail: both attempts violate, no persistence'`, inside its `if (!result.ok)` block (after line 189), add:

```ts
      expect(result.usage).toEqual({
        model: 'claude-haiku-4-5-20251001',
        tokens_in: 0,
        tokens_out: 0,
        status: 'error',
        error_code: 'validators_failed',
      });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-generate/connection-why-pipeline.test.ts`
Expected: FAIL — `result.usage` not on the result type.

- [ ] **Step 3: Implement on the connection-why pipeline**

In `supabase/functions/lamplight-generate/connection-why-pipeline.ts`:

(a) Add `UsageCore` to the usage import (line 24). Replace:

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
```

with:

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
import type { UsageCore } from '../_shared/usage.ts';
```

(b) Add `usage: UsageCore | null;` to both arms of `ConnectionWhyPipelineResult` (lines 36-55) — after `attempts: number;` in each arm:

```ts
export type ConnectionWhyPipelineResult =
  | {
      ok: true;
      why: string;
      cached: boolean;
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    }
  | {
      ok: false;
      reason: 'validators_failed';
      violations: {
        shape: ConnectionShapeViolation[];
        content: ContentRuleViolation[];
      };
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    };
```

(c) Cache-hit return (lines 90-98) — add `usage: null`:

```ts
  if (cached && cached.content_hash === ctx.compositeHash) {
    return {
      ok: true,
      why: cached.why as string,
      cached: true,
      prompt_version: promptVersion,
      attempts: 0,
      usage: null,
    };
  }
```

(d) Fresh-success return (lines 157-164) — add `usage`:

```ts
      return {
        ok: true,
        why: parsed.why,
        cached: false,
        model_used: modelUsed,
        prompt_version: promptVersion,
        attempts,
        usage: { model: modelUsed, tokens_in: promptTokens ?? 0, tokens_out: completionTokens ?? 0, status: 'ok' },
      };
```

(e) `validators_failed` final return (lines 178-185) — add `usage`:

```ts
  return {
    ok: false,
    reason: 'validators_failed',
    violations: lastViolations!,
    model_used: lastModelUsed,
    prompt_version: promptVersion,
    attempts,
    usage: { model: lastModelUsed, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'validators_failed' },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/lamplight-generate/connection-why-pipeline.test.ts`
Expected: PASS (all 7 tests). The `usageInserts` assertions still pass — internal recording untouched here.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-generate/connection-why-pipeline.ts supabase/functions/lamplight-generate/connection-why-pipeline.test.ts
git commit -m "feat(lamplight): surface usage on connection-why pipeline result"
```

---

### Task 6: Atomic cutover — wire `index.ts` to `runGeneration`, delete all inline recording

The seam now exists and every pipeline reports `usage`. This task flips the dispatcher: `index.ts` wraps each kind's body in `runGeneration`, moving the quota gate and context build INSIDE the wrapped body, and DELETES the inline `recordLamplightUsage` calls — both the 6 sites in `index.ts` and the internal calls in the daily and connection pipelines. Recording now happens at exactly one site (the lifecycle). This is one commit so the suite is never half-cut.

**Files:**
- Modify: `supabase/functions/lamplight-generate/index.ts:33-228`
- Modify: `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts` (delete 3 internal `recordLamplightUsage` calls)
- Modify: `supabase/functions/lamplight-generate/connection-why-pipeline.ts` (delete 2 internal `recordLamplightUsage` calls)
- Test: `supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts` (update `usageInserts` assertions → length 0)
- Test: `supabase/functions/lamplight-generate/connection-why-pipeline.test.ts` (update `usageInserts` assertions → length 0)

- [ ] **Step 1: Update the pipeline tests to expect NO internal recording**

The pipelines stop recording; the lifecycle does it now (and the lifecycle is covered by Task 4). So the pipeline-level `usageInserts` capture must now be empty.

In `daily-devotion-pipeline.test.ts`, in the `'happy path'` test, replace lines 178-180:

```ts
    await Promise.resolve(); // let the fire-and-forget recordUsage microtask drain
    expect(usageInserts).toHaveLength(1);
    expect(usageInserts[0]).toMatchObject({ artifact_kind: 'daily_devotion', status: 'ok' });
```

with:

```ts
    await Promise.resolve(); // drain any stray microtask
    // The pipeline no longer records usage — the lifecycle (runGeneration) does.
    expect(usageInserts).toHaveLength(0);
```

In `connection-why-pipeline.test.ts`, in the `'cache miss generates, validates, upserts'` test, replace lines 133-135:

```ts
    await Promise.resolve(); // let the fire-and-forget recordUsage microtask drain
    expect(usageInserts).toHaveLength(1);
    expect(usageInserts[0]).toMatchObject({ artifact_kind: 'connection_card_why', status: 'ok' });
```

with:

```ts
    await Promise.resolve(); // drain any stray microtask
    // The pipeline no longer records usage — the lifecycle (runGeneration) does.
    expect(usageInserts).toHaveLength(0);
```

- [ ] **Step 2: Run the pipeline tests to verify they now FAIL**

Run: `npx vitest run supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts supabase/functions/lamplight-generate/connection-why-pipeline.test.ts`
Expected: FAIL — pipelines still record internally (`usageInserts` is length 1, test wants 0).

- [ ] **Step 3: Delete internal recording from the daily-devotion pipeline**

In `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts`:

(a) Delete the import added/edited in Task 5b — change:

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
import type { UsageCore } from '../_shared/usage.ts';
```

to:

```ts
import type { UsageCore } from '../_shared/usage.ts';
```

(b) Delete the race-path `recordLamplightUsage` block (lines 169-176):

```ts
        void recordLamplightUsage(args.supabase, {
          user_id: args.userId,
          model: modelUsed,
          artifact_kind: 'daily_devotion',
          tokens_in: promptTokens ?? 0,
          tokens_out: completionTokens ?? 0,
          status: 'ok',
        }).catch(() => {});
```

(c) Delete the fresh-success `recordLamplightUsage` block (lines 188-195):

```ts
      void recordLamplightUsage(args.supabase, {
        user_id: args.userId,
        model: modelUsed,
        artifact_kind: 'daily_devotion',
        tokens_in: promptTokens ?? 0,
        tokens_out: completionTokens ?? 0,
        status: 'ok',
      }).catch(() => {});
```

(d) Delete the `validators_failed` `recordLamplightUsage` block (lines 215-223):

```ts
  void recordLamplightUsage(args.supabase, {
    user_id: args.userId,
    model: lastModelUsed,
    artifact_kind: 'daily_devotion',
    tokens_in: 0,
    tokens_out: 0,
    status: 'error',
    error_code: 'validators_failed',
  }).catch(() => {});
```

- [ ] **Step 4: Delete internal recording from the connection-why pipeline**

In `supabase/functions/lamplight-generate/connection-why-pipeline.ts`:

(a) Change the import:

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
import type { UsageCore } from '../_shared/usage.ts';
```

to:

```ts
import type { UsageCore } from '../_shared/usage.ts';
```

(b) Delete the fresh-success `recordLamplightUsage` block (lines 149-156):

```ts
      void recordLamplightUsage(supabase, {
        user_id: ctx.userId,
        model: modelUsed,
        artifact_kind: 'connection_card_why',
        tokens_in: promptTokens ?? 0,
        tokens_out: completionTokens ?? 0,
        status: 'ok',
      }).catch(() => {});
```

(c) Delete the `validators_failed` `recordLamplightUsage` block (lines 169-177):

```ts
  void recordLamplightUsage(supabase, {
    user_id: ctx.userId,
    model: lastModelUsed,
    artifact_kind: 'connection_card_why',
    tokens_in: 0,
    tokens_out: 0,
    status: 'error',
    error_code: 'validators_failed',
  }).catch(() => {});
```

- [ ] **Step 5: Run the pipeline tests to verify they PASS**

Run: `npx vitest run supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts supabase/functions/lamplight-generate/connection-why-pipeline.test.ts`
Expected: PASS. (`ctx.userId` on the connection pipeline is now unused by the body but still part of the context type — leave it; `index.ts` and the cache key derivation reference the context, and removing the field is out of scope.)

- [ ] **Step 6: Rewire `index.ts` — imports**

In `supabase/functions/lamplight-generate/index.ts`, replace the usage import (line 33):

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
```

with:

```ts
import { recordLamplightUsage } from '../_shared/usage.ts';
import { runGeneration, type GenerationLifecycleDeps } from '../_shared/generation-lifecycle.ts';
```

(`recordLamplightUsage` stays imported — it is now the `recordUsage` dep wired into the lifecycle.)

- [ ] **Step 7: Rewire `index.ts` — replace the quota block and all three dispatch branches**

Replace the entire span from line 100 (`const quotaCfg = resolveQuotaLimits(Deno.env);`) through line 225 (the closing `}` of the `connection_card_why` branch, immediately before `return jsonResp({ error: 'unknown kind' }, 400);`) with:

```ts
  const quotaCfg = resolveQuotaLimits(Deno.env);
  const voyageDeps: VoyageDeps = { apiKey: voyageKey, fetch };
  const rerankEnabled = Deno.env.get('RERANK_ENABLED') === 'true';
  const llm = createAnthropicAdapter({ apiKey: anthropicKey, fetch });

  // The coordinator seam owns quota + usage recording + error classification.
  // checkQuota maps the internal QuotaResult.reason onto the lifecycle's shape;
  // recordUsage is the single recording site for the whole function.
  const lifecycleDeps: GenerationLifecycleDeps = {
    checkQuota: async (uid) => {
      const quota = await checkQuota(
        supabaseQuotaDeps(supabase),
        quotaCfg.generation,
        quotaCfg.global,
        { userId: uid, nowMs: Date.now() },
      );
      return quota.ok ? { ok: true } : { ok: false, reason: quota.reason };
    },
    recordUsage: (row) => recordLamplightUsage(supabase, row),
    classifyError: classifyGenerateError,
  };

  if (body.kind === 'smoke_test') {
    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'smoke_test' },
      async () => {
        const ctx = await buildSmokeTestContext(supabase, { userId, voyageDeps, rerankEnabled });
        const result = await runSmokeTestPipeline({ llm, ctx });
        return { response: result, usage: result.usage };
      },
    );
    return jsonResp(response, status);
  }

  if (body.kind === 'daily_devotion') {
    if (typeof body.local_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.local_date)) {
      return jsonResp({ error: 'bad local_date' }, 400);
    }
    const localDate = body.local_date;
    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'daily_devotion' },
      async () => {
        const ctx = await buildDailyDevotionContext(supabase, {
          userId, localDate, voyageDeps, rerankEnabled,
        });
        const result = await runDailyDevotionPipeline({ llm, supabase, ctx, userId, localDate });
        return { response: result, usage: result.usage };
      },
    );
    return jsonResp(response, status);
  }

  if (body.kind === 'connection_card_why') {
    if (
      typeof body.source_note_id !== 'string' ||
      typeof body.related_note_id !== 'string' ||
      body.source_note_id === body.related_note_id
    ) {
      return jsonResp({ error: 'bad payload' }, 400);
    }
    const sourceNoteId = body.source_note_id;
    const relatedNoteId = body.related_note_id;
    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'connection_card_why' },
      async (): Promise<{ response: unknown; usage: import('../_shared/usage.ts').UsageCore | null }> => {
        const minSimilarity = await loadConnectionMinSimilarity(supabase);
        const ctxResult = await buildConnectionWhyContext(supabase, {
          userId, sourceNoteId, relatedNoteId, minSimilarity,
        });
        if (ctxResult.kind === 'no_embedding') {
          return {
            response: { ok: false, reason: 'no_embedding', attempts: 0 },
            usage: { model: null, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'no_embedding' },
          };
        }
        if (ctxResult.kind === 'not_neighbor') {
          return {
            response: { ok: false, reason: 'not_neighbor', attempts: 0 },
            usage: { model: null, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'not_neighbor' },
          };
        }
        const result = await runConnectionWhyPipeline({ llm, supabase, ctx: ctxResult.context });
        return { response: result, usage: result.usage };
      },
    );
    return jsonResp(response, status);
  }
```

Note: the original `voyageDeps` / `rerankEnabled` / `llm` declarations at old lines 109-111 are now part of the replacement block above — confirm they no longer appear twice. If lines 109-111 fall outside the replaced span in your working copy, delete the duplicate declarations so each is declared once.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS — entire suite green, including the new `generation-lifecycle.test.ts` and the updated pipeline tests.

- [ ] **Step 9: Type-check the edge function (Deno)**

Run: `deno check supabase/functions/lamplight-generate/index.ts`
Expected: no type errors. (If `deno` is unavailable in this environment, rely on the editor/`tsc` surfaced through vitest and note it in the PR.)

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/lamplight-generate/index.ts \
        supabase/functions/lamplight-generate/daily-devotion-pipeline.ts \
        supabase/functions/lamplight-generate/connection-why-pipeline.ts \
        supabase/functions/lamplight-generate/daily-devotion-pipeline.test.ts \
        supabase/functions/lamplight-generate/connection-why-pipeline.test.ts
git commit -m "refactor(lamplight): route all generation through runGeneration seam

Single-site usage recording via the coordinator; quota-block and
context-build failures now record honest model:null error rows."
```

---

## Self-Review

**Spec coverage:**
- Decision "Lifecycle wrapper (decorator)" → Task 4 (`runGeneration`).
- Decision "model: null, 0 tokens for pre-model failures" → Task 1 (type) + Task 3 (schema) + lifecycle quota/throw paths.
- Decision "Include migration 022 + cost-map fix" → Task 3 + Task 2.
- Decision "Record quota_exceeded as error row" → Task 4 quota-block branch.
- All 6 inline recording sites in `index.ts` + 5 internal pipeline sites deleted → Task 6.
- CONTEXT.md glossary entry → already written in the prior session (not re-done here).

**Placeholder scan:** No "TBD"/"handle errors"/"similar to Task N". Every code step shows full literal code.

**Type consistency:**
- `UsageCore = Omit<UsageRow,'user_id'|'artifact_kind'>` defined in Task 1; consumed in Tasks 4, 5, 6.
- `GenerationOutcome { response: unknown; usage: UsageCore | null }` — every pipeline body returns exactly this shape (`{ response: result, usage: result.usage }`); `result.usage` is `UsageCore | null` on all three result unions (Task 5).
- `runGeneration` returns `{ status: number; response: unknown }`; `index.ts` destructures `{ status, response }` and calls `jsonResp(response, status)` — consistent.
- `checkQuota` dep returns `{ ok: true } | { ok: false; reason: string }`; the QuotaResult `.reason` is `'user_quota' | 'global_quota'` which widens to `string` — consistent.
- `recordUsage: (row: UsageRow) => Promise<void>`; `recordLamplightUsage(supabase, row)` returns `Promise<void>` — consistent.
- Smoke `validators_failed → usage: null` is the one deliberate behavior change vs. daily/connection (which record an error row) — documented in the header.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-04-generation-lifecycle.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
