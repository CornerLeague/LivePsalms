# Responses API Migration + Reasoning Efforts (Depth Overhaul slice 1a) — Implementation Plan

> **STATUS: COMPLETE** — shipped 2026-08-04 as `35e52c23` on `feat/responses-api-migration`. See §Completion record at the end for what changed versus this plan.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move `_shared/openai.ts` from Chat Completions to the **Responses API** so reasoning can be enabled per call, then adopt the effort map from the Phase-1 design: Waymarks on `deep/high`, study chat `deep/low` (insight `medium`), devotion `balanced/low`, judges/classifier/why `fast/none`. The `LLMAdapter` interface is preserved **exactly** — pipelines change only where they opt into `effort`/`maxTokens`.

**Design doc:** `docs/superpowers/specs/2026-08-04-lamplight-library-and-reasoning-design.md` (decisions 7–9). Depends on the Phase-0 commit (`c1173be7`).

**Architecture:** One transport rewrite inside `openai.ts` (request shaping, buffered parse, streaming SSE parse), with `ReasoningEffort` + tier defaults **folded into `openai.ts`** rather than the design's separate `reasoning-effort.ts` — a value-import cycle (`openai.ts` ⇄ `reasoning-effort.ts`) is the only thing the split would buy. *(Plan-level refinement of the design's file list; note it in the PR.)* `effort` threads through `generateWithRetry`/`generateStreamingWithRetry` configs into `GenerateInput`. Call sites then adopt efforts + raised `max_output_tokens` budgets.

**Tech Stack:** Deno edge functions (no Deno globals in `_shared` — vitest-importable), direct `fetch` (no SDK), Vitest 4 (`globals: false`, node env, import from `'vitest'`), `createToolJsonStreamParser` (unchanged — it consumes argument-string deltas regardless of transport).

## Global Constraints

- Branch: `feat/responses-api-migration` off `feat/lamplight-gpt-migration` (this depends on Phase-0 commit `c1173be7`; the parent branch squash-merges as one PR train per house workflow).
- **The `LLMAdapter` seam is frozen:** `generate`/`generateStream` signatures unchanged except the additive `effort?` on `GenerateInput`. No pipeline test may need changes except the ones this plan names.
- **`store: false` on every request** — the Responses API persists response objects by default; a journaling app must opt out. This is a privacy invariant, not an optimization; pin it in a test.
- Reasoning tokens count toward `max_output_tokens` AND toward billed output tokens. Budgets rise where effort > none (Task 6 table). `src/admin/lamplight-cost.ts` needs only a comment (same per-token prices; reasoning inflates `tokens_out`).
- Tier defaults after this slice: `fast → 'none'`, `balanced → 'low'`, `deep → 'low'` (design decision 8). Explicit `effort` at a call site always wins.
- **Step 0 of Task 2 is mandatory:** verify the exact request/event field names against the live OpenAI docs before coding; this plan's shapes are the design-doc's best knowledge, and fixtures must encode what the docs say **at implementation time**.
- Gates before done (run all three): `npx tsc -b` (exit 0) **and** `npx vitest run supabase/functions` (all green) **and** `npx eslint <touched files>`. Pre-existing noise (NOT ours): ~100 repo lint errors + failing `garden-scene` test + 2 `react-hooks/refs` errors in `useConnectionDiscovery.ts`.
- Commit only when the user asks. Messages: `feat(lamplight): …` present-tense.

## File Structure

**Modified:**
- `supabase/functions/_shared/openai.ts` — transport rewrite; `ReasoningEffort` type + `TIER_DEFAULT_EFFORT`; `GenerateInput.effort?`
- `supabase/functions/_shared/openai.test.ts` — full rewrite of request/response/stream fixtures
- `supabase/functions/_shared/generate-with-retry.ts` (+`.test.ts`) — thread `effort`
- `supabase/functions/_shared/generate-streaming.ts` (+`.test.ts`) — thread `effort`
- `supabase/functions/lamplight-generate/monthly-reflection-pipeline.ts` (+`.test.ts`) — `deep`/`high`/8192
- `supabase/functions/lamplight-chat/bible-chat-pipeline.ts` — `effort?` + `maxTokens?` args (default 2048)
- `supabase/functions/lamplight-chat/bible-chat-stream.ts` (+`.test.ts`) — thread `effort`/`maxTokens` deps
- `supabase/functions/lamplight-study/index.ts` — per-mode effort + budgets on both paths
- `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts` — 2048→4096 both entries (effort stays tier-default `low`)
- `supabase/functions/etymology-insight/index.ts` — explicit `effort: 'low'`
- `supabase/functions/transcribe-note/handler.ts` — explicit `effort: 'none'` (verbatim OCR wants no deliberation; cost floor)
- `src/admin/lamplight-cost.ts` — comment only

**New:** `scripts/smoke-openai-adapter.ts` (manual, env-gated live check).

---

### Task 1: `ReasoningEffort` + tier defaults + `GenerateInput.effort` (types only, no transport change yet)

**Files:** `_shared/openai.ts`, `_shared/openai.test.ts`

- [x] **Step 1: failing test** — in `openai.test.ts` add:

```ts
it('resolves effort from input.effort, else the tier default', async () => {
  // capture body like the existing request-shape tests
  await adapter.generate({ model: 'deep', system: 's', messages: msgs, tool });
  expect(bodyOf(calls[0]).reasoning).toEqual({ effort: 'low' });      // deep default
  await adapter.generate({ model: 'deep', effort: 'high', system: 's', messages: msgs, tool });
  expect(bodyOf(calls[1]).reasoning).toEqual({ effort: 'high' });     // explicit wins
  await adapter.generate({ model: 'fast', system: 's', messages: msgs, tool });
  expect(bodyOf(calls[2]).reasoning).toEqual({ effort: 'none' });     // fast default
});
```

- [x] **Step 2:** run `npx vitest run supabase/functions/_shared/openai.test.ts` — expect FAIL (no `reasoning` field yet; `effort` not a known input).
- [x] **Step 3: implement** in `openai.ts`:

```ts
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
// Per-tier default when a call names no effort (design decision 8). Explicit
// call-site effort always wins. 'balanced'/'deep' default LOW, not none — the
// entire point of the Responses migration is that forced function tools no
// longer require reasoning off.
export const TIER_DEFAULT_EFFORT: Record<LLMModel, ReasoningEffort> = {
  fast: 'none', balanced: 'low', deep: 'low',
};
```

`GenerateInput` gains `effort?: ReasoningEffort`. Delete the `REASONING_EFFORT` constant **and its Chat-Completions rationale comment** (openai.ts:33-40) — Task 2 replaces the transport it described. Resolution helper: `const effortOf = (i: GenerateInput) => i.effort ?? TIER_DEFAULT_EFFORT[i.model];`
- [x] **Step 4:** test from Step 1 still fails on the *endpoint/body shape* until Task 2 — acceptable ONLY if Steps 1–3 are folded into Task 2's commit; otherwise stub `reasoning: { effort: effortOf(input) }` into the current Chat-Completions body as `reasoning_effort` and convert in Task 2. Prefer folding: Tasks 1–2 are one atomic change; the checkbox split exists for review clarity.

### Task 2: Request shaping → Responses API

**Files:** `_shared/openai.ts`, `_shared/openai.test.ts`

- [x] **Step 0 (mandatory): verify shapes against live docs** (platform.openai.com → API reference → Responses). Confirm: endpoint path; `instructions` vs system-role input item; input item content types (`input_text`, `input_image` with data-URI `image_url`); **flattened** function tool `{type:'function', name, description, parameters, strict}`; `tool_choice: {type:'function', name}`; `max_output_tokens`; `reasoning: {effort}` accepted values on gpt-5.6 (`none…max`); `store`; usage field names (`input_tokens`/`output_tokens`, `output_tokens_details.reasoning_tokens`); streaming event `type` names used in Task 4. Record any deltas as comments in the fixtures.
- [x] **Step 1: rewrite the request-shape tests** (`sends the documented request shape`, tier-mapping tests, `defaults max_completion_tokens…` → `max_output_tokens`, multimodal test) to assert the Responses body:

```ts
expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
const body = bodyOf(calls[0]);
expect(body.instructions).toBe('system text');
expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]);
expect(body.tools).toEqual([{ type: 'function', name: 'emit_x', description: 'd', parameters: schema, strict: true }]);
expect(body.tool_choice).toEqual({ type: 'function', name: 'emit_x' });
expect(body.max_output_tokens).toBe(2048);
expect(body.store).toBe(false);                    // privacy invariant — journaling data
expect(body.reasoning).toEqual({ effort: 'low' }); // balanced default
```

Multimodal: `ImageBlock` → `{ type: 'input_image', image_url: 'data:image/jpeg;base64,…' }`.
- [x] **Step 2:** run — expect FAIL against the old builder.
- [x] **Step 3: implement** `toInput` (replaces `toMessages`; assistant history rows keep `role:'assistant'` with `output_text` content items — verify naming in Step 0) and `buildBody` → the shape above, `stream: true` variant unchanged in mechanism. Update the file-header comment block (openai.ts:1-17) to describe the Responses transport and WHY (reasoning + forced tools now coexist; `store:false` invariant).
- [x] **Step 4:** run `npx vitest run supabase/functions/_shared/openai.test.ts` — request-shape + Task-1 tests PASS (response-parse tests fail until Task 3).

### Task 3: Buffered response parsing + error taxonomy

**Files:** `_shared/openai.ts`, `_shared/openai.test.ts`

- [x] **Step 1: rewrite response fixtures** for `generate`: success = `{ model, usage: { input_tokens, output_tokens }, output: [{ type: 'function_call', name: 'emit_x', arguments: '{"…"}' }] }` (plus an ignorable `reasoning` output item in at least one fixture, so the parser provably skips non-function items). Rewrite these cases against Responses shapes, preserving each error contract string:
  - no matching `function_call` → `openai: no tool_call matching name="…"` (keep message; append `status`/`incomplete_details.reason` when present)
  - refusal (message item whose content includes a `refusal` part) → `openai refusal: …`
  - truncated arguments + `status: 'incomplete'`, `incomplete_details: { reason: 'max_output_tokens' }` → parse error message carries the truncation hint
  - 429 retry ×3 with backoff, then success; persistent 5xx throws after 3; 4xx non-429 no retry — all UNCHANGED mechanics, fixtures re-shaped only
  - usage mapping: `promptTokens = usage.input_tokens`, `completionTokens = usage.output_tokens`
- [x] **Step 2:** expect FAIL. **Step 3: implement** `generateOnce` against `output[]`. **Step 4:** full `openai.test.ts` buffered suite green.

### Task 4: Streaming rewrite

**Files:** `_shared/openai.ts`, `_shared/openai.test.ts`

- [x] **Step 1: fixture SSE transcripts** (verified names from Task 2 Step 0; expected set): `response.output_item.added` (function_call item), repeated `response.function_call_arguments.delta` `{ delta: '…' }` — these feed `createToolJsonStreamParser` exactly as the old `tool_calls[0].function.arguments` fragments did — `response.function_call_arguments.done`, `response.completed` `{ response: { model, usage: {…} } }`. Test cases: (a) happy path streams field events + resolves parsed object + usage; (b) mid-stream `error`/`response.failed` event → throw `openai stream error: …`; (c) `response.incomplete` with `reason: 'max_output_tokens'` → throw the truncation error (contract string preserved: `truncated before the tool call closed`); (d) refusal-bearing message item → `openai stream refusal: …`; (e) `modelUsed` comes from the completed event's `response.model`.
- [x] **Step 2:** expect FAIL. **Step 3: implement** — keep the line-buffered `data:` reader; switch the per-event dispatch to `evt.type`. **Step 4:** entire `openai.test.ts` green.
- [x] **Step 5 (cross-check):** `npx vitest run supabase/functions` — every pipeline/stream suite green with zero edits outside `openai.test.ts` (proves the seam held).

### Task 5: Thread `effort` through the retry/streaming wrappers

**Files:** `generate-with-retry.ts` (+test), `generate-streaming.ts` (+test)

- [x] **Step 1: failing tests** — config gains `effort?: ReasoningEffort`; fake adapters record `input.effort`; assert it forwards on attempt 1 AND the stricter retry (both wrappers, both attempts).
- [x] **Step 2:** FAIL → **Step 3:** add `effort: cfg.effort` at the four `llm.generate*` call sites (retry attempt + streaming attempt-1 + streaming retry). **Step 4:** green.

### Task 6: Call-site adoption (the effort map lands)

| Call site | model | effort | maxTokens | change |
|---|---|---|---|---|
| monthly reflection (`monthly-reflection-pipeline.ts`) | `balanced` → **`deep`** | **`high`** | 2048 → **8192** | the headline upgrade; sweep-driven, Batch-friendly later |
| study chat (both paths, `lamplight-study/index.ts`) | `deep` (Phase-0) | `'low'` chat / `'medium'` insight (explicit per mode) | 1024 → **4096** chat / **3072** insight | thread via new `effort`/`maxTokens` args + stream deps |
| journaling chat (`lamplight-chat/index.ts`) | `balanced` | tier default `low` | 1024 → **2048** | budget headroom only (reasoning now shares the ceiling) — plan-level safety refinement of design decision 9 |
| daily devotion (both entries) | `balanced` | tier default `low` | 2048 → **4096** | same rationale |
| connection-why | `fast` | default `none` | 256 | no change |
| register judge / Layer-C classifier | `fast` | default `none` | 512 | no change |
| etymology insight (`etymology-insight/index.ts`) | `deep` | **`'low'` explicit** | default 2048 | one line |
| transcription (`transcribe-note/handler.ts`) | `balanced` | **`'none'` explicit** | 4096 | verbatim OCR — no deliberation, no reasoning spend |

- [x] **Step 1: failing tests** — (a) `monthly-reflection-pipeline.test.ts:91` flips `calls[0].model` `'balanced'` → `'deep'`; add `expect(calls[0].effort).toBe('high')` and a `maxTokens` assertion; (b) `bible-chat-stream.test.ts` model-forwarding tests extend to `effort`/`maxTokens` passthrough; (c) new pipeline-arg tests in the chat pipeline for `maxTokens` default 2048.
- [x] **Step 2:** FAIL → **Step 3: implement** per the table — `runBibleChatPipeline`/`runBibleChatStreaming` gain `effort?`+`maxTokens?` (default `2048`), `BibleChatStreamDeps` threads both, `lamplight-study/index.ts` passes per-mode values on BOTH paths (the Phase-0 drift lesson: streaming and buffered must move together).
- [x] **Step 4:** `npx vitest run supabase/functions` green. Check `reflection-voice-eval.test.ts` still passes (it pins `calls[1].model === 'fast'` — the judge — which is unchanged).
- [x] **Step 5:** add the one-line comment in `src/admin/lamplight-cost.ts`: reasoning tokens are billed as output tokens; per-token prices unchanged.

### Task 7: Live smoke script (manual gate)

**File:** `scripts/smoke-openai-adapter.ts` (match the runner convention of the existing `scripts/*.ts`; env `OPENAI_API_KEY`, never committed output)

- [x] Buffered call: `deep`/`high`, trivial `emit_echo` tool → prints parsed object + `{input_tokens, output_tokens, reasoning_tokens}`.
- [x] Streaming call: same tool, prints delta count + assembled object + usage.
- [x] Run it once before merge; paste the (non-sensitive) usage summary into the PR. This is the interim for the 1d eval harness — the design's "eval before/after" for 1a.

### Task 8: Completion gates + deploy notes

- [x] `npx tsc -b` exit 0; `npx vitest run` (full, one-shot) green minus pre-existing `garden-scene`; `npx eslint` on every touched file clean (minus the 2 pre-existing hook errors).
- [x] Grep sweep: `grep -rn "chat/completions\|reasoning_effort\|max_completion_tokens" supabase/functions --include="*.ts"` → zero hits outside comments/fixtures that intentionally describe the old transport (should be none).
- [x] Deploy note for the PR: all seven functions redeploy (`lamplight-generate`, `lamplight-chat`, `lamplight-study`, `etymology-insight`, `transcribe-note`, `embed-note` unaffected but shares `_shared`, `verse-search` no LLM); no env/secret changes; watch `lamplight_usage.tokens_out` for the expected reflection-cost rise (deep+high) and confirm `status:'ok'` rates hold.
- [x] Do NOT touch `docs/CONTEXT.md`'s stale Sonnet/Haiku artifact references in this slice (pre-existing drift; separate docs cleanup).

---

## Completion record (2026-08-04, commit `35e52c23`)

All eight tasks executed. Gates: `npx tsc -b` exit 0; full `npx vitest run` **3359 passed / 0 failed** (53 edge-function suites, 466 tests, green); eslint clean on every touched file.

**Verified against live docs (Task 2 Step 0)** — platform.openai.com returns 403 to fetchers, so shapes were confirmed from the `openai-node` SDK type definitions plus the official migration guide. Confirmed: `instructions` is top-level; function tools are **flattened** (`{type,name,description,parameters}`); `tool_choice: {type:'function', name}`; `max_output_tokens`; `reasoning: {effort}`; usage is `input_tokens`/`output_tokens` with `output_tokens_details.reasoning_tokens`; `incomplete_details.reason`; event types `response.function_call_arguments.delta` (fields `delta`,`item_id`,`output_index`,`sequence_number`), `.done`, `response.completed|incomplete|failed` (each carrying the full `response` object), and `error` (`code`,`message`,`param`).

**Deviations from the plan, and why:**

1. **`strict: true` was NOT sent on the tool** (the plan's Task 2 asserted it). Strict structured outputs require every property to appear in `required` and reject several length/count keywords — our schemas violate both (the monthly reflection's optional `date_end`; `minLength`/`maxLength`/`minItems`/`maxItems` across artifacts). Sending it would have 400'd the reflection pipeline in production. Omitting `strict` also preserves exact pre-migration behavior. Making the schemas strict-clean is a worthwhile separate change with its own tests. A test now pins the absence so it isn't added casually.
2. **`input_image.image_url` is a plain data-URI string**, not the `{url}` object Chat Completions used. Caught in Step 0; the multimodal test asserts the string form.
3. **No `stream_options`** — usage rides `response.completed`. The old `stream_options.include_usage` assertion was replaced with an assertion that the key is *absent*.
4. **Reused the existing `scripts/smoke/openai-adapter-smoke.ts`** instead of creating the planned new `scripts/smoke-openai-adapter.ts`. The repo already had a three-leg live smoke script; a duplicate would have rotted. It gained a 4th leg — **flagship + `effort: 'high'` with a forced function tool**, the exact combination Chat Completions rejected — plus corrected usage-source messaging.

**Live smoke RUN 2026-08-05 — all four legs passed.** Buffered `generate` on `balanced`, streaming `generateStream`, the `deep` tier at default effort, and the flagship at `effort: 'high'` with a forced function tool. That last leg is the one that justifies the whole migration: on Chat Completions a forced function tool required `reasoning_effort: 'none'`, so the combination was impossible, and Waymarks runs exactly it. This was the largest untested surface in Phase 1; it is now closed.
5. **Two Phase-0 tests were updated** (`monthly-reflection-pipeline.test.ts`): they asserted "the judge never ran" by checking every call used the `'balanced'` tier, which coupled them to the artifact tier. Rewritten to assert no call used the `'fast'` (judge) tier — same intent, tier-agnostic.
6. **`scripts/etymology/seed-etymology.ts` still calls Chat Completions directly** with its own `fetch` and a hardcoded `reasoning_effort: 'none'`. It bypasses the adapter entirely, is a one-shot seeding script, and its comment remains accurate for the API it uses. Out of scope here; migrate it if it is ever re-run regularly.

**Deploy notes:** redeploy `lamplight-generate`, `lamplight-chat`, `lamplight-study`, `etymology-insight`, `transcribe-note` (all share `_shared/openai.ts`). No env or secret changes. After deploy, watch `lamplight_usage`: `tokens_out` on `monthly_reflection` and `bible_study` rows should rise (reasoning bills as output tokens) while `status='ok'` rates hold. The smoke script was run with a live key on 2026-08-05 (all four legs green); re-run it after any adapter change.
