// Deterministic Scripture verification (depth overhaul, slice 1d).
//
// The "never misquotes Scripture" guarantee, enforced in code rather than asked
// for in a prompt. Finds quoted verse text in generated prose, resolves the
// adjacent reference against bible_passages, and REPAIRS a near-miss to the
// canonical rendering before the artifact is persisted. Only an unresolvable
// reference or an unmatchable quote becomes a violation feeding the stricter
// retry that already exists.
//
// Verification is an ENHANCEMENT, never a hard dependency: a thrown lookup is
// caught, logged once, and treated as "skipped". A bible_passages outage must
// not break generation.
//
// Book names come from verse-verify.ts's OSIS_BOOK_MAP so there is exactly one
// canonical list in the edge runtime. No Deno globals (vitest imports this).

import { OSIS_BOOK_MAP, BOOK_ALIASES, canonicalBook, parseRefToIds, verifyVerseRefs, type VerseFlag } from './verse-verify.ts';
import { stripPsalmSuperscription } from './bible-passage.ts';

// ── Reference detection in prose ─────────────────────────────────────────────
// verse-verify.ts's REF_RE is anchored (it parses a ref that is already isolated).
// Verification needs to FIND refs inside prose, with offsets, so it builds a
// scanning regex over the same book list plus the "Psalm" singular alias.

const BOOK_ALTERNATION = [...Object.keys(OSIS_BOOK_MAP), ...Object.keys(BOOK_ALIASES)]
  // Longest first so "Song of Solomon" wins over "Song" and "1 John" over "John".
  .sort((a, b) => b.length - a.length)
  .map((b) => b.replace(/ /g, '\\s+'))
  .join('|');

const REF_SCAN = new RegExp(
  `\\b(?:${BOOK_ALTERNATION})\\s+\\d{1,3}:\\d{1,3}(?:\\s*[-–]\\s*\\d{1,3})?`,
  'gi',
);

// A quote and its reference must sit in the same breath. These windows are what
// "adjacent" means: enough for `" (Psalm 23:1)` or `Psalm 23:1 says "`, not
// enough to pair a quote with a ref two clauses away.
const TRAILING_REF_WINDOW = 24;
const LEADING_REF_WINDOW = 40;

// Below this a quoted fragment is ordinary emphasis ("shall not want"), not
// verse quotation. Quoting fewer than six words is not a misquote risk.
const MIN_QUOTE_WORDS = 6;

// Straight and curly pairs. Apostrophes are deliberately not quote marks here —
// "the LORD's" must not open a span.
const QUOTE_PAIRS: Array<[string, string]> = [['"', '"'], ['“', '”']];

export interface QuotedSpan {
  quote: string;
  ref: string;
  /** Offsets of the quote CONTENT (inside the marks), so a repair splices exactly. */
  start: number;
  end: number;
}

function findRefNear(text: string, span: { start: number; end: number }): string | null {
  const after = text.slice(span.end, span.end + TRAILING_REF_WINDOW);
  const trailing = after.match(new RegExp(REF_SCAN.source, 'i'));
  if (trailing) return normalizeRefSpacing(trailing[0]);

  const beforeStart = Math.max(0, span.start - LEADING_REF_WINDOW);
  const before = text.slice(beforeStart, span.start);
  const leading = [...before.matchAll(new RegExp(REF_SCAN.source, 'gi'))].pop();
  if (leading) return normalizeRefSpacing(leading[0]);

  return null;
}

function normalizeRefSpacing(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/\s*([-–])\s*/, '$1').trim();
}

/**
 * Every quoted region of at least six words, regardless of whether a reference
 * can be attached. Kept separate from extractQuotedSpans because the
 * fabricated-book check needs to know a region was QUOTED even when its
 * attribution names no real book ("2 Hezekiah 3:16" resolves to nothing, so no
 * QuotedSpan would ever be built for it).
 */
function findQuotedRegions(text: string): Array<{ quote: string; start: number; end: number }> {
  const regions: Array<{ quote: string; start: number; end: number }> = [];

  for (const [open, close] of QUOTE_PAIRS) {
    let cursor = 0;
    for (;;) {
      const openAt = text.indexOf(open, cursor);
      if (openAt === -1) break;
      const closeAt = text.indexOf(close, openAt + 1);
      if (closeAt === -1) break;
      cursor = closeAt + 1;

      const start = openAt + 1;
      const quote = text.slice(start, closeAt);
      if (countWords(quote) < MIN_QUOTE_WORDS) continue;
      regions.push({ quote, start, end: closeAt });
    }
  }

  return regions.sort((a, b) => a.start - b.start);
}

/**
 * Quoted spans of at least six words that carry a resolvable-looking reference
 * immediately before or after them. A span with no nearby ref is skipped: we
 * cannot check a quote we cannot attribute, and guessing would invent errors.
 */
export function extractQuotedSpans(text: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  for (const region of findQuotedRegions(text)) {
    const ref = findRefNear(text, region);
    if (!ref) continue;
    spans.push({ ...region, ref });
  }
  return spans;
}

function countWords(s: string): number {
  return s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** Lowercase, drop punctuation and smart quotes, collapse whitespace. Order kept. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

function multisetCounts(list: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

function multisetIntersectionSize(a: string[], b: string[]): number {
  const counts = multisetCounts(b);
  let shared = 0;
  for (const t of a) {
    const left = counts.get(t) ?? 0;
    if (left > 0) {
      shared++;
      counts.set(t, left - 1);
    }
  }
  return shared;
}

/**
 * Symmetric token similarity (Dice) — how close a quote is to BEING the
 * canonical text. This drives the repair decision: symmetric, so a quote that
 * adds invented words is penalised exactly as much as one that drops real ones,
 * and a partial quote does not read as a near-miss worth rewriting.
 */
export function tokenOverlap(quote: string, canonical: string): number {
  const a = tokens(quote);
  const b = tokens(canonical);
  if (a.length === 0 || b.length === 0) return 0;
  return (2 * multisetIntersectionSize(a, b)) / (a.length + b.length);
}

/**
 * Asymmetric: what fraction of the QUOTE's words actually occur in the canonical
 * text. This is the honesty check, and it is why quoting half a verse is not an
 * error — a faithful excerpt scores 1 while a fabrication scores low regardless
 * of length. Counted as a multiset so repeating one real word cannot pad a
 * fabricated quote toward a passing score.
 */
export function tokenContainment(quote: string, canonical: string): number {
  const a = tokens(quote);
  const b = tokens(canonical);
  if (a.length === 0 || b.length === 0) return 0;
  return multisetIntersectionSize(a, b) / a.length;
}

// ── verifyArtifactScripture ──────────────────────────────────────────────────

// A quotation attributed to a book that does not exist is a fabricated citation,
// and this is the only place we trust a permissive scan: the quote marks supply
// the confidence. A bare "Chapter 3:16" in ordinary prose is NOT treated as a
// hallucinated reference — emitting a violation there would fail a good artifact
// over a false positive, which is a worse failure than missing a rare fabricated
// book name. Wrong chapter/verse on a REAL book — the realistic hallucination —
// is caught by the lookup instead.
const LOOSE_REF_SCAN = /\b(?:[1-3]\s+)?[A-Z][a-zA-Z]+(?:\s+of\s+[A-Z][a-zA-Z]+)?\s+\d{1,3}:\d{1,3}(?:\s*[-–]\s*\d{1,3})?/g;

// Near-miss detection is LENGTH-AWARE, not a flat similarity threshold.
//
// The plan specified "repair at ≥ 0.9 token overlap", calibrated on a 20-word
// verse. Dice similarity is length-dependent: a single wrong word scores 0.95
// in a 20-token verse but 0.889 in a 9-token one — and Psalm 23:1 is 9 tokens.
// A flat 0.9 would therefore REJECT the commonest near-miss there is, burning a
// retry on an artifact one splice could have saved, which is precisely backwards
// from "repair before reject". So the rule is stated directly instead: a quote
// that is trying to be the whole verse (similar length) and gets a small number
// of words wrong is a near-miss.
const NEAR_MISS_LENGTH_RATIO = 0.8;   // below this it is an excerpt, not an attempt at the whole verse
const NEAR_MISS_ERROR_RATE = 0.2;     // and at most this share of the verse's words may differ

// A quote whose words are essentially all drawn from the verse is a faithful
// excerpt: leave it exactly as written. Rewriting it would replace the author's
// chosen fragment with the whole verse.
const FAITHFUL_CONTAINMENT = 0.95;

/**
 * Is this quote an attempt at the whole verse that slipped on a word or two,
 * rather than a deliberate excerpt or an invention? Only a near-miss is repaired.
 */
export function isNearMiss(quote: string, canonical: string): boolean {
  const a = tokens(quote);
  const b = tokens(canonical);
  if (a.length === 0 || b.length === 0) return false;

  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (ratio < NEAR_MISS_LENGTH_RATIO) return false;

  const differing = Math.max(a.length, b.length) - multisetIntersectionSize(a, b);
  return differing <= Math.max(1, Math.round(NEAR_MISS_ERROR_RATE * b.length));
}

export type QuoteVerdict = 'ok' | 'repair' | 'mismatch';

/**
 * The one decision rule for "is this text a faithful rendering of that verse?",
 * shared by the prose scanner and the structured-field check so they can never
 * drift apart.
 *
 * `allowExcerpt` is the difference between the two callers. In prose, quoting
 * half a verse is a legitimate authorial choice and must be left alone. In a
 * structured field (the devotion's scripture.text) the contract is the WHOLE
 * passage, so a truncation is an error worth repairing rather than an excerpt
 * worth preserving.
 */
export function checkQuote(
  quote: string,
  canonical: string,
  opts: { allowExcerpt: boolean },
): QuoteVerdict {
  if (normalizeForMatch(quote) === normalizeForMatch(canonical)) return 'ok';
  if (isNearMiss(quote, canonical)) return 'repair';
  if (tokenContainment(quote, canonical) >= FAITHFUL_CONTAINMENT) {
    return opts.allowExcerpt ? 'ok' : 'repair';
  }
  return 'mismatch';
}

/**
 * Canonical text as the QUOTE target: for a psalm's (or Habakkuk 3's) verse 1,
 * the superscription is stripped, because that is the form the devotion path
 * supplies and shows (buildPassages). Without this, verifyVerseField's
 * whole-verse containment rule reads the stripped body as a truncation and
 * "repairs" the heading straight back onto the reader's card — and a prose
 * repair would splice "A Psalm of David." into the middle of a sentence.
 */
function canonicalBodyFor(ref: string, canonicalText: string): string {
  const first = parseRefToIds(ref)?.[0];
  if (!first) return canonicalText;
  if (/^psa\.\d{1,3}\.1$/.test(first) || first === 'hab.3.1') {
    return stripPsalmSuperscription(canonicalText);
  }
  return canonicalText;
}

export interface ScriptureVerifyResult {
  ok: boolean;
  /** Present only when at least one repair landed. */
  repairedText?: string;
  repairs: Array<{ ref: string; from: string; to: string }>;
  violations: Array<{ family: 'scripture'; rule: 'unresolvable_ref' | 'quote_mismatch'; snippet: string }>;
}

export interface ScriptureVerifyDeps {
  verifyRefs: (refs: string[], translation: string) => Promise<VerseFlag[]>;
}

/**
 * What a pipeline is handed to switch verification on: the lookup plus the
 * translation the artifact was grounded in. Optional at every call site, so a
 * pipeline without it behaves exactly as it did before slice 1d.
 */
export interface ScriptureDeps extends ScriptureVerifyDeps {
  translation: string;
}

// Delegates rather than re-deriving. This used to check display names only,
// while parseRefToIds — the function that decides whether a ref RESOLVES —
// accepted OSIS codes too. So "Heb 11:1" resolved fine and was reported as a
// fabricated citation in the same pass. Caught by the 2026-08-06 study-chat eval.
function isCanonicalBook(book: string): boolean {
  return canonicalBook(book) !== null;
}

function bookOf(ref: string): string {
  return ref.replace(/\s+\d{1,3}:\d{1,3}(?:\s*[-–]\s*\d{1,3})?$/, '');
}

/**
 * Verify every verse quotation and reference in a generated text.
 *
 * Repair before reject (design decision 10): a quote that fuzzy-matches its
 * canonical verse is silently rewritten to the canonical rendering, so the
 * reader is never shown a misquote and an artifact a repair could save is never
 * failed. Only an unresolvable reference or an unmatchable quote becomes a
 * violation for the stricter retry.
 */
export async function verifyArtifactScripture(
  deps: ScriptureVerifyDeps,
  args: { text: string; translation: string },
): Promise<ScriptureVerifyResult> {
  const spans = extractQuotedSpans(args.text);
  const strictRefs = [...args.text.matchAll(new RegExp(REF_SCAN.source, 'gi'))]
    .map((m) => normalizeRefSpacing(m[0]));

  // Quoted attributions to a non-existent book: fabricated citations. Checked
  // against every quoted REGION, not against `spans` — a span requires a real
  // book, which is exactly what a fabricated ref lacks.
  const regions = findQuotedRegions(args.text);
  const fabricated: string[] = [];
  for (const m of args.text.matchAll(LOOSE_REF_SCAN)) {
    const ref = normalizeRefSpacing(m[0]);
    if (isCanonicalBook(bookOf(ref))) continue;
    const at = m.index ?? 0;
    const quoted = regions.some((r) => at >= r.start - LEADING_REF_WINDOW && at <= r.end + TRAILING_REF_WINDOW);
    if (quoted && !fabricated.includes(ref)) fabricated.push(ref);
  }

  const distinctRefs = [...new Set(strictRefs)];
  if (distinctRefs.length === 0 && fabricated.length === 0) {
    return { ok: true, repairs: [], violations: [] };   // nothing to verify, nothing spent
  }

  let flags: VerseFlag[] = [];
  if (distinctRefs.length > 0) {
    try {
      flags = await deps.verifyRefs(distinctRefs, args.translation);
    } catch (err) {
      // Enhancement, never a dependency: a bible_passages outage must not fail
      // an artifact that may be perfectly correct.
      console.error('[scripture-verify] ref lookup failed; skipping verification:', err);
      return { ok: true, repairs: [], violations: [] };
    }
  }

  const violations: ScriptureVerifyResult['violations'] = [];
  const canonicalByRef = new Map<string, string>();
  for (const flag of flags) {
    if (flag.status === 'found' && flag.canonicalText) {
      canonicalByRef.set(flag.ref, canonicalBodyFor(flag.ref, flag.canonicalText));
    }
    else violations.push({ family: 'scripture', rule: 'unresolvable_ref', snippet: flag.ref });
  }
  for (const ref of fabricated) {
    violations.push({ family: 'scripture', rule: 'unresolvable_ref', snippet: ref });
  }

  const repairs: ScriptureVerifyResult['repairs'] = [];
  const splices: Array<{ start: number; end: number; text: string }> = [];

  for (const span of spans) {
    const canonical = canonicalByRef.get(span.ref);
    if (!canonical) continue;    // unresolved refs are already a violation; don't double-report

    const verdict = checkQuote(span.quote, canonical, { allowExcerpt: true });
    if (verdict === 'ok') continue;
    if (verdict === 'repair') {
      repairs.push({ ref: span.ref, from: span.quote, to: canonical });
      splices.push({ start: span.start, end: span.end, text: canonical });
      continue;
    }
    violations.push({ family: 'scripture', rule: 'quote_mismatch', snippet: span.quote });
  }

  // Right-to-left, so each splice leaves the offsets of the ones before it valid.
  let repairedText: string | undefined;
  if (splices.length > 0) {
    repairedText = args.text;
    for (const s of [...splices].sort((a, b) => b.start - a.start)) {
      repairedText = repairedText.slice(0, s.start) + s.text + repairedText.slice(s.end);
    }
  }

  return {
    ok: violations.length === 0,
    ...(repairedText !== undefined ? { repairedText } : {}),
    repairs,
    violations,
  };
}

/**
 * Verify a structured verse field — a ref and its text held side by side, as on
 * the devotion artifact — rather than a quotation embedded in prose.
 *
 * This is the highest-value check in the product: scripture.text is the verse
 * the reader actually sees, and the prose scanner cannot reach it (no quote
 * marks, no adjacent ref).
 */
export async function verifyVerseField(
  deps: ScriptureVerifyDeps,
  args: { ref: string; text: string; translation: string },
): Promise<ScriptureVerifyResult> {
  const ref = args.ref.trim();
  if (ref.length === 0 || args.text.trim().length === 0) {
    return { ok: true, repairs: [], violations: [] };
  }

  let flags: VerseFlag[];
  try {
    flags = await deps.verifyRefs([ref], args.translation);
  } catch (err) {
    console.error('[scripture-verify] verse-field lookup failed; skipping verification:', err);
    return { ok: true, repairs: [], violations: [] };
  }

  // No flag for this ref means verifyVerseRefs SKIPPED it — it could not parse
  // the ref, which is "unverifiable", not "wrong". Only an explicit not_found is
  // a violation. Conflating the two turns a parser gap into a failed artifact,
  // which is precisely what "enhancement, never a dependency" forbids.
  const flag = flags.find((f) => f.ref === ref);
  if (!flag) return { ok: true, repairs: [], violations: [] };

  if (flag.status !== 'found' || !flag.canonicalText) {
    return {
      ok: false,
      repairs: [],
      violations: [{ family: 'scripture', rule: 'unresolvable_ref', snippet: ref }],
    };
  }

  const canonical = canonicalBodyFor(ref, flag.canonicalText);
  const verdict = checkQuote(args.text, canonical, { allowExcerpt: false });
  if (verdict === 'ok') return { ok: true, repairs: [], violations: [] };
  if (verdict === 'repair') {
    return {
      ok: true,
      repairedText: canonical,
      repairs: [{ ref, from: args.text, to: canonical }],
      violations: [],
    };
  }
  return {
    ok: false,
    repairs: [],
    violations: [{ family: 'scripture', rule: 'quote_mismatch', snippet: args.text }],
  };
}

/**
 * The Deno shells' one-liner for switching verification on. Binds the existing
 * bible_passages lookup (which already carries its own BSB versification
 * fallback) to the translation the artifact was grounded in.
 */
export function makeScriptureDeps(
  supabase: Parameters<typeof verifyVerseRefs>[0],
  translation: string,
): ScriptureDeps {
  return {
    translation,
    verifyRefs: (refs, t) => verifyVerseRefs(supabase, refs, t ?? translation),
  };
}
