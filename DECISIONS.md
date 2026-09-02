# Decisions

Product and licensing decisions that the code cannot explain on its own. One
entry per decision, newest first. Each records what was decided, why, and what
to watch.

## 2026-09-02 — Memorize may snapshot NLT and ESV text; watch the ESV 500-verse cap

**Decision.** NLT and ESV are api-sourced translations (`TranslationInfo.source
=== 'api'`): their text is fetched on demand by the `bible-text` edge function
and cached only in browser session memory. They are never written to
`bible_passages`. The one place their text IS persisted is the Memorize
feature, which by design snapshots a verse's text and translation onto a card
(`memorize_cards.text`) so a quiz stays stable if the reader later changes
translation. The owner ruled that Memorize stays enabled for NLT and ESV.

**Why.** Memorize without the reader's own translation would be a worse
product, and the volume is tiny: cards are added one verse at a time by hand.

**Exposure.** The ESV free licence forbids locally storing more than 500 verses
or one half of any book, whichever is less. Memorize cards are the only
locally stored ESV text in the system, so the count of ESV cards is the number
to monitor. The licence text does not say whether the cap is per copy of the
app, per user, or for the deployment as a whole; until Crossway is asked (part
of obtaining proper licensing before commercial launch), read it the
conservative way — the deployment total — and check it with:

```sql
select translation, count(*) as verses
from public.memorize_cards
where translation in ('ESV', 'NLT')
group by translation;
```

If the ESV total approaches 500, the options in order of preference are:
(1) ask Crossway for a licence that covers it; (2) stop snapshotting ESV text
and re-fetch it at quiz time through `bible-text`; (3) turn Memorize off for
ESV by branching on `source` in the reader's add-to-memorize path. The NLT
licence has no equivalent stored-verse cap at the tier in use, but the same
count is kept for symmetry.

**Also decided in the same session (binding, not to be relitigated):**

- Proceed in beta despite non-commercial-only licensing; proper licensing is
  obtained before commercial launch. The paid Lamplight tiers are dormant.
- Verse search for NLT/ESV searches BSB rows, and the UI labels that
  visibly (`searchFallbackNotice`).
- Lamplight chat, study and generate keep the per-id BSB fallback in
  `fetchPassageText` / `verifyVerseRefs`, which now report the translation
  they actually served, and the client shows the fallback in the attribution
  (`lamplightFallbackNotice`, `readerFallbackNotice`).
