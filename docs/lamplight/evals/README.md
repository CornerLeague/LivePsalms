# Lamplight eval harness

Run before **any** `prompt_version` bump, model id change, or reasoning-effort
change. Attach the report to the PR. This is the standing gate from the
library-and-reasoning design (decision 11).

It is **not** in CI, and should not be. Real models cost real money, and a gate
that bills per push gets disabled the first busy week.

## The fixtures are synthetic. All of them.

Every persona under `scripts/eval-fixtures/` was written for this harness. None
is derived from a real user's vault, and none ever should be — the whole point
of a synthetic set is that an eval can be run, shared, and checked into git
without anyone's journal going with it. The live runner reinforces this
structurally: it reads verse text from `bible_passages` (public reference data,
anon key) and takes everything else from the fixture files, so there is no code
path by which it could reach a real account.

The ten personas cover the cases where the voice is most likely to slip:

| Fixture | What it is guarding |
|---|---|
| `sparse-month` | Thin input → restraint, not padding |
| `grief-month` | Loss → accompaniment, not explanation |
| `ordinary-month` | Nothing dramatic → the hardest case for a devotion |
| `doubt-season` | Honest doubt → not resolved on the reader's behalf |
| `heavy-study-month` | Dense study → depth matched without lecturing |
| `contested-passages` | Election, headship, eschatology → deferral, not adjudication |
| `no-first-name` | No name on the profile → no invented salutation |
| `long-vault` | Twelve entries → selection, not summary |
| `brand-new-user` | Empty vault → a refusal, not an invented reader |
| `non-english-name` | Diacritics → exact reproduction, never transliteration |

Four more describe **study-chat** scenarios — an open chapter and a question a
reader would actually type:

| Fixture | What it is guarding |
|---|---|
| `study-psalm-27` | The densest commentary coverage we hold → depth without lecturing |
| `study-hebrews-11` | Cross-references reaching back over the testament divide |
| `study-genesis-1` | A standing invitation to overreach into cosmology the text does not address |
| `study-romans-9` | A genuinely divided question → labeled readings, not adjudication |

## Fixture shape

`candidateVerses` is the Scripture the devotion may anchor on. Production
retrieves these **semantically from the theme query**, so every user gets
candidates whether or not they have ever highlighted anything. The harness
supplies them explicitly instead, which is the one place it knowingly diverges
from production — it trades retrieval realism for a run that needs no Voyage key
and no seeded project.

`highlights` are kept separate: they describe what the persona marked, which
matters for reflection fixtures later. When `candidateVerses` is absent the
harness falls back to the highlights.

A fixture that expects an artifact but supplies neither is rejected by `--dry`.
It sets the model an impossible task — pick an anchor from an empty list — and
surfaces as a baffling `anchor verse ""` citation error. That was a real bug in
the first baseline run.

## Running

```bash
# Costs nothing. Parses every fixture and scores its corpus.
npx tsx scripts/eval-lamplight.ts --dry

# Real models. Needs OPENAI_API_KEY plus the app's usual Supabase env.
npx tsx scripts/eval-lamplight.ts --live --artifact=devotion
npx tsx scripts/eval-lamplight.ts --live --artifact=study-chat

# Study-chat grounding only: builds and scores the retrieval context, then stops.
# No model, no OPENAI_API_KEY, no cost — run it whenever you want.
npx tsx scripts/eval-lamplight.ts --live --artifact=study-chat --grounding-only

# One fixture, for debugging a specific regression.
npx tsx scripts/eval-lamplight.ts --live --fixture=grief-month
```

A fixture describes **one** kind of scenario, and the runner picks accordingly: fixtures carrying a `studyChat` block belong to `--artifact=study-chat`, and every other fixture to `--artifact=devotion`. Running one through the other would score an artifact the fixture never intended, so the split is enforced rather than left to the operator.

A live run writes `docs/lamplight/evals/<date>-<label>/` containing
`report.md`, `report.json`, and **one snapshot file per fixture**. It exits
non-zero when the report fails, so it can gate a release script.

### Coverage

`devotion` and `study-chat` are wired for live runs. **Reflection is not** — it
needs a month of retrieval context the fixtures do not yet describe. Extending it
is additive; the fixture schema and the report already accommodate all three kinds.

#### What a study-chat run does and does not exercise

The harness runs on the **anon key**, by design: that is what makes it structurally
incapable of reaching a real vault. But the three semantic retrieval RPCs —
`match_user_note_embeddings`, `match_bible_embeddings`, `match_library_chunks` —
are all revoked from `public`, and their callers throw rather than degrade. So a
study-chat run sets `skipSemanticRetrieval` on the real `buildStudyContext` and
exercises the channels it *can* reach:

| Channel | In a study-chat eval |
|---|---|
| Open chapter text | ✅ |
| Book apparatus (`bible_books`) | ✅ |
| Cross-references + their resolved targets | ✅ |
| Library — verse-anchor join | ✅ |
| Lexicon (`bible_strongs` / `bible_interlinear`) | ✅ |
| Library — semantic half | ❌ revoked from anon |
| Whole-Bible related passages | ❌ revoked from anon |
| User notes | ❌ revoked from anon (and never wanted here) |

This is a real limit, and every snapshot states it rather than leaving a
suspiciously thin grounding block to be misread as a model problem. It is also
the half that matters most: those deterministic channels are exactly the ones
that sat dark for months while `bible_cross_references` was empty in production.

Going further would mean either a **service-role key** — which would forfeit the
guarantee above — or a **seeded eval account** with its own notes and embeddings.
Both are larger decisions than a scoring layer should make on its own.

#### Grounding floors

A study-chat fixture can assert what must reach the prompt:

```json
"expectGrounding": { "minCrossRefs": 3, "minLibraryExcerpts": 2, "requireBookContext": true }
```

These are the checks that would have caught the empty cross-reference table: a
reply reads perfectly well on grounding that was never there, so scoring only the
prose misses it entirely. They cost nothing, which is why `--grounding-only`
exists — run it after any retrieval, migration, or ingest change.

## What each check means

| Check | Meaning |
|---|---|
| `voice_families` | No banned / contested / growth phrasing (regex families from `_shared/voice.ts`) |
| `must_not_contain` | Fixture-specific phrases — e.g. "closure" in the grief month |
| `max_first_name_mentions` | The devotion contract allows a name at most twice |
| `expect_no_artifact` | The empty vault refused to generate |
| `generation` | The pipeline returned an artifact at all |
| `grounding_cross_refs` | Enough cross-references reached the prompt (study-chat) |
| `grounding_library_excerpts` | Enough library excerpts reached the prompt (study-chat) |
| `grounding_book_context` | The `bible_books` row resolved (study-chat) |
| scripture violations | `verifyArtifactScripture` found an unrepairable misquote or an unresolvable ref |

Scripture is checked **inside the pipeline**, not afterwards: a near-miss quote
is repaired before persistence and only an unrepairable one becomes a violation.
So a live run reaching the scoring layer with zero violations means the gate
worked, not that the model never slipped — the repairs are the interesting part,
and they show up in the snapshot diffs.

## What a green run does NOT prove

It does not prove the prose is any good.

Register — *does this sound like Lamplight?* — is not machine-checkable, and no
amount of regex will make it so. A green run means nothing embarrassing or
false got through the deterministic gates. Whether the devotion is worth someone's
morning is a question for a human reading the snapshots, which is exactly why
every run writes them.

Read at least the `grief-month`, `ordinary-month`, and `doubt-season` snapshots
by hand before shipping a prompt change. Those three are where a voice slips
first: grief invites platitude, ordinariness invites padding, and doubt invites
resolution.

## Reading a report

`report.md` leads with PASS/FAIL, the per-artifact token and cost tally, and
every failure with its reason. Cost is computed from the same price table the
admin dashboard uses (`src/admin/lamplight-cost.ts`), so if one is wrong they are
both wrong — verify against provider pricing at ship time.

Keep old report directories. The baseline is what later changes are compared
against, and a prompt regression is usually obvious in the diff of two snapshots
long before it is obvious in a metric.
