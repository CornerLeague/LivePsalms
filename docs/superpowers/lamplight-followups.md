# Lamplight & Notepad — Open Follow-Ups (Snapshot 2026-05-28)

Synthesized from the 10 specs under `docs/superpowers/specs/` against the live state of the repo (migrations 008–017 applied, sub-projects 1–6-partial shipped, voyage-context-3 migration + name personalization + admin entry link merged).

Each item is tagged with priority, source spec, and the **why** so a future planner can re-rank without re-reading every spec.

---

## P0 — Pre-Launch Blocking

These must be resolved before flipping `lamplight_promo_active` off or making any public AI claim. Most are not engineering — they're governance / config decisions that have been deferred phase after phase.

### P0-1. Tighten Connection Cards qualification thresholds to spec values
- **Source:** Connection Cards spec §"Decisions log" #6 + memory note (`project_lamplight_test_thresholds.md`).
- **Current state:** `useConnectionCards.ts` defaults to `qualifyingMinWords=10`, `qualifyingMinVaultSize=2`, and `app_config.lamplight_min_similarity` is seeded at `0.3` by migration 017 (dev). Spec values: 100 words / 10 notes / 0.78 similarity.
- **What to do:** Flip the three to spec values *before* the promo period opens to the public. SQL one-liner for the similarity:
  ```sql
  update public.app_config set value = '0.78'::jsonb, updated_at = now()
  where key = 'lamplight_min_similarity';
  ```
  Word + vault thresholds are component defaults — change them in [useConnectionCards.ts](src/notepad/hooks/useConnectionCards.ts).
- **Why P0:** Loose thresholds during launch will surface low-quality "connections" to first-impression users and waste OpenAI credits on weak pairs.

### P0-2. Doctrinal review board — identify reviewers and produce sign-off artifact
- **Source:** Foundation spec §"Operational items", Reasoning Layer spec follow-up #5, Today's Lamp spec follow-up #10, Connection Cards spec follow-up #7.
- **Current state:** No `docs/lamplight/doctrinal-review.md`. No named reviewers. Foundation spec recommended *two names within two weeks of starting sub-project 3 (Reasoning Layer)*. Reasoning Layer is shipped — this is overdue.
- **What to do:**
  1. Identify reviewers (one seminary-trained pastor, one theologically-grounded layperson).
  2. Create `docs/lamplight/doctrinal-review.md`.
  3. Generate ~30 synthetic-persona sample artifacts covering Daily Devotion + Connection Why under representative inputs.
  4. Reviewers examine `LAMPLIGHT_SYSTEM_FRAGMENT`, `BANNED_PHRASES`, `CONTESTED_PASSAGES`, `GROWTH_BANNED_PHRASES`, `DAILY_DEVOTION_PROMPT.system`, `CONNECTION_WHY_PROMPT.system`, and the samples.
  5. Capture written sign-off.
- **Why P0:** This is the named gate for public AI launch in every Lamplight spec. Shipping AI to non-promo users before sign-off violates the brief's own contract.

### P0-3. Operational decisions: promo end date & grandfathering policy
- **Source:** Foundation spec §"Operational items".
- **Current state:** `app_config.lamplight_promo_ends_at` is `null`. No documented grandfathering policy.
- **What to do:** Pick a fixed end date (Foundation recommended 4 months after public launch), write it to `app_config`. Write the grandfathering policy (Foundation recommended 60-day grace + 50% lifetime discount). These are 1-row updates plus a one-page policy doc — but they need a product decision.
- **Why P0:** Without this you cannot communicate honestly to users what happens when the promo ends. Lock it before launch; renegotiating later erodes trust.

### P0-4. Paywall purchase flow (the deferred half of Sub-Project 6)
- **Source:** Entitlements UI spec §"Open follow-ups" #1.
- **Current state:** Foundation's placeholder `<PaywallCard />` still ships; entitlement granting is manual SQL only.
- **What to do:** Brief a separate slice. Stripe / RevenueCat / Apple / Google integration, plan upgrade UX, billing portal, receipt webhooks. Replace `PaywallCard` placeholder. Wire entitlement granting to webhooks.
- **Why P0 (relative to promo end):** Only blocking *if* you intend to charge when the promo ends. If the plan is to extend the promo until billing is ready, drop to P1. Either way the decision needs to land before P0-3 is meaningful.

### P0-5. Layer C — LLM doctrinal classifier
- **Source:** Reasoning Layer spec §"Out" + follow-up #2.
- **Current state:** `applyContentRules` has a `classifier?: (text) => Promise<Violation[]>` slot, never wired.
- **What to do:** Haiku 4.5 second-pass that reads the artifact + rule lists and returns extra violations. Wires in as `await opts.classifier?.(text)` after regex checks. Same violation shape, no callsite changes.
- **Why P0:** The doctrinal review board (P0-2) will likely identify edge cases that regex cannot catch (tense ambiguity, paraphrased prophetic claims, etc.). Layer C is the response to that. Stage it before sign-off so reviewers see it active.

---

## P1 — Urgent Post-Launch / Clear Wins

Spec'd as small, deferred for cleanliness or sequencing. Most are ≤1 day each. Bundling these as a single "stabilization sprint" after Lamplight reaches early users would close 80% of post-launch drag.

### P1-1. Remove the `smoke_test` payload + pipeline + prompt + tests
- **Source:** Today's Lamp spec §"Open follow-ups" #1.
- **Current state:** `supabase/functions/lamplight-generate/index.ts:83` still dispatches `smoke_test`; `pipeline.ts` and `prompts/smoke-test.ts` still in tree; tests still run.
- **What to do:** Single small cleanup PR. Today's Lamp is shipped and stable — this is now ready.
- **Why P1:** Dead code that ships to production. Reduces attack surface (one fewer dispatch path) and removes a "is this still used?" question from every future Edge Function reader.

### P1-2. Extract `hydrateBiblePassages` to `_shared/retrieval.ts`
- **Source:** Today's Lamp spec §"Open follow-ups" #2.
- **Current state:** ~20 LOC of identical passage-hydration logic in both `buildSmokeTestContext` and `buildDailyDevotionContext`.
- **What to do:** Pure refactor. Move to `_shared/retrieval.ts`. Both call sites use it.
- **Why P1:** Bundle with P1-1 (since the smoke_test removal will leave a single caller and make the extraction trivial). If P1-1 lands first, this is even simpler.

### P1-3. Per-kind aggregation in the admin usage leaderboard
- **Source:** Entitlements UI spec §"Open follow-ups" #5.
- **Current state:** Leaderboard sums across models, making the cost map misleading (Haiku + Sonnet rolled together).
- **What to do:** Update `admin_lamplight_usage_top` RPC to group by `(user_id, model)` (or render the rollup client-side per model). The admin already pays for the data — surfacing it correctly is a UI-only change.
- **Why P1:** Both Haiku (Connection Why) and Sonnet (Daily Devotion) are in production. The current leaderboard's cost column is silently wrong; that quality of admin telemetry will lead operators to ask the wrong questions.

### P1-4. Set per-user soft cost cap
- **Source:** Reasoning Layer spec follow-up #4 + Entitlements UI spec follow-up #6.
- **Current state:** Only Voyage `truncation: true` and OpenAI `max_completion_tokens` cap anything. `lamplight_usage` is being populated (Sub-Project 6 partial) but nothing reads it for limits.
- **What to do:** Add a check at the top of `lamplight-generate` for daily-devotion and connection-why dispatches: sum `tokens_in + tokens_out` over the last 24h for `user_id`; if above threshold, return `{ ok: false, reason: 'cost_cap_exceeded' }`. Threshold lives in `app_config` for easy tuning.
- **Why P1:** Without this, a single bug (e.g., a hook re-invoking on every render) can drain OpenAI credits silently. The data foundation is already there — wiring takes hours.

### P1-5. `cms_test`/Smoke-test removal cleanup blast radius check
- See P1-1.

### P1-6. Component name drift: `ConnectionCardsSection` vs `ConnectionCardsStrip`
- **Source:** Connection Cards spec §"Files touched / created".
- **Current state:** Spec names the component `ConnectionCardsSection`; shipped as `ConnectionCardsStrip`. Tests + Notepad consumer use the Strip name.
- **What to do:** Either (a) update the spec note in `docs/CONTEXT.md` (if added there) and accept the name; or (b) rename to spec. Most likely (a) — the spec is a snapshot, the code is canonical now. Decide and move on; this is a 5-minute call.
- **Why P1:** Low-stakes but documenting the drift prevents a future engineer from "fixing" it under a refactor PR that re-opens the spec → code mismatch.

### P1-7. Embedding-not-ready polling in Connection Cards
- **Source:** Connection Cards spec §"Open follow-ups" #6.
- **Current state:** `useConnectionCards` enters `waiting_for_embedding` but never re-checks. User has to refocus the tab or edit the note.
- **What to do:** Add a 5s × 12 (60s) polling loop in the waiting state. Auto-transition to `ready` when the embedding lands.
- **Why P1:** This is exactly the moment a new user discovers Lamplight. Failing to auto-recover is the difference between "felt magic" and "felt broken."

### P1-8. Connection Cards: "Reflect on this further" button
- **Source:** Connection Cards spec §"Open follow-ups" #1 + parent brief §7.1.
- **Current state:** Brief calls for this affordance; spec explicitly carved it out for a follow-up slice.
- **What to do:** Brief a small slice. Adds a button to the expanded card; click → drafts a reflection prompt that opens a new note or appends to the active note with a backlink. Needs a new artifact type or in-place insertion path.
- **Why P1:** Closes the "what do I do with this connection?" loop. Cards as read-only observations leave users without a verb.

---

## P2 — Important UX / Feature Completeness

Planned features that round out Lamplight's surface area. Each is a "small slice" or "mid slice." Order them by user value once P0 + P1 are clear.

### P2-1. "Save as Devotion note" CTA on Today's Lamp
- **Source:** Today's Lamp spec follow-up #3.
- **Current state:** `lamplight_artifacts.saved_to_notes` column exists, no write path.
- **What to do:** Button on `TodaysLampCard`. Click → create a new note in the user's vault with the devotion content + backlink to the artifact id. Flip `saved_to_notes = true` to prevent showing the button twice.

### P2-2. "How was this written?" transparency panel
- **Source:** Today's Lamp spec follow-up #4.
- **Current state:** `source_note_ids`, `source_verses`, `model_used`, `prompt_version` all persisted; no UI.
- **What to do:** Side panel reachable from a small icon on `TodaysLampCard`. Renders provenance plainly. Signals to users that Lamplight is grounded, not generated wholesale.

### P2-3. "This wasn't helpful" feedback signal
- **Source:** Today's Lamp spec follow-up #5.
- **Current state:** No feedback table, no negative-signal path.
- **What to do:** New `lamplight_artifact_feedback (artifact_id, user_id, outcome, created_at)` table. Tiny "Wasn't helpful" link on the card. Feeds future Stillwater design + retrieval-quality dashboard.

### P2-4. Stillwater fallback library
- **Source:** Today's Lamp spec follow-up #6 + decision #3.
- **Current state:** Validator hard-fail returns a plain error to the user.
- **What to do:** Separate brief — curated copy + theme classifier. Brief it once P2-3 has shipped enough data to point Stillwater at the real failure patterns.

### P2-5. `pg_cron` first-open-of-day trigger for Today's Lamp
- **Source:** Today's Lamp spec follow-up #7.
- **Current state:** Generation is purely client-driven; no cross-session warm-up.
- **What to do:** Every 30 min globally, for each opted-in user whose local time is in their wake window AND who has no `daily_devotion` for today, enqueue generation. Requires storing a wake-window or sane defaults.

### P2-6. Connection Cards: "See more" disclosure for 4th + 5th neighbor
- **Source:** Connection Cards spec follow-up #3.
- **Current state:** Hook retains 5 neighbors, renders only 3 (spec contract).
- **What to do:** Small UX affordance — clicking a "More" link reveals the remaining cards. Keep 3-by-default; this is a power-user disclosure.

### P2-7. Connection Cards: background pre-warming of why strings
- **Source:** Connection Cards spec follow-up #2.
- **Current state:** Why strings generate on expand only.
- **What to do:** Once P2-3 telemetry is live, decide whether to pre-warm top-3 neighbor whys on `ready`. Triples Haiku cost — only do this if data justifies. **Defer to P3 if telemetry isn't promising.**

### P2-8. Inline verse refs validation in `reflection` + Connection Why
- **Source:** Today's Lamp follow-up #8 + Connection Cards follow-up #4.
- **Current state:** Inline refs are unvalidated to avoid false positives.
- **What to do:** Run `reference-parser` against `reflection` / `artifact.why`; flag refs not in `allowedVerseRefs` (Today's Lamp) or not present in either note (Connection Cards). Only land this once you have data showing the model actually slips unsupplied refs in.

### P2-9. `prompt_version` column on `lamplight_connections`
- **Source:** Connection Cards spec decision #14 + follow-up #5.
- **Current state:** Version travels in Edge Function response only; not persisted.
- **What to do:** Small migration if audit-by-prompt becomes important. Bundle with P2-2 if that ships first (same "transparency-of-provenance" theme).

### P2-10. Quiet Mode UI
- **Source:** Foundation spec §"Out" + Today's Lamp + Connection Cards.
- **Current state:** `lamplight_settings.quiet_mode` column exists, no UI, no feature uses it.
- **What to do:** Hold until inline suggestions land (P2-11) — Quiet Mode's primary job is gating those. Lift it from "scope: out" once there's something to gate.

### P2-11. Inline suggestions (new sub-project)
- **Source:** Companion sub-project listed in every Lamplight spec.
- **Current state:** Not started. `lamplight_suggestions_log` table exists; no producer or consumer.
- **What to do:** Separate brief. `generateStream()` adapter (deferred per Reasoning Layer follow-up #3). Streamed inline verse suggestions while the user types. Validators run post-stream against the assembled text.

### P2-12. Weekly Insight artifact
- **Source:** Companion sub-project.
- **Current state:** Not started. `lamplight_artifacts.type` enum already allows it.
- **What to do:** Separate brief. Longer than Today's Lamp ("last 30 days of notes" sketch from the parent brief). Likely emails to users + an in-tab card. Personalization baked in from the start (Sub-Project 8).

### P2-13. Reflections Recap artifact
- **Source:** Companion sub-project.
- **Current state:** Not started.
- **What to do:** Separate brief. Periodic synthesis of the user's reflections / prompts answered. Likely a monthly artifact.

### P2-14. Tier Celebration copy
- **Source:** Foundation spec §"Out".
- **Current state:** Out-of-scope at Foundation; never re-opened.
- **What to do:** The existing 8-tier system (`src/notepad/gamification/tiers.ts`) ships generic copy. Tie celebration to scripture themes per tier. Small slice once Layer C and the doctrinal board are settled.

### P2-15. Admin: "embed all my notes" backfill button
- **Source:** Entitlements UI follow-up #4.
- **Current state:** `scripts/backfill-note-embeddings.ts` covers ad-hoc support.
- **What to do:** Surface a per-user button on `/admin/lamplight` once support actually needs it. Wire to a new admin RPC that re-queues all of one user's notes. Defer until a real ticket demands it.

---

## P3 — Scale & Optimization

Do not pre-empt; act on production data.

### P3-1. Chunked BSB embeddings
- **Source:** voyage-context-3 spec follow-up #1.
- **What to do:** Re-embed Bible corpus with chapter-as-document, verses-as-chunks. Expected +recall on BSB side. **Only if note-side gains from voyage-context-3 haven't closed the qualitative gap.**

### P3-2. Server-side aggregation RPC for chunk fan-out
- **Source:** voyage-context-3 follow-up #2.
- **What to do:** Collapse `searchNeighbors`'s per-chunk fan-out into a single RPC. Only if profiling shows it as a hot path.

### P3-3. Embedding quantization
- **Source:** Signal Layer follow-up #6 + voyage-context-3 follow-up #3.
- **What to do:** `output_dtype: 'int8'` (4× smaller transfer) or `'binary'` + rescore (32× smaller, ~3% recall hit). Schema migration to `vector` or `bit varying`. Only when storage cost becomes meaningful.

### P3-4. Drop Matryoshka dim from 512 → 256
- **Source:** voyage-context-3 follow-up #5.
- **What to do:** Another 50% storage cut. Only with production data showing 512 is overkill.

### P3-5. Reranker A/B for neighbor list
- **Source:** Connection Cards follow-up #8 + Reasoning Layer follow-up #6.
- **What to do:** Currently `RERANK_ENABLED` is the toggle but ungated. Run an A/B with 5–10 users; eyeball quality. Flip the default if rerank wins. **Now is a fine time** — voyage-context-3 changed the embedding space, so this is *more* relevant, not less.

### P3-6. `lamplight_jobs.status = 'abandoned'` terminal state
- **Source:** Entitlements UI follow-up #3.
- **What to do:** Add only when a class of jobs emerges that should never re-run. YAGNI until then.

### P3-7. Per-user "your usage this month" surface
- **Source:** Entitlements UI follow-up #2.
- **What to do:** Premature without a billing relationship to anchor it. Defer until paywall (P0-4 / P1) is concrete.

### P3-8. ESV / NIV premium translation API integration
- **Source:** Signal Layer follow-up #7.
- **What to do:** Read-time-only via API; never store the text. Embeddings stay on BSB. Defer until a real user request lands.

### P3-9. Connection Cards: `validateDailyDevotionCitations` strict mode (≥3 citations regardless of vault size)
- **Source:** Today's Lamp follow-up #9.
- **What to do:** Optional power-user preference. YAGNI until requested.

---

## P4 — Nice-to-Have / Operational Polish

Small ergonomic improvements. Pick up when there's slack.

### P4-1. Explicit opt-out toggle for personalization
- **Source:** Name personalization spec follow-up #1.
- **What to do:** `lamplight_settings.personalization_enabled boolean default true`. Toggle in Profile section. Pipeline treats `false` as `firstName = null`.

### P4-2. Display-name override (`profiles.preferred_name`)
- **Source:** Name personalization follow-up #2.
- **What to do:** Lets users decouple Lamplight's address from their registered legal name.

### P4-3. Cache invalidation on profile-name change
- **Source:** Name personalization follow-up #5.
- **What to do:** Profile-update hook marks today's artifact as `regenerate=true`. Only if "overnight name staleness" becomes a real complaint.

### P4-4. Localization of salutation forms
- **Source:** Name personalization follow-up #4.
- **What to do:** Em-dash works in English. Other locales may want different forms. Defer until first non-English market.

### P4-5. Secondary admin entry surface
- **Source:** Admin entry link spec follow-up #1.
- **What to do:** Header-bar icon or `/admin` slash command. YAGNI for one admin; revisit if admin user base grows.

### P4-6. Admin breadcrumb on `/admin/lamplight`
- **Source:** Admin entry link spec follow-up #2.
- **What to do:** "← Profile" link in admin page header for fast round-trip. Browser back works; skip until requested.

### P4-7. Click telemetry on the admin entry link
- **Source:** Admin entry link spec follow-up #3.
- **What to do:** When paywall analytics ship, instrument this too. Out of scope today (no analytics infra).

### P4-8. Garden Scene Seven Papers — unrendered `papers: [...]` array in `copy.ts`
- **Source:** Seven Papers spec §"Affected files".
- **Current state:** Array of seven named papers stays defined but unrendered.
- **What to do:** Either surface the names below the video (future iteration the spec contemplated) or delete the array. Cleanup-grade.

### P4-9. Voice fragment / banned-phrase list maintenance hooks
- **Source:** Reasoning Layer spec §"Notes for the implementer".
- **Current state:** `BANNED_PHRASES` and `CONTESTED_PASSAGES` live in `voice.ts`, only an engineer can edit.
- **What to do:** Eventually surface a private admin route (or a periodic export → reviewer → re-import) so the doctrinal board can amend without engineering tickets. Defer until P0-2 is repeated annually.

---

## Cross-cutting health checks (not items, but worth re-running before launch)

- **RLS isolation regression** — every migration since 008 extended this; run the full `lamplight-rls.test.ts` suite against staging with a fresh second user.
- **Cron sweep drain rate** — current cap of 5 jobs/min was fine for empty production. Re-measure against expected concurrent embedders after launch; bump if drain time > 60s p99.
- **Cost-map prices** — the values in `src/admin/lamplight-cost.ts` are pinned at write-time (May 2026). Voyage and OpenAI both move; verify before each public-facing claim of price.
- **Embedding model ↔ column dim alignment** — voyage-context-3 follow-up flagged this: `voyage.DIM` must equal the migration's `vector(N)`. Add the integration assertion if it isn't already there.
- **Promo flag end-state UI** — `<PaywallCard />` is reachable only when `lamplight_promo_active=false`. Manually flip the flag in staging and walk every Lamplight surface. The spec promises it's not a `// TODO`; verify.

---

## Suggested sequencing

If I were ordering the next month of work for one engineer:

1. **Week 1 (P0 setup):** P0-2 (identify doctrinal reviewers, generate sample artifacts) — kicks off async board work. In parallel: P1-1 (smoke_test removal) + P1-2 (hydrate extraction) — clean ground.
2. **Week 2 (P0 + P1 wrap):** P0-1 (threshold tighten) + P0-5 (Layer C wiring) + P1-4 (cost cap). These three meaningfully de-risk public launch.
3. **Week 3 (P0 governance):** P0-3 (promo end + grandfathering) + P0-4 decision (paywall now or paywall later).
4. **Week 4 (P1 polish):** P1-3 (per-kind leaderboard) + P1-6 (name drift cleanup) + P1-7 (embedding polling) + P1-8 (Reflect-further button).

After that, P2 items can be sequenced by user value as Lamplight reaches early users and feedback signals what's actually missing. P3 is data-driven — don't pre-empt.
