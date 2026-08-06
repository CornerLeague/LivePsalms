# Research: AI-Faith Product Landscape, Grounding Techniques, Personalization, Models

> Deep-research report, 2026-08-04. All claims sourced from live web research; URLs inline.

## 1. Product landscape

- **YouVersion** — deliberately *anti*-generative; AI limited to recommendations. Its CEO publicly campaigns on AI's Scripture-accuracy problem: best models misquote the Bible ~15% of the time, some up to 60% ([Christian Post](https://www.christianpost.com/news/ais-bible-misquotes-range-from-15-to-60-youversion-ceo.html)). Strategic read: the biggest player is ceding generative space and staking its brand on "human-curated = trustworthy" — that defines the trust bar.
- **Logos** — the most instructive grounding model: Smart Search "Synopsis" is *footnoted to books in the user's own licensed library* ([Logos help](https://support.logos.com/hc/en-us/articles/30128615450765-Using-AI-Tools-for-Smarter-Bible-Study)). Pastors praise library-grounded synopsis; they're wary of sermon *generation* — "AI preaches badly but assists well" ([pastor review](https://www.david-couch.com/2024/10/logos-bible-software-review-2024-a-pastors-experience-with-the-new-ai-powered-platform/)). Subscriptions ~$9.99–19.99/mo.
- **Bible Chat (biblechat.ai)** — category leader: 30M+ downloads, ~5M MAU, €13.4M raised, ~97% free, premium ~$4.99/week ([Tech.eu](https://tech.eu/2025/06/20/how-romanian-startup-bible-chat-turned-ai-and-faith-into-a-global-phenomenon/)). Self-described: fine-tuned in-house models + refinement layer; onboarding captures translation + denomination and tailors per tradition; pastors/priests/scholars review sensitive-topic answers. Reviewers in 2026 still caught it citing wrong verse references; criticized for weekly-subscription checkout steering ([Warmpeach tests](https://www.warmpeach.com/blog/best-bible-chat-apps)).
- **Hallow** (Catholic, $69.99/yr, $105M raised) — Hallow AI answers grounded in a defined Catholic corpus with references + explicit privacy commitment ([FAQ](https://help.hallow.com/en/articles/13601993-hallow-ai-faq)). Surfaces **Magisterium AI** — the strongest citation-first exemplar in religious AI: ~26,500 magisterial documents, every claim footnoted to exact paragraph of exact document ([NC Register](https://www.ncregister.com/news/magisterium-ai-a-game-changer-for-the-church)). Even it has theological critics ([Newpolity](https://newpolity.com/blog/delete-magisteriumai)) — citations alone don't end the "should machines mediate doctrine" debate.
- **Pray.com** — AI as production infra (PRAY Studio media generation, Palantir translation partnership), not user-facing theology.
- **Glorify / Abide / Dwell** — content-first, AI-light. None publicize serious generative personalization — whitespace Lamplight already occupies.
- **"Theo"-type companions** — a crowded cluster of near-identical GPT wrappers; the category's churn layer.
- **Apologist Project** — free nonprofit chatbot on a *curated partner corpus* (Got Questions, Ligonier, Reasons to Believe); 1.5M+ questions in ~200 languages. Thoughtful engineering critique of the whole enterprise: [Luke Plant](https://lukeplant.me.uk/blog/posts/should-we-use-llms-for-christian-apologetics/).
- **Open source**: [calebyhan/bible-rag](https://github.com/calebyhan/bible-rag) (hybrid vector + full-text fused with Reciprocal Rank Fusion, then reranked), [AdbC99/ai-bible](https://github.com/AdbC99/ai-bible) (MCP server for deterministic Bible lookup — "give the model a Bible tool, don't trust its memory").
- **Psalmlog** — the clearest direct competitor to Lamplight: voice-first Bible journaling; structured 6-part AI response (key passage, pastoral framing, encouragement, prayer, practical step, **thread back to the user's own words**); Spiritual Insights Dashboard (themes/emotional trends); Mar 2026 "AI journey memory" using recent journal history. $9.99/$19.99/$34.99 per month ([psalmlog.com](https://psalmlog.com/devotional-journal-app)).

### Trust data (surveys)

- **Barna (Nov–Dec 2025):** 48% of practicing Christians would trust AI for spiritual growth; 34% say AI's spiritual guidance equals a pastor's (44% of Millennials); yet **83% worry about AI misinterpreting Scripture**; 72% fear it replacing spiritual leaders; **94% of pastors worry about scriptural misinterpretation**; only 12% of pastors trust AI for spiritual growth; a third of Christians want pastoral guidance on AI but only 12% of pastors feel ready ([Barna](https://www.barna.com/research/christians-trust-ai-flourishing-spiritual-authority/), [gift & threat](https://www.barna.com/research/christians-view-ai-gift-threat/)).
- **Lifeway (Apr 2026):** 42% of Protestant pastors use/experiment with AI; churchgoers split on AI in sermon prep (44% fine / 43% not); 61% concerned about AI's influence on Christianity ([Lifeway](https://research.lifeway.com/2026/04/21/pastors-churchgoers-see-ai-as-concerning-and-confusing/)).
- **Gloo FAI-C benchmark (Dec 2025):** leading LLMs average 61/100 across 7 flourishing dimensions, worst on Faith (48) — models systematically flatten Christian language into generic spirituality ("higher power," "mindfulness") ([Gloo](https://gloo.com/press/releases/gloo-unveils-the-first-benchmark-exposing-how-ai-misses-christian-worldview-and-values)).

**Trust builders:** visible citations to a named corpus; pastoral/scholarly review of sensitive answers; clear AI self-identification; refusal to fabricate Scripture; acknowledging contested questions and pointing to pastors. **Trust destroyers:** misquoted/fabricated verses (the #1 cited failure); "ChatGPT with a Christian wrapper" genericism; Jesus-roleplay chatbots; sycophancy ("chatbots tell us what we want to hear" — Heidi Campbell, [TechCrunch](https://techcrunch.com/2025/09/14/users-turn-to-chatbots-for-spiritual-guidance)); subscription dark patterns.

## 2. Grounding techniques

**Never let the model recite Scripture from memory.** Verse text must be *injected* from a canonical DB and *verified* post-generation — deterministic, cheap, uniquely easy in this domain because ground truth is finite and versioned.

**Post-generation citation verification pipeline** (mature open-source parsers exist):
1. Parse all verse refs in output — [openbibleinfo/Bible-Passage-Reference-Parser](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser) (TS, handles typos/ambiguity), [eliranwong/bible-verse-parser](https://github.com/eliranwong/bible-verse-parser) (Py), [awoken-bible/reference](https://github.com/awoken-bible/reference) (npm).
2. Bounds-check book/chapter/verse existence.
3. Normalized string-match quoted text against the canonical translation (exact or tight-threshold fuzzy); auto-replace with canonical text or strip.
4. Reject/retry generation on failure.

**Chunking commentaries:** no Bible-specific chunking paper exists; transferable findings: structural/document-aware chunking beats fixed-size for texts with strong internal anatomy ([Databricks guide](https://community.databricks.com/t5/technical-blog/the-ultimate-guide-to-chunking-strategies-for-rag-applications/ba-p/113089)); hierarchical chunking improves long structured docs ([HiChunk](https://arxiv.org/pdf/2509.11552)). For commentary the natural unit is **verse-anchored chunking**: chunk on the commentary's own verse-range headings, store `book/chapter/verse_start/verse_end` as first-class metadata, respect pericope boundaries — enables exact-match joins with cross-refs and user backlinks. Semantic chunking only for non-anchored material.

**Hybrid retrieval:** dense embeddings + exact/full-text (BM25) fused with RRF, then reranked (already implemented in-domain by calebyhan/bible-rag). For Lamplight the exact-match channel should be *verse-reference-keyed*: a note anchored to Rom 8:28 pulls (a) cross-reference edges, (b) commentary chunks whose verse-range overlaps, (c) the user's own backlinked notes — fused with Voyage hits.

**Prompt patterns:** answer ONLY from provided sources; cite each claim with an ID; say "I don't know based on the provided sources" when absent; provided context takes precedence over model knowledge ([RAG prompt engineering](https://mbrenndoerfer.com/writing/rag-prompt-engineering-context-citations)). Nuance: citation *correctness* ≠ citation *faithfulness* — models decorate parametric claims with plausible citations, so verification must check entailment ([Wallat et al. 2025](https://staff.fnwi.uva.nl/m.derijke/wp-content/papercite-data/pdf/wallat-2025-correctness.pdf)).

**Published religious-domain evals:** nearest peer-reviewed analog is Quranic RAG ([13 LLMs evaluated](https://arxiv.org/abs/2503.16581) — human-scored context relevance / answer faithfulness / answer relevance; reusable rubric). Christian-side: [BibleQA](https://arxiv.org/pdf/1810.12118) (1,001 Q/A pairs tied to supporting verses; literal translations performed best), Gloo FAI-C for values alignment. **No public verse-quote-accuracy benchmark exists — a small internal one would exceed published state of the art.**

## 3. Personalization patterns

- **Rosebud** — reference implementation: persistent long-term memory across full journal history, weekly reports, adaptive styles; the *loved* feature is longitudinal callbacks ("a months-long avoidance pattern," "shift since January") ([rosebud.app](https://www.rosebud.app/), [memory docs](https://help.rosebud.app/ai-analysis/long-term-memory)).
- **Day One** — cautionary tale: E2E encryption makes AI shallow (temporary decryption for processing, never trained on) ([AI features](https://dayoneapp.com/guides/labs/ai-features/)).
- **Stoic** — liturgy/structure + AI beats freeform chat for habit retention. **Mindsera** — differentiates on cognitive frameworks. **Psalmlog** — every insight threads back to the user's own words; theme dashboard; journey memory.
- **Research architecture** (now well-mapped): raw entries → topic-segmented episodic memories → periodic consolidation → continuously refined global profile ([H-MEM](https://arxiv.org/pdf/2507.22925), [TiMem](https://arxiv.org/pdf/2601.02845), [memory survey](https://arxiv.org/html/2604.01707v1)). Maps onto Lamplight: per-note extraction → monthly reflection (already built) → distilled journey profile seeding every surface.
- **What makes output feel personal:** (1) quote the user's own phrases with dates ("three weeks ago you wrote…"); (2) name specific people/passages/events, never archetypes; (3) trajectory framing (now vs. then); (4) surface patterns the user hasn't noticed; (5) tie callbacks to scripture anchors they actually studied — Lamplight's backlinks make this uniquely verifiable. Anti-pattern: horoscope-generic encouragement.
- **Privacy framing norm:** an explicit in-product contract at the point of AI use — entries read only to generate your insights; never trained on; never sold.

## 4. OpenAI capability check (verified Aug 2026)

Per 1M tokens ([pricing](https://developers.openai.com/api/docs/pricing), [Willison launch analysis](https://simonwillison.net/2026/Jul/9/gpt-5-6/)):

| Model | Input | Cached in | Output | Notes |
|---|---|---|---|---|
| gpt-5.6-sol | $5.00 | $0.50 | $30.00 | Flagship; 1M ctx, 128K out |
| gpt-5.6-terra | $2.00 | $0.20 | $12.00 | Balanced; 1M ctx (20% cut Jul 30) |
| gpt-5.6-luna | $0.20 | $0.02 | $1.20 | Fast; 1M ctx (80% cut Jul 30) |
| text-embedding-3-small/large | $0.02 / $0.13 | — | — | Unchanged since 2024 |

- GPT-5.6 (Jul 9, 2026; Feb 2026 cutoff): 1M context, 128K output, **six reasoning-effort levels (none/low/medium/high/xhigh/max)**, programmatic tool calling, **explicit prompt-cache breakpoints**, persisted reasoning across turns.
- **Structured outputs** (json_schema strict) supported across lineup. **Batch API: flat 50% discount** — ideal for scheduled generation. **Prompt caching: 90% discount** on cached input.
- **Embeddings:** Voyage (MongoDB-owned) voyage-3.5 ($0.06/M) and voyage-3-large ($0.18/M) **outperform text-embedding-3-large** on retrieval benchmarks ([comparison](https://agentset.ai/embeddings/compare/openai-text-embedding-3-large-vs-voyage-3-large)). **Keep Voyage.**
- **Tier fit:** reflections/long-form → sol at high effort via Batch (effective ~$2.50/$15); chat → terra (low/medium effort for latency); judges/extraction → luna or nano (cheap enough to judge *every* generation); verse verification → not an LLM job (deterministic).

## 5. Risk & theology-specific design wisdom

- **Mis-formation critique** (TGC, widely shared): AI's danger is outsourcing prayer/study/counsel, atrophying the habits and discernment that constitute discipleship ([TGC](https://www.thegospelcoalition.org/article/danger-ai-misformation/)). **Lausanne** is most design-actionable: prefer retrieval over free generation, keep human/pastoral oversight, position explicitly as supplement to — never substitute for — community ([Lausanne](https://lausanne.org/global-analysis/navigating-ai-for-biblical-engagement)). Warnings on parasocial spiritual authority ([BU](https://www.bu.edu/articles/2026/religion-ai-god-chatbots/)) and sycophancy as spiritual hazard.
- **Crisis content:** journals *will* receive self-harm disclosures. Rosebud's CARE benchmark: every model but one had ≥1 critical failure; 86% missed an indirect signal; GPT-4o-mini 46% critical-failure rate ([rosebud.app/care](https://www.rosebud.app/care)). Don't rely on base-model alignment. Proven protocol (Woebot): deterministic detection → confirm with user → curated crisis resources, with "not a crisis service" onboarding disclosure ([protocol](https://cdn.clinicaltrials.gov/large-docs/27/NCT04460027/Prot_000.pdf)).
- **Denominational strategies:** (a) user-selected lens (Bible Chat); (b) single-tradition clarity (Hallow/Magisterium); (c) curated multi-partner corpus (Apologist Project). Failure mode: (d) unrooted vagueness — the FAI-C-measured "higher power" flattening that reads as mush to every tradition simultaneously.
- **Institutional guidance:** SBC 2023 resolution on AI (dignity, transparency, Christlike use — [text](https://www.sbc.net/resource-library/resolutions/on-artificial-intelligence-and-emerging-technologies/)); Vatican *Antiqua et Nova* (Jan 2025 — AI complements, never replaces human intelligence; must not become functional substitute for God or human relationship). Both converge: transparency about the machine, dignity of the human, primacy of embodied community.

## Top 10 design implications for Lamplight

1. **Make "never misquotes Scripture" the headline guarantee — enforced in code, not prompts** (inject canonical text; deterministic post-generation verification; regenerate on failure).
2. **Footnote like Magisterium, ground like Logos** — every claim carries a tappable citation to a verse or *named* corpus source; spot-check entailment with a cheap judge pass.
3. **Fuse three retrieval channels** — verse-ref exact-match (cross-ref edges + note backlinks), Voyage embeddings, full-text — via RRF. The TSK + backlinks graph is a structural advantage no embedding-only competitor has.
4. **The personalization moat is longitudinal, not conversational** — per-note extraction → monthly distillation (Waymarks exists) → rolling journey profile; timeline callbacks with verse-anchored receipts.
5. **Keep Voyage; spend OpenAI budget on generation tiers** — sol-via-Batch for reflections, terra for chat, luna for judges; prompt-cache system + guardrails + journey profile.
6. **Validation pass on every long-form output** — verses validated, claims entailed, tone not sycophantic, no generic-spirituality flattening; build the small internal eval no one else has.
7. **Deterministic crisis layer before deepening journal AI** — detection on input → confirm → curated resources → suppress normal AI reflection on that entry.
8. **Design for humility** — the AI is a study companion, never a spiritual authority; no God-roleplay; recommends pastor/community for contested or weighty questions. This is also what SBC + *Antiqua et Nova* ask.
9. **Denominations: rooted, user-visible lens — not neutrality-by-vagueness** — labeled multi-tradition answers ("Reformed readings emphasize…; Wesleyan…") beat both hidden bias and mush.
10. **Fight mis-formation structurally** — sequence outputs so Scripture and the user's own wrestling come first; occasionally challenge rather than affirm ("last month you committed to X — how is it going?"); meter insights; pair with an explicit in-product privacy covenant.
