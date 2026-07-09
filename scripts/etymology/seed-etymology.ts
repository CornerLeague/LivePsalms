// Offline seed for bible_etymology (v1: Psalms + Hebrew). Run manually:
//   npx tsx scripts/etymology/seed-etymology.ts
// Steps: (1) enumerate unique Psalms Hebrew Strong's from bible_interlinear
// (verse_id like 'psa.%'); (2) build a verified grounding record from the
// public-domain lexicon inputs under scripts/data/; (3) narrate `development`
// via Opus under the never-invent prompt; (4) run validateGroundedNarration —
// SKIP + log any row whose narration references ungrounded terms; (5) insert
// rows with reviewed=false for the human proofing pass.
//
// Grounding data (place under scripts/data/, both public domain):
//   - OpenScriptures Strong's Hebrew dictionary (strongs → derivation, lemma)
//   - BDB via HebrewLexicon (strongs → gloss, root)
//
// Rows land reviewed=false; a human proofing pass flips reviewed=true (the
// structural launch gate). The panel is absent until proofed rows exist.
//
// Wiring checklist for the implementer:
//   - createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — service role bypasses RLS.
//   - createAnthropicAdapter({ apiKey: ANTHROPIC_API_KEY, fetch }) + VERSE-style
//     never-invent prompt for the `development` field (a study-time analogue of
//     supabase/functions/etymology-insight/prompts/verse-insight.ts).
//   - buildGroundingRecord + validateGroundedNarration from ./etymology-grounding.
//   - study_value: seed heuristically (e.g. by lemma frequency / theological weight);
//     it is proof-adjustable and drives per-verse star ranking.
export {}; // implementer fills in the I/O per the checklist above.
