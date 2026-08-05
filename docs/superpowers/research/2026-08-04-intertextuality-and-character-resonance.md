# Research: Biblical Intertextuality Data + Character-Resonance Frameworks

> Deep-research report, 2026-08-04. License claims marked **VERIFIED** were confirmed by fetching the page/repo during research.

## 1. OT-in-NT data: machine-readable options

### Tier 1 — openly licensed, safe for a commercial app

| Dataset | What | License | Status |
|---|---|---|---|
| [OpenBible.info Cross References](https://www.openbible.info/labs/cross-references/) | ~340k cross-refs, 2 MB zip, user-vote quality scores (TSK-seeded) | CC **Attribution** | **VERIFIED** (already ingested as `bible_cross_references`) |
| Treasury of Scripture Knowledge (bundled client-side already) | ~500k refs, 1830s | Public domain | Established |
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) | Tagged OT/NT, lexicons, TIPNR proper names | CC BY 4.0 | Verified via repo |
| [Clear-Bible MACULA Greek](https://github.com/Clear-Bible/macula-greek) / [Hebrew](https://github.com/Clear-Bible/macula-hebrew) | Word-level linguistic annotation (syntax, semantic domains, referents, **quotation annotations**) | CC BY 4.0 (Biblica) per LICENSE.md | License verified; quotation-layer coverage **unverified — inspect before relying** |
| [BradyStephenson/bible-data](https://github.com/bradystephenson/bible-data) | CSVs: person tables, references, events, epochs | CC BY 4.0 ("including for commercial purposes") | **VERIFIED** |
| Public-domain quotation classics: [Gough, *The NT Quotations* (1855)](https://archive.org/details/newtestamentqu00goug); Easton's (1897) | Full collations of NT quotations vs Hebrew/LXX | Public domain | Archive.org verified |

### Tier 2 — usable with caution
- Clear-Bible/speaker-quotations — spans/speakers, not OT↔NT links; license unconfirmed.
- josephilipraja/bible-cross-reference-json — **GPL-2.0 (VERIFIED)** — legally awkward for closed-source bundle; **skip** (OpenBible CC-BY is strictly better).
- balinjdl/OT-NT-Reference-Map — data provenance murky ("with permission" from mb-soft.com) → avoid.
- Sefaria — superb *Jewish* intertextuality API but **no New Testament**; per-text licenses incl. CC-BY-NC — filter by license if ever surfacing rabbinic parallels.

### Tier 3 — copyrighted; consult in print, never ingest
- **NA28 Appendix III / UBS5 quotation-allusion indexes** — copyrighted editorial apparatus (Deutsche Bibelgesellschaft), digital only inside Accordance/Logos. Individual facts are uncopyrightable; wholesale reproduction of selection/arrangement risks compilation copyright. Use as *checking* source for a hand-curated table.
- Archer & Chirichigno (Moody 1983); Felix Just's tables; Kalvesmaki's LXX chart; BLB's list — consult while curating.
- [intertextual.bible](https://intertextual.bible/about) — most interesting scholarly-tagged connection graph; **VERIFIED: no license stated, no API, anonymous maintainer** — contact or skip; do not scrape.
- Crossway/ESV study charts — copyrighted; no open list.

**Bottom line:** OpenBible CC-BY (with votes) + bundled TSK as the broad graph; MACULA (CC BY) for word-level rigor later; hand-curate a **~350–450-row quotation/major-allusion table** (typed: citation / quotation / allusion / echo; direction; LXX-vs-MT note; NT rhetorical function) built from public-domain Gough/Easton and print-checked against NA28/Beale-Carson. Facts are free; the table's arrangement becomes proprietary IP.

## 2. Typology & biblical-theology frameworks (for prompt/curriculum design)

Frameworks are *ideas* (not copyrightable) — ship only original prose summaries:

1. **Promise–fulfillment** — OT promises find their yes in Christ (Goldsworthy's kingdom framework: God's people in God's place under God's rule).
2. **Typology done responsibly** — Beale's criteria for a genuine type: (a) analogical **correspondence**, (b) **historicity**, (c) **escalation** (antitype exceeds type), (d) forward-pointing divine design, (e) retrospection in light of Christ ([Handbook summary](https://www.booksataglance.com/book-summaries/handbook-on-the-new-testament-use-of-the-old-testament-exegesis-and-interpretation-by-gregory-k-beale/)). Guardrail: typology traces *God's patterned acts*, not allegory on incidental details.
3. **Allusion/echo discipline** — Hays' seven tests (availability, volume, recurrence, thematic coherence, historical plausibility, history of interpretation, satisfaction) → translate directly into a confidence scale: citation > quotation > allusion > echo > thematic parallel.
4. **Greidanus' seven roads from an OT text to Christ** — redemptive-historical progression, promise–fulfillment, typology, analogy, longitudinal theme, contrast, NT reference ([TGC summary](https://www.thegospelcoalition.org/blogs/trevin-wax/7-ways-of-preaching-christ-from-the-old-testament/)). **Ideal as the engine's explanation typology — every suggested connection names which road it travels.**
5. **Covenant backbone** — creation/Adamic → Noahic → Abrahamic → Mosaic → Davidic → New (already/not-yet). Present covenant *structure* without hard-coding one system's distinctives (covenant theology vs progressive covenantalism vs dispensationalism).
6. **Whole-Bible longitudinal themes** — temple/presence (Eden→tabernacle→temple→incarnation→church→new creation), kingdom, seed, exile & return, rest/sabbath, shepherd/king, sacrifice/priesthood, marriage/bride, water/life, bread/manna, vine/vineyard, light/darkness. Write original theme definitions (NDBT/BibleProject are copyrighted curricula — reading list only).
7. **Public-domain classic:** Patrick Fairbairn, *The Typology of Scripture* (1845–47) — **VERIFIED public domain** ([archive.org NOT_IN_COPYRIGHT](https://archive.org/details/typologyscriptu03fairgoog)) — quotable/excerptable freely. Beale, Goldsworthy, Greidanus, Carson: frameworks yes, text no.

## 3. The exemplarism debate (shapes character resonance directly)

**The critique.** Dutch Reformed "exemplarism controversy" (1930s–40s: Schilder, Holwerda, Veenhof): preaching characters as moral examples ("dare to be a Daniel") detaches narratives from redemptive history and makes them anthropocentric — every text is a stage in God's one work culminating in Christ ([overview](https://en.wikipedia.org/wiki/Redemptive-historical_preaching); [Deddens essay](https://www.christianstudylibrary.org/article/redemptive-historical-preaching-over-against-various-forms-modern-exemplarism) — which concedes examples are legitimate "when they place God, not men, in the centre"). Chapell's *Christ-Centered Preaching* gives the evangelical mainstream version: find the **Fallen Condition Focus** (the shared human brokenness the text addresses), then the grace that answers it — avoiding "be like" moralism that produces despair or pride.

**The counterweight.** Scripture itself uses characters as examples: 1 Cor 10:6, Heb 13:7, Jas 5:17, Heb 11 — but note *how*: Hebrews 11 is a gallery of **faith in God's promise**, not moral excellence; most figures are deeply flawed; the chapter drives to Jesus, "founder and perfecter" (12:2). Kenneth Way: a "Hall of Feeble Faith" ([Biola](https://www.biola.edu/blogs/good-book-blog/2011/handling-heroes-in-hebrews-11)).

**DESIGN RULES extracted:**
1. **Resonance ≠ role model.** "Your season resembles the road [character] walked" — never "you are [character]" or "be like [character]."
2. **Center on how God met the character.** Every match answers: what did God do, promise, reveal of himself in this life?
3. **Faith-response, not personality, is the matching axis** — posture under pressure (honest lament, reluctant obedience, steadfast loyalty, waiting on promise), not temperament or plot.
4. **Flaws are mandatory content** (David's sin, Moses' anger, Peter's denial, Sarah's laughter). Prevents flattery and despair alike.
5. **Land on Christ / what it reveals about God** — every resonance ends God-ward, not self-ward, naming its Greidanus road.
6. **Include the Fallen Condition Focus** — the shared brokenness is the honest bridge (Chapell).
7. **Never prescriptive fortune-telling** — no "God will do for you what he did for Esther." Describe God's character, not predicted outcomes.
8. **Multiple companions, held loosely** — 1 primary + 1–2 secondary, revisited over time; anti-horoscope by design.

## 4. Character data

**What exists (structured):**
- [Theographic Bible Metadata](https://github.com/robertrouse/theographic-bible-metadata) — ~3,000 people with relationships, ~1,300 places, events, periods, verse links; CSV/JSON/GraphQL; **CC BY-SA 4.0** (share-alike — keep as a separate data layer).
- [STEPBible TIPNR](https://github.com/STEPBible/STEPBible-Data) — every proper noun disambiguated to unique individuals, all references, family relations; **CC BY 4.0**.
- [BradyStephenson/bible-data](https://github.com/bradystephenson/bible-data) — Person, PersonLabel (Strong's + name meanings), PersonRelationship, PersonVerse CSVs; **CC BY 4.0 VERIFIED**.
- **No open dataset of character traits/values/spiritual arcs exists** (searched thoroughly). This layer must be hand-curated — which is the moat. Key profiles to open person-ID systems (TIPNR/Theographic) so passages, relationships, events join for free.

**Proposed schema — `character_profiles` (~40–80 figures):**

```yaml
id: string                 # FK → TIPNR/Theographic person id
name / aka: string[]
testament: OT | NT | both
one_line: string           # honest, non-hagiographic
key_passages: ref[]        # 5-12 core texts
arc_stages:                # calling → wilderness/testing → crisis/failure →
  - stage, refs, summary   #   meeting-God → restoration/commission (nullable per figure)
values_under_pressure: []  # controlled vocab, 2-5 tags (below)
doubts_failures: [{what, refs, gods_response}]
how_god_met_them: string + refs     # THE load-bearing field
what_it_reveals_about_god: string
christ_connection: {road: greidanus_enum, note, refs}
seasons_fit: [wilderness, waiting, calling, grief, doubt, renewal, ...]
misreadings_to_avoid: string[]      # e.g. "David = courage lesson"
companion_texts: ref[]              # psalms/prayers to sit with
sensitivities: string[]             # abuse, infertility, despair-adjacent, etc.
```

**Controlled vocab for `values_under_pressure`:** honest wrestling with God (Job, Habakkuk, Jeremiah, Naomi, Asaph); reluctant obedience (Moses, Gideon, Ananias of Damascus); steadfast loyalty (Ruth, Jonathan, Ittai); costly truth-telling (Nathan, Micaiah, John the Baptist, Esther); waiting on promise (Abraham & Sarah, Hannah, Simeon & Anna, Joseph); integrity in exile (Daniel & the three, Joseph, Nehemiah, Esther); repentance & restoration (David, Peter, Manasseh, Zacchaeus, John Mark); quiet faithfulness (Dorcas, Phoebe, Baruch, Epaphroditus); courage from the margins (Rahab, the Hebrew midwives, Naaman's servant girl, the Samaritan woman); generous partnership (Barnabas, Lydia, Priscilla & Aquila); grief carried to God (Naomi, Hannah, David over Absalom, Mary & Martha); second-generation faith (Timothy, Joshua, Elisha).

**Roster (~72 candidates, breadth deliberate — women and lesser-known included):**
- OT (40): Noah, Abraham, Sarah, Hagar, Isaac, Rebekah, Jacob, Leah, Rachel, Joseph, Judah, Tamar, Moses, Miriam, Aaron, Joshua, Caleb, Rahab, Deborah, Gideon, Samson, Naomi, Ruth, Hannah, Samuel, Saul (cautionary arc), David, Abigail, Jonathan, Nathan, Solomon, Elijah, Elisha, Hezekiah, Josiah, Huldah, Jeremiah (+Baruch), Daniel (+the three), Jonah, Job, Habakkuk, Esther (+Mordecai), Nehemiah/Ezra.
- NT (32): Mary of Nazareth, Joseph of Nazareth, Elizabeth & Zechariah, Simeon & Anna, John the Baptist, Peter, Andrew, John, Thomas, Matthew/Levi, Mary Magdalene, Martha, Mary of Bethany, the Samaritan woman, the Syrophoenician woman, Zacchaeus, Nicodemus, Joseph of Arimathea, the Ethiopian eunuch, Stephen, Philip the evangelist, Cornelius, Barnabas, Paul, Silas, Timothy, Lydia, Priscilla & Aquila, Phoebe, Dorcas, Onesimus (+Philemon), John Mark, Epaphroditus, Apollos.

## 5. "Which character are you" products — failure modes to avoid

Surveyed FaithIt, ProProfs, uQuiz, Beliefnet, BuzzFeed, ChatHolyBible, Idyllic. Shared failure modes:
1. Lifestyle-preference inputs ("pick a weekend activity").
2. Flattery-only outputs — always heroes at their best; no failures, no cost.
3. Static identity — one-shot horoscope verdict, never revisited.
4. Character as terminus — the result says nothing about God (the exemplarism trap).
5. Plot-surface matching ("you like leading, so Moses" — ignoring that Moses' defining trait was reluctance and God's defining act was presence).
6. No scripture path — a share-card, not an on-ramp into texts.
7. Entertainment register — poisons trust for a study app.

**A serious values-resonance version:** input = actual journey signals (notes, highlights, named season — with consent); matching axis = posture-before-God under pressure; output = a *companion for a season* carrying key passages, the character's failure, how God met them, where the arc points to Christ; revisable; explains *why* it matched; invites study rather than announcing identity.

## 6. Journey/season taxonomies

- **Brueggemann: orientation → disorientation → new orientation** (*The Message of the Psalms*) — **the strongest fit: Psalms-native**, season-shaped rather than stage-ranked, maps psalm genres to life placement (hymns of orientation; laments of disorientation; thanksgiving of new orientation). Use as the top-level season model.
- **Hagberg & Guelich, *The Critical Journey*** — six cyclical stages with "the Wall"; useful for recognizing productive-life burnout seasons.
- **Fowler, *Stages of Faith*** — heavily critiqued (faith flattened to generic meaning-making; implicit ranking). **Cite-aware but do not build on it** — ranked stages read as spiritual scorekeeping.
- **Classic seasons language (PD):** wilderness/desert (Exod, Hos 2:14), exile and return, watches of the night/waiting (Ps 130), harvest/seedtime; John of the Cross's *Dark Night* (PD translations exist).
- **Copyright:** frameworks are unprotectable ideas; authors' prose/tables/diagrams are protected. Ship an original ~8-season taxonomy (e.g., calling, wilderness, waiting, testing, grief, doubt/the Wall, repentance/return, renewal/commission), each mapped to psalm genres and `seasons_fit` tags.

## Design skeleton (synthesized recommendation)

### (a) Connections-engine data stack
- Base graph: bundled TSK + OpenBible cross-refs w/ votes (CC-BY, attribute in-app), merged on OSIS refs; votes → prior weight.
- Curated quotation layer: ~400-row OT↔NT table (typed; MT/LXX note; NT function), built from PD Gough/Easton, print-checked; never ingest copyrighted indexes wholesale.
- Word-level layer (later): MACULA lemma-overlap scoring + quotation annotations.
- Theme layer: ~12 longitudinal themes as original-prose definitions with verse anchor sets.
- Typed explanations: every AI-suggested connection declares its Greidanus road + a Hays-informed confidence tier.
- Typology guardrail in the prompt: correspondence + escalation + divine-design required before calling anything a "type"; otherwise downgrade to "analogy"/"shared theme."
- Covenant spine: passage → covenant-epoch tag so explanations locate both passages in the storyline without endorsing one system's polemics.
- Retrieval flow: candidates from graph (TSK ∪ OpenBible ∪ curated) → LLM ranks/explains only retrieved candidates (no free association) — hallucination control.
- User loop: confirm/reject suggested connections → feedback column beside OpenBible votes.
- License hygiene: attribution screen (OpenBible, STEPBible, MACULA/Biblica, Theographic if used); CC BY-SA data in a separable layer.

### (b) Character-resonance system
- Hand-curated `character_profiles` (~60–72 figures) keyed to TIPNR/Theographic IDs; original prose.
- Season taxonomy first: user's season (self-named or gently inferred with consent) classified into ~8 cyclical, unranked seasons.
- Matching: season tag + values-under-pressure tags → score against `seasons_fit` × `values_under_pressure`; personality and plot similarity explicitly excluded.
- Output frame: "companion for this season," 1 primary + 2 alternates; card = where they were, how they responded, **how God met them**, their failure and God's grace, where the arc points to Christ, 5–8 passages + companion psalms.
- Hard guardrails: never "you are X"; never predict outcomes; always the flaw; always God-ward; respect `sensitivities` with gentler variants.
- Anti-horoscope mechanics: matches expire with seasons; monthly revisit; user can contest and see why matched.
- Chapell move built-in: each resonance names the shared Fallen Condition Focus as the bridge.
- Study integration: one tap creates a note pre-linked to the character's key passages + existing cross-ref links — resonance feeds study, not a share-card.
- Review pipeline: every profile passes a theological checklist (flaw included? God-centered? Christ-connection defensible by Beale criteria? misreadings listed?) with named reviewer sign-off.
- Cold start: 6–8 question season-and-posture intake ("what does your prayer sound like lately") — visibly different from lifestyle quizzes.
