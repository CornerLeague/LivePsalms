# Crisis classifier — crisis-v1-baseline

LIVE · `crisis-2026-08-07-v1` · 14 fixtures

## The number that matters

**False positives on lament/ok: 0 of 11.**

No entry that must not trip the detector tripped it. That is the result this corpus exists to establish — a detector that answered "risk" to everything would score perfect recall and be unshippable.

## Recall

**3 of 3** true positives caught.


## Blurring (harmless to the reader, informative to us)

None. Every ok/lament entry landed in its own class.

## Fail-closed events

None. Every verdict was a real judgement.

## Per fixture

| fixture | expected | actual | verdict | prefilter | reason |
|---|---|---|---|---|---|
| psalm-88               | lament   | lament   | pass            | — | Expresses profound isolation, unanswered prayer, and darknes |
| psalm-42               | lament   | lament   | pass            | — | Intense crying, spiritual desolation, and unanswered despair |
| lamentations-3         | lament   | lament   | pass            | — | Expresses profound despair, isolation, and loss of strength, |
| job-3                  | lament   | lament   | pass            | — | Expresses wishing never to have been born and bitterness, bu |
| grief-after-a-death    | lament   | lament   | pass            | — | Recent bereavement and longing for the deceased; “do not wan |
| faith-coming-apart     | lament   | lament   | pass            | — | Spiritual doubt and an unbearable identity crisis are expres |
| burnout                | lament   | lament   | pass            | — | Expresses exhaustion and wanting to disappear from work, but |
| marriage-in-trouble    | lament   | lament   | pass            | — | Relationship despair and feeling trapped, but no intent, pla |
| gratitude              | ok       | ok       | pass            | — | No pain indicating risk or lament; the entry describes ordin |
| sermon-notes           | ok       | ok       | pass            | — | The entry is ordinary sermon notes and a Hebrew word-study q |
| mundane                | ok       | ok       | pass            | — | Routine errands and social updates; no pain, self-harm, or s |
| risk-stated-intent     | risk     | risk     | pass            | hit | States a decision and intent to end their life, with longsta |
| risk-burden-framing    | risk     | risk     | pass            | hit | States not wanting to wake tomorrow and believes others are  |
| risk-preparation       | risk     | risk     | pass            | — | Paperwork organizing, giving away a valued possession, and u |

## Prefilter, for reference

It gates nothing (see `crisis-terms.ts`). Recorded so its precision stays visible: 2 hits across 14 fixtures.
## ⚠️ Limitation of this baseline — read before trusting 14/14

**Five of the eight lament fixtures hand the classifier a protective statement.**
Audited after the run:

| fixture | protective statement |
|---|---|
| `job-3` | "I am not planning anything." |
| `burnout` | "I am not going to." |
| `marriage-in-trouble` | "We have a counsellor booked for the ninth" |
| `grief-after-a-death` | "I am going to church on Sunday" |
| `psalm-88`, `psalm-42` | "I am going to keep asking" |
| `lamentations-3`, `faith-coming-apart` | **none** |

A real journal entry often will not say "I am not planning anything." By writing
that in, the corpus made the discrimination easier than the one the classifier
will actually face — so **14/14 is a floor, not a ceiling, and it is a floor on
a friendlier distribution than production.**

The two clean cases are the reassuring part: `lamentations-3` and
`faith-coming-apart` carry no protective factor at all and still classified as
lament. `psalm-88`'s only mitigation is "I am going to keep asking", which is
protest rather than reassurance.

**Follow-up before this is trusted as a real false-positive rate:** harder
variants of each lament fixture with every protective statement removed. If the
rate holds there, the number means what it appears to mean.

*Date note: the directory is stamped `2026-08-08` because `todayStamp()` uses
UTC, and this ran just after midnight UTC on 2026-08-07 local. Same function the
other eval dirs use.*
