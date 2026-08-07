# Runbook — Insights generated doors (`bible_passage_insight`)

How the generated doors' shared cache is migrated, deployed, warmed, and refreshed. Two doors share it: **The Passage** (`door = 'passage'`, B2) and **Deeper In** (`door = 'deeper'`, B3). Mirrors the evidence-trail standard of `library-ingest.md` and `cross-references-ingest.md`: the run records what was done and what the counts were, so a later state can be checked against it.

**Recorded state: 2026-08-07, after B3.** **The corpus holds 8 rows — two Door 1 doors, on Leviticus 1 at both grains** (§6). Warming is on-demand; those are the first two passages a reader generated. Door 2 holds nothing yet.

**Migration `061` applied and `passage-insight` redeployed, 2026-08-07, in the same sitting** — §2 and §3. Both doors are live; Door 2 has generated nothing yet.

⚠️ **Door 1's prompt moved to `passage-insight-2026-08-07-v2`**, so the two warmed Leviticus doors are stale. That is the designed behaviour (D2 — serve stale, refresh deliberately): the reader is never blocked, and `scripts/refresh-passage-insights.ts --stale` reports them at an estimated $0.11 whenever someone chooses to spend it.

---

## 1. What this is

A **globally shared, publicly readable** cache of generated study for one passage. The historical setting of Psalm 27 is the same for every reader, so a door is a public asset rather than a per-user artifact: generated once by whoever opens it first, then served to everyone as a plain DB read.

| | |
|---|---|
| Table | `public.bible_passage_insight` (migration `060`) |
| Grains | `chapter` (`psa.27`) and single `verse` (`psa.27.4`) — two only |
| Doors | `passage` (B2) · `deeper` (B3). Constrained by the check migration `061` widens |
| Door 1 sections | `overview`, `in_chapter`, `chapter_shape`, `reflection` |
| Door 2 sections | `hermeneutics`, `historical_setting`, `theology`, `read_with_care` |
| Key | `(scope, ref_id, door, section)` — `door` joined the key in `061` |
| Read | **Public, free, unauthenticated.** RLS `using (true)`; the client queries the table directly |
| Write | Service role only — no insert/update/delete policy exists |
| Generate | Edge function `passage-insight`, gated on `hasInlineInsightAccess` (Plus/promo) |
| Model | `deep` tier at `medium` effort — resolves to `gpt-5.6-sol` |
| Retrieval | Per door, in `lamplight-study/insight-doors.ts`. Door 1: `libraryK 4`, no register filter. Door 2: `libraryK 6`, `registers: ['exegetical','confessional']` — both measured, §9 |
| Cost | **~$0.066 per door, measured** across nine live fixtures ($0.59 / 9). Warming ~1,200 chapters is a one-time ~$80 per door |

## 2. Migration

`supabase/migrations/060_passage_insight.sql`, **applied 2026-08-06** by Myles via the Supabase SQL Editor. `db push` is broken on this machine, so migrations go through the editor by hand.

Verified from the repo with an anon-key select — the table exists and public read works:

```bash
curl -s "$VITE_SUPABASE_URL/rest/v1/bible_passage_insight?select=scope,ref_id,door,section&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

`200 []` is the success signal. `relation does not exist` means the SQL never ran.

**Re-running the migration:** the table and both indexes are `if not exists`, but `create policy` is not. A second run succeeds through the indexes and then errors `policy … already exists` — that error means it is already applied, not that something broke.

### `061_passage_insight_door_key.sql` — applied 2026-08-07

Widens the primary key to `(scope, ref_id, door, section)` and the door check to `('passage','deeper')`, and drops the `(scope, ref_id, door)` index the new key makes redundant.

Both DDL steps **discover** what they are changing rather than assuming a name — 060 wrote its check inline, so the constraint carries an auto-generated name, and a wrong guess would drop nothing, fail on the add, and leave B3 unable to write a row. Re-running is a no-op rather than an error.

**Apply it and redeploy in the same sitting.** Postgres requires an upsert's conflict target to match a real unique constraint, so between the migration landing and the function shipping with `onConflict: 'scope,ref_id,door,section'`, Door 1's generate path fails. It fails loudly rather than corrupting anything, and at eight rows on one door nobody is mid-generation — but do not leave the window open.

Verify after applying:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.bible_passage_insight'::regclass
order by contype;
```

Expect `CHECK (door = ANY (ARRAY['passage','deeper']))` and a primary key over `(scope, ref_id, door, section)`.

**Applied by Myles via the SQL Editor, 2026-08-07**, with `passage-insight` redeployed immediately after. Verified from the repo: the table still returns its 8 rows across 2 refs, all `door = 'passage'`, so the key change touched no data — which is what a constraint swap should do.

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

**B3 needs a redeploy**, and it is overdue: the door registry, the widened `onConflict`, both prompt modules and the shared grounding all live under `lamplight-study/`. Add a second boot check for the door parameter — a bad door must be rejected, not silently served as Door 1:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$VITE_SUPABASE_URL/functions/v1/passage-insight" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H 'content-type: application/json' -d '{"book":"psa","chapter":27,"door":"nonsense"}'
```

`400` is healthy. A `401` means the door was accepted and the request only failed on auth, which would mean the registry check is not running.

**⚠️ Nothing typechecks `supabase/functions`.** `tsconfig.app.json` covers only `src`, the eval harness drives the pipeline rather than the shell, and the boot check returns before `buildContext` runs. That combination is how `index.ts` came to reference an undefined `DOOR_REGISTERS` on the generate path and stay there through a merge. Any change to a `*/index.ts` wants a hand-run `tsc --noEmit --allowImportingTsExtensions`, where the only acceptable errors are the `deno.land`/`jsr:` imports and the `Deno` global.

## 4. Warming

**On-demand only. There is no precompute sweep**, by design — warming follows real usage rather than guessing where readers concentrate.

A reader with Plus (or during a promo) opens Insights → *The Passage* or *Deeper In* → **Study this passage**. The sections stream in, and the cache is written on the terminal `done` beat. Every reader after them gets the door as a plain DB read, free, signed out included.

**The doors warm independently.** One passage with Door 1 warm and Door 2 cold is a normal state — each is its own generation batch and its own cache group, and since migration `061` its own set of rows.

Two writes that deliberately never happen:

- **An interrupted stream writes nothing.** The door stays uncached rather than half-written, mirroring how study chat declines to commit an interrupted reply.
- **An all-empty door is refused.** Per-section omission is first-class, but a door with nothing in it would cache nothing, permanently, for everyone after the reader who generated it. The `done` beat reports `cached: false` so the client knows to keep offering the action.

## 5. Verification status

| Check | State |
|---|---|
| Migration `060` applied, public read live | ✅ 2026-08-06, anon select returns `200 []` |
| **Migration `061` applied** | ✅ 2026-08-07, by Myles via the SQL Editor. 8 rows intact afterwards |
| **`passage-insight` redeployed for B3** | ✅ 2026-08-07, same sitting. Bundle manifest carries `insight-doors.ts`, `deeper-insight.ts`, `insight-door.ts` |
| **Door registry live in the deployed function** | ✅ `door=deeper` → `401` (accepted, then auth), `door=nonsense` → `400` (rejected). That PAIR is what tells a fresh bundle from a stale one — a stale one returns `401` for both |
| Client read path, Door 2 | ✅ The exact query the hook issues returns `200 []` for `psa.27` at `door=deeper`, so a reader correctly sees *Study this passage* |
| Function deployed and booting | ✅ 2026-08-06, `401` on unauthenticated POST |
| Prompt quality, BOTH doors | ✅ `docs/lamplight/evals/2026-08-07-b3-both-doors` — **9/9**, $0.59, zero Scripture violations, zero display-ref leaks. Nine fixtures: dense psalm, verse grain, thin OT chapter, contested chapter and denominational bait |
| Retrieval steering measured, not assumed | ✅ `2026-08-07-b3-deeper-unsteered` / `-steered` / `-steered-k6`, free grounding sweeps. Door 1 confirmed unchanged by `-door1-regression` |
| §9 — no Read With Care caution names a tradition | ✅ Zero across all five Door 2 fixtures, including Romans 9 and James 2, chosen because they provoke it |
| Attribution — Door 2 theology names a voice | ✅ 5/5 fixtures, 1–4 voices each. Gated by `attribution_theology` |
| Attribution — Door 1 | ⚠️ **Measured, not gated: 3 of 4 fixtures name a voice somewhere, `passage-psalm-27-v4` names none.** Pre-dates B3; see §7 |
| Client read path against the real table | ✅ The exact query `usePassageInsight` issues returns `200 []` for `psa.27`, `psa.27.4`, `nam.1` — a reader today correctly sees *Study this passage* rather than an error |
| **End-to-end generate through the deployed function** | ✅ **2026-08-07** — Leviticus 1 at both grains. See §6 |
| **A second reader gets the cached door instantly** | ✅ **2026-08-07, in a browser, signed out.** Leviticus 1 → Insights → *The Passage* rendered all four sections immediately — no spinner, no sign-in prompt, no paywall. Refs read `Leviticus 1:1-4`, and the Overview names Jamieson, Fausset & Brown. Conclusive that it came from cache rather than generation: *Deeper In* showed the sign-in gate in the same session, so `canGenerate` was false and `invoke` null |
| **The three-door chooser** | ✅ First time exercised past two doors since B1 built it. The Passage · Deeper In · Sources & Reference, in reading order, with blurbs |
| **A signed-out reader is offered generation** | ✅ **FIXED 2026-08-07 — it was.** See §7 |
| **An interrupted generation leaves the door uncached** | ❌ Unit-tested only |

The remaining checks need a browser and an authenticated Plus/promo session, which is why they are listed rather than done. §6 is the procedure.

## 6. Running the outstanding checks

Signed in as a Plus (or promo-active) user, in the Study workspace:

1. **First generate.** Open a passage with dense coverage (Psalm 27), press Insights → *The Passage* → **Study this passage**. Sections should appear one at a time, Overview first, not all at once at the end.
2. **Confirm the write.** `select scope, ref_id, section, prompt_version, model_used from bible_passage_insight where ref_id = 'psa.27';` — four rows, all stamped `passage-insight-2026-08-06-v1`.
3. **Second reader.** Open the same passage in a private window, signed out. The door should render immediately, with no spinner, no stream, and no sign-in prompt.
4. **Thin coverage.** Repeat step 1 on Nahum 1. Some sections may be shorter; none should be padded, and an omitted section should render as nothing at all rather than a placeholder.
5. **Verse grain.** Select a verse (Psalm 27:4), then generate. *In the Chapter* should discuss what sits either side of that verse specifically.
6. **Interruption.** Start a generation and close the overlay (or kill the tab) before it finishes. Then re-query: the door must have **zero** rows, and reopening must offer *Study this passage* again.
7. **Refs.** Read the prose. Every reference must read `Psalm 27:4`, never `psa 27:4`. An OSIS code on screen is the bug §7 describes.
8. **Door 2, and that it caches separately.** Open *Deeper In* on a passage whose *The Passage* door is already warm. It must offer **Study this passage** rather than rendering — the doors warm independently. Generate it, then confirm eight rows for that `ref_id`, four per `door`:
   `select door, section, prompt_version from bible_passage_insight where ref_id = 'psa.27' order by door, section;`
9. **Door 2 on a contested chapter.** Romans 9. It must generate — describing the argument, naming the question as disputed, and citing nothing in 9:11–23. Before B3 this failed outright on both doors.
10. **Read With Care.** On any Door 2 passage, that section must describe how the passage gets misread and never name a tradition, denomination or group. If it names one, the door should have been rejected — check the function is actually running the B3 bundle.

Record the first warmed passages below when step 1 lands.

### First warmed passages — 2026-08-07

| `ref_id` | Grain | Generated (UTC) | `prompt_version` | `model_used` |
|---|---|---|---|---|
| `lev.1` | chapter | 2026-08-07 00:57:38 | `passage-insight-2026-08-06-v1` | `gpt-5.6-sol` |
| `lev.1.1` | verse | 2026-08-07 06:24:16 | `passage-insight-2026-08-06-v1` | `gpt-5.6-sol` |

**Steps 1, 2, 5 and 7 pass.** Both doors wrote four rows; all eight sections are non-empty and every one ends on terminal punctuation, so nothing truncated mid-word. **No OSIS codes reached the prose** — the `displayRefs` fix holds in production, not just in the eval. Voices are named in two of the eight sections (Jamieson/Fausset/Brown in `lev.1` Overview, Clarke in `lev.1.1` In the Chapter), which is the attribution pattern B3 is measuring against.

**Step 3 (second reader) is half-proven** — see §5. **Step 6 (interruption) has still not been run**, and is easier now: there are real rows to diff against.

Verify the current state from the repo at any time:

```bash
curl -s "$VITE_SUPABASE_URL/rest/v1/bible_passage_insight?select=scope,ref_id,door,section,prompt_version,created_at&order=created_at" -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

## 7. Known issues

- ~~Study chat still prints OSIS codes at readers.~~ **Fixed 2026-08-06.** `displayRefs` is now on for study chat and study insight too (`study-chat-…-v7`, `study-insight-…-v5`), verified live: `docs/lamplight/evals/2026-08-07-study-display-refs`, 4/4, zero leaks. `lamplight-study` redeployed. The client's `humanizeRef` already handled both forms, so no client change was needed and existing messages still render.
- ~~Journaling chat (`lamplight-chat`) still prints OSIS codes.~~ **Fixed 2026-08-06**, after its own eval kind was built first. `buildChatContext` extracted from the Deno shell to `lamplight-chat/chat-context.ts` so it could be unit-tested at all, then given the same `displayRefs`. `bible-chat` v2→v3, redeployed. Baseline: `docs/lamplight/evals/2026-08-07-journaling-baseline`.
  - **All three reader-facing surfaces now use display refs**, each with a live baseline, all re-confirmed together on 2026-08-07: study chat 4/4, journaling chat 2/2, Door 1 3/3 — zero OSIS leaks in any reply and every citation properly cased, including numbered books (`2 Corinthians 5:7`) and ranges (`Genesis 1:26–31`). The remaining generated surfaces (daily devotion, connection-why, monthly reflection) go through `buildPassages`, which has used `formatDisplayVerseRef` since slice 1d.
- ~~**`door` is not in the primary key.**~~ **Closed by migration `061`** (B3): the key is now `(scope, ref_id, door, section)`, and `writePassageDoor`'s `onConflict` moved with it. It also widened the door check to `('passage','deeper')`. Applied over eight rows on a single door, so there was nothing to reconcile. **Apply 061 and redeploy in the same sitting** — between the two, the upsert's conflict target no longer matches a unique constraint and Door 1's generate path fails (loudly, not silently).
- ~~**A contested chapter could have no generated door at all.**~~ **Fixed 2026-08-07 (B3).** Both doors failed outright on Romans 9 and would have failed on Revelation 13, Daniel 9 and 12, Matthew 24, Mark 13, 2 Thessalonians 2, 1 Corinthians 11 and 14, 1 Timothy 2 and Ephesians 1. The prompt said "note that the question is disputed — then stop" and the model obeyed; the validator rejected the door anyway, because `CONTESTED_PASSAGES` rejects **citing** those refs at all, and no door can describe Romans 9 without citing Romans 9. The prompt and the validator disagreed about what the policy meant, and the prompt was the half that could not see the list. Both doors' grounding now carries an **uncitable-refs block**, computed with the same reference-aware matcher the validator uses so the two cannot drift. Door 1 went `v1` → `passage-insight-2026-08-07-v2` for it. The hole dated from B2 and was invisible because none of Door 1's three fixtures was a contested chapter.

- **Door 1 names no voice on some passages, and that is measured rather than fixed.** In the B3 baseline, 3 of 4 Door 1 fixtures name a supplied source somewhere and `passage-psalm-27-v4` names none at all — the same shape as A1's watch item, where two of four study-chat replies named nobody. Door 2 does not have the problem: its theology section names 1–4 voices on 5/5 fixtures, so its `attribution_theology` check is a gate. Door 1's is not, because **the cause is not isolated** — Door 2 differs from Door 1 in both its brief's phrasing ("following the supplied voices rather than your own memory") *and* its register steering, so a prompt change to Door 1 would be a guess with a confound. Every snapshot reports a `voices named` line per section, so the number stays visible. Its own slice, with its own A/B.

- ~~**A signed-out reader was offered "Study this passage", and pressing it dead-ended.**~~ **Fixed 2026-08-07**, found by running the §6 browser checks. `hasAccess` short-circuits on a global promo — `if (promoActive) return true` — before it considers who is asking, and `lamplight_promo_active` is on. Both workspaces passed that straight through as `canGenerate`, so a signed-out visitor saw the generate button, pressed it, and got *"That didn't finish. Try again."* — the request 401s with no bearer token and retrying can never help. `canGenerateInsights` now requires a signed-in reader as well as the entitlement, and the sign-in path appears instead. **Pre-dated B3:** Door 1 behaved this way from B2; registering Door 2 doubled the surface. `PassageDoor`'s own test asserted the right behaviour and passed the whole time, because it sets `canGenerate` directly — the defect was always in the caller.

- **The refresh script writes no usage row**, so its spend does not reach the admin dashboard and does not count against the global daily ceiling. `lamplight_usage.user_id` is `not null references profiles(id)` and a maintenance sweep has no user; a fabricated id would corrupt per-user cost attribution. The spend is printed to the operator instead.

## 8. Refreshing

`prompt_version` and `model_used` are stamped per row, which is what makes a targeted refresh possible. A read serves whatever is cached **regardless of version** — a reader is never blocked by a prompt bump, and a bump never silently re-bills the warmed corpus.

```bash
npx tsx scripts/refresh-passage-insights.ts --stale
```

Dry by default — it reports the doors and an estimated cost and writes nothing. `--dry-run` beats `--apply` if both are passed.

**`--door` selects which door**, defaulting to `passage`, and "stale" means stale against **that door's** current prompt — the two version independently. An unregistered id is rejected rather than selecting nothing, because a typo that reports *"nothing to refresh"* reads exactly like a warm corpus.

```bash
npx tsx scripts/refresh-passage-insights.ts --door=deeper --stale
```

As of 2026-08-07 that reports nothing for Door 2 (no rows) and **two stale Door 1 doors at ~$0.11**, both Leviticus 1, left behind by the `v2` bump.

```bash
npx tsx scripts/refresh-passage-insights.ts --stale --limit=5 --apply
```

Other filters: `--scope=verse|chapter`, `--ref=psa.27`, `--door=passage|deeper`. A failed regeneration leaves the old door in place rather than blanking one a reader could still be served.

**Two readers can see different prose for the same passage**, generated under different prompt versions. Acceptable here because the content is neither personalized nor time-sensitive: a correct Overview of Psalm 27 does not rot.

---

*Door 1 — design: `docs/superpowers/specs/2026-08-06-study-insights-b2-design.md`, plan: `docs/superpowers/plans/2026-08-06-study-insights-b2.md`.*
*Door 2 — design: `docs/superpowers/specs/2026-08-07-study-insights-b3-design.md`, plan: `docs/superpowers/plans/2026-08-07-study-insights-b3.md`.*
