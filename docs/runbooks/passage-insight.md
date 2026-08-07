# Runbook — Insights Door 1 (`bible_passage_insight`)

How the Passage door's shared cache is migrated, deployed, warmed, and refreshed. Mirrors the evidence-trail standard of `library-ingest.md` and `cross-references-ingest.md`: the run records what was done and what the counts were, so a later state can be checked against it.

**Recorded state: 2026-08-06.** Migration applied, function deployed, door registered, eval baseline green. **The corpus holds 0 rows** — warming is on-demand and no reader has pressed *Study this passage* yet. See §5 for the checks that are still outstanding because they need an authenticated session.

---

## 1. What this is

A **globally shared, publicly readable** cache of generated study for one passage. The historical setting of Psalm 27 is the same for every reader, so a door is a public asset rather than a per-user artifact: generated once by whoever opens it first, then served to everyone as a plain DB read.

| | |
|---|---|
| Table | `public.bible_passage_insight` (migration `060`) |
| Grains | `chapter` (`psa.27`) and single `verse` (`psa.27.4`) — two only |
| Sections | `overview`, `in_chapter`, `chapter_shape`, `reflection` |
| Read | **Public, free, unauthenticated.** RLS `using (true)`; the client queries the table directly |
| Write | Service role only — no insert/update/delete policy exists |
| Generate | Edge function `passage-insight`, gated on `hasInlineInsightAccess` (Plus/promo) |
| Model | `deep` tier at `medium` effort — resolves to `gpt-5.6-sol` |
| Cost | ~$0.06 per door, measured. Warming ~1,200 chapters is a one-time ~$70 |

## 2. Migration

`supabase/migrations/060_passage_insight.sql`, **applied 2026-08-06** by Myles via the Supabase SQL Editor. `db push` is broken on this machine, so migrations go through the editor by hand.

Verified from the repo with an anon-key select — the table exists and public read works:

```bash
curl -s "$VITE_SUPABASE_URL/rest/v1/bible_passage_insight?select=scope,ref_id,door,section&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

`200 []` is the success signal. `relation does not exist` means the SQL never ran.

**Re-running the migration:** the table and both indexes are `if not exists`, but `create policy` is not. A second run succeeds through the indexes and then errors `policy … already exists` — that error means it is already applied, not that something broke.

## 3. Deploy

```bash
supabase functions deploy passage-insight
```

The function imports across directories (`../lamplight-study/passage-insight-*`), which the bundler handles — `lamplight-study/index.ts` already does the same. **Redeploy whenever anything under `supabase/functions/lamplight-study/` changes**, not just the shell: the display-ref fix lived in `study-context.ts`, and the function ran stale until it was redeployed.

Boot check, no auth and no cost:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$VITE_SUPABASE_URL/functions/v1/passage-insight" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H 'content-type: application/json' -d '{"book":"psa","chapter":27}'
```

`401` is healthy: it means the deno.land import resolved, every cross-directory import bundled, and `OPENAI_API_KEY` / `VOYAGE_AI_KEY` are present — a missing key returns `500` *before* the auth check. A `500` with `BOOT_ERROR` means the bundle itself failed.

## 4. Warming

**On-demand only. There is no precompute sweep**, by design — warming follows real usage rather than guessing where readers concentrate.

A reader with Plus (or during a promo) opens Insights → *The Passage* → **Study this passage**. The sections stream in, and the cache is written on the terminal `done` beat. Every reader after them gets the door as a plain DB read, free, signed out included.

Two writes that deliberately never happen:

- **An interrupted stream writes nothing.** The door stays uncached rather than half-written, mirroring how study chat declines to commit an interrupted reply.
- **An all-empty door is refused.** Per-section omission is first-class, but a door with nothing in it would cache nothing, permanently, for everyone after the reader who generated it. The `done` beat reports `cached: false` so the client knows to keep offering the action.

## 5. Verification status

| Check | State |
|---|---|
| Migration applied, public read live | ✅ 2026-08-06, anon select returns `200 []` |
| Function deployed and booting | ✅ 2026-08-06, `401` on unauthenticated POST |
| Prompt quality across dense / thin / verse grains | ✅ `docs/lamplight/evals/2026-08-06-b2-passage-door` — 3/3, $0.17, zero Scripture violations, zero display-ref leaks |
| Study chat unaffected by the shared `displayRefs` change | ✅ `docs/lamplight/evals/2026-08-06-b2-studychat-regression` (free, grounding-only) |
| Client read path against the real table | ✅ The exact query `usePassageInsight` issues returns `200 []` for `psa.27`, `psa.27.4`, `nam.1` — a reader today correctly sees *Study this passage* rather than an error |
| **End-to-end generate through the deployed function** | ❌ **Never run.** The eval drives the pipeline directly, not the edge function |
| **A second reader gets the cached door instantly** | ❌ Unit-tested only |
| **An interrupted generation leaves the door uncached** | ❌ Unit-tested only |

The three outstanding checks all need an authenticated Plus/promo session, which is why they are listed rather than done. §6 is the procedure.

## 6. Running the outstanding checks

Signed in as a Plus (or promo-active) user, in the Study workspace:

1. **First generate.** Open a passage with dense coverage (Psalm 27), press Insights → *The Passage* → **Study this passage**. Sections should appear one at a time, Overview first, not all at once at the end.
2. **Confirm the write.** `select scope, ref_id, section, prompt_version, model_used from bible_passage_insight where ref_id = 'psa.27';` — four rows, all stamped `passage-insight-2026-08-06-v1`.
3. **Second reader.** Open the same passage in a private window, signed out. The door should render immediately, with no spinner, no stream, and no sign-in prompt.
4. **Thin coverage.** Repeat step 1 on Nahum 1. Some sections may be shorter; none should be padded, and an omitted section should render as nothing at all rather than a placeholder.
5. **Verse grain.** Select a verse (Psalm 27:4), then generate. *In the Chapter* should discuss what sits either side of that verse specifically.
6. **Interruption.** Start a generation and close the overlay (or kill the tab) before it finishes. Then re-query: the door must have **zero** rows, and reopening must offer *Study this passage* again.
7. **Refs.** Read the prose. Every reference must read `Psalm 27:4`, never `psa 27:4`. An OSIS code on screen is the bug §7 describes.

Record the first warmed passages below when step 1 lands.

**First warmed passages:** _(none yet — pending the checks above)_

## 7. Known issues

- ~~Study chat still prints OSIS codes at readers.~~ **Fixed 2026-08-06.** `displayRefs` is now on for study chat and study insight too (`study-chat-…-v7`, `study-insight-…-v5`), verified live: `docs/lamplight/evals/2026-08-06-study-display-refs`, 4/4, zero leaks. `lamplight-study` redeployed. The client's `humanizeRef` already handled both forms, so no client change was needed and existing messages still render.
- ~~Journaling chat (`lamplight-chat`) still prints OSIS codes.~~ **Fixed 2026-08-06**, after its own eval kind was built first. `buildChatContext` extracted from the Deno shell to `lamplight-chat/chat-context.ts` so it could be unit-tested at all, then given the same `displayRefs`. `bible-chat` v2→v3, redeployed. Baseline: `docs/lamplight/evals/2026-08-07-journaling-baseline`.
  - **All three reader-facing surfaces now use display refs**, each with a live baseline. The remaining generated surfaces (daily devotion, connection-why, monthly reflection) go through `buildPassages`, which has used `formatDisplayVerseRef` since slice 1d.
- **`door` is not in the primary key.** `primary key (scope, ref_id, section)` makes `('chapter','psa.27','overview')` unique across *all* doors. B3's Deeper door has no colliding section names today, but it is one careless name away from two doors silently overwriting each other. Widen the PK when B3 lands.
- **The refresh script writes no usage row**, so its spend does not reach the admin dashboard and does not count against the global daily ceiling. `lamplight_usage.user_id` is `not null references profiles(id)` and a maintenance sweep has no user; a fabricated id would corrupt per-user cost attribution. The spend is printed to the operator instead.

## 8. Refreshing

`prompt_version` and `model_used` are stamped per row, which is what makes a targeted refresh possible. A read serves whatever is cached **regardless of version** — a reader is never blocked by a prompt bump, and a bump never silently re-bills the warmed corpus.

```bash
npx tsx scripts/refresh-passage-insights.ts --stale
```

Dry by default — it reports the doors and an estimated cost and writes nothing. `--dry-run` beats `--apply` if both are passed.

```bash
npx tsx scripts/refresh-passage-insights.ts --stale --limit=5 --apply
```

Other filters: `--scope=verse|chapter`, `--ref=psa.27`. A failed regeneration leaves the old door in place rather than blanking one a reader could still be served.

**Two readers can see different prose for the same passage**, generated under different prompt versions. Acceptable here because the content is neither personalized nor time-sensitive: a correct Overview of Psalm 27 does not rot.

---

*Design: `docs/superpowers/specs/2026-08-06-study-insights-b2-design.md`. Plan and decision log: `docs/superpowers/plans/2026-08-06-study-insights-b2.md`.*
