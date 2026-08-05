// Deterministic validators for Lamplight artifacts. Pure functions; no I/O.
// validateCitations + applyContentRules + flattenArtifactText are all reusable
// across future artifact types (Today's Lamp, Weekly Insight, etc.).

export interface Citation {
  type: 'note' | 'verse';
  ref: string;
}

export interface ArtifactSection {
  heading: string;
  body: string;
  citations: Citation[];
}

export interface ArtifactLike {
  opening?: string;
  sections: ArtifactSection[];
}

export interface CitationViolation {
  section_index: number;
  reason: 'no_citations' | 'unknown_note' | 'unknown_verse';
  detail: string;
}

export interface CitationCheckResult {
  ok: boolean;
  violations: CitationViolation[];
}

export function validateCitations<T extends ArtifactLike>(
  artifact: T,
  allowed: { allowedNoteIds: Set<string>; allowedVerseRefs: Set<string> },
): CitationCheckResult {
  const violations: CitationViolation[] = [];
  const verseRefsLower = new Set<string>();
  for (const r of allowed.allowedVerseRefs) verseRefsLower.add(r.toLowerCase());

  artifact.sections.forEach((section, idx) => {
    if (!section.citations || section.citations.length === 0) {
      violations.push({
        section_index: idx,
        reason: 'no_citations',
        detail: `section "${section.heading}" has no citations`,
      });
      return;
    }
    for (const cite of section.citations) {
      if (cite.type === 'note' && !allowed.allowedNoteIds.has(cite.ref)) {
        violations.push({
          section_index: idx,
          reason: 'unknown_note',
          detail: `cited note "${cite.ref}" is not in the user's context`,
        });
      } else if (cite.type === 'verse' && !verseRefsLower.has(cite.ref.toLowerCase())) {
        violations.push({
          section_index: idx,
          reason: 'unknown_verse',
          detail: `cited verse "${cite.ref}" is not in the retrieved passages`,
        });
      }
    }
  });

  return { ok: violations.length === 0, violations };
}

/**
 * A violation raised by a content validator.
 * Families:
 * - 'banned'    — banned phrase appeared in artifact body.
 * - 'contested' — contested passage cited inappropriately.
 * - 'growth'    — streak/effort-shaming language (Lamplight policy).
 * - 'name'     — first-name misuse (overuse or spurious salutation).
 */
export interface ContentRuleViolation {
  // 'scripture' (slice 1d) rides this same channel deliberately: it is another
  // post-generation text check whose violations feed the same stricter retry,
  // and every pipeline already threads content violations through. Only
  // verification emits it — the doctrinal classifier's allowlist does not.
  family: 'banned' | 'contested' | 'growth' | 'name' | 'scripture';
  rule: string;
  snippet: string;
}

export interface ContentRules {
  banned: RegExp[];
  contested: string[];
  growth: RegExp[];
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
}

export interface ContentRuleResult {
  ok: boolean;
  violations: ContentRuleViolation[];
}

/**
 * Stricter-prompt lines for the banned/contested/growth content families,
 * derived from the families present in `violations`. Returns one line per
 * offending family (the 'name' family is intentionally not handled here — it is
 * artifact-specific and composed by the daily-devotion pipeline). Lifted from
 * two byte-identical copies in the smoke and daily pipelines.
 */
export function formatContentFamilyStricter(violations: ContentRuleViolation[]): string[] {
  const families = new Set(violations.map((v) => v.family));
  const parts: string[] = [];
  if (families.has('banned')) {
    parts.push(
      'On retry: do not produce prophetic, oracular, or "God is telling you" style language. Speak of Scripture in possibility, not pronouncement.',
    );
  }
  if (families.has('contested')) {
    parts.push(
      'On retry: avoid interpreting the contested passages mentioned. Name them gently and defer.',
    );
  }
  if (families.has('scripture')) {
    parts.push(
      'On retry: quote Scripture only in the exact wording supplied to you, and cite only references you were given. Do not reconstruct a verse from memory.',
    );
  }
  if (families.has('growth')) {
    parts.push(
      'On retry: do not use streak / "missed yesterday" / "get back on track" / effort-shaming language.',
    );
  }
  return parts;
}

const SNIPPET_RADIUS = 40; // chars before + after the match

function snippetAround(text: string, start: number, end: number): string {
  const lo = Math.max(0, start - SNIPPET_RADIUS);
  const hi = Math.min(text.length, end + SNIPPET_RADIUS);
  return text.slice(lo, hi);
}

export async function applyContentRules(
  text: string,
  rules: ContentRules,
): Promise<ContentRuleResult> {
  const violations: ContentRuleViolation[] = [];

  for (const re of rules.banned) {
    // Re-create a global-flagged copy so we can find all matches.
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      violations.push({
        family: 'banned',
        rule: re.source,
        snippet: snippetAround(text, m.index, m.index + m[0].length),
      });
      if (m[0].length === 0) global.lastIndex++;
    }
  }

  const textLower = text.toLowerCase();
  for (const ref of rules.contested) {
    const refLower = ref.toLowerCase();
    let i = textLower.indexOf(refLower);
    while (i !== -1) {
      violations.push({
        family: 'contested',
        rule: ref,
        snippet: snippetAround(text, i, i + refLower.length),
      });
      i = textLower.indexOf(refLower, i + refLower.length);
    }
  }

  for (const re of rules.growth) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      violations.push({
        family: 'growth',
        rule: re.source,
        snippet: snippetAround(text, m.index, m.index + m[0].length),
      });
      if (m[0].length === 0) global.lastIndex++;
    }
  }

  if (rules.classifier) {
    const extra = await rules.classifier(text);
    violations.push(...extra);
  }

  return { ok: violations.length === 0, violations };
}

export function flattenArtifactText(artifact: ArtifactLike): string {
  const parts: string[] = [];
  if (artifact.opening) parts.push(artifact.opening);
  for (const s of artifact.sections) {
    parts.push(s.heading);
    parts.push(s.body);
  }
  return parts.join('\n\n');
}

// ── Daily devotion validators (sub-project 4) ──────────────────────────────
// The DailyDevotion shape has scripture{ref,text} + note_citations[] rather
// than the smoke-test artifact's sections[]. Validators are a sibling, not an
// overload, so each artifact type has its own clear shape walker.

import type { DailyDevotion } from './artifacts.ts';

export function validateDailyDevotionCitations(
  artifact: DailyDevotion,
  allowed: { allowedNoteIds: Set<string>; allowedVerseRefs: Set<string> },
): CitationCheckResult {
  const violations: CitationViolation[] = [];
  const verseRefsLower = new Set<string>();
  for (const r of allowed.allowedVerseRefs) verseRefsLower.add(r.toLowerCase());

  if (!verseRefsLower.has(artifact.scripture.ref.toLowerCase())) {
    violations.push({
      section_index: 0,
      reason: 'unknown_verse',
      detail: `anchor verse "${artifact.scripture.ref}" is not in the retrieved passages`,
    });
  }

  if (!artifact.note_citations || artifact.note_citations.length === 0) {
    violations.push({
      section_index: 0,
      reason: 'no_citations',
      detail: 'daily devotion has zero note_citations',
    });
  } else {
    artifact.note_citations.forEach((cite, idx) => {
      if (!allowed.allowedNoteIds.has(cite.note_id)) {
        violations.push({
          section_index: idx,
          reason: 'unknown_note',
          detail: `cited note "${cite.note_id}" is not in the user's context`,
        });
      }
    });
  }

  return { ok: violations.length === 0, violations };
}

export function flattenDailyDevotionText(artifact: DailyDevotion): string {
  return [
    artifact.opening,
    artifact.scripture.text,
    artifact.reflection,
    artifact.prompt,
  ].join('\n\n');
}

export interface ConnectionWhyArtifact {
  why: string;
}

export interface ConnectionShapeViolation {
  rule: 'word_count_exceeded' | 'empty' | 'not_string';
  detail: string;
}

export interface ConnectionShapeResult {
  ok: boolean;
  violations: ConnectionShapeViolation[];
}

export function validateConnectionWhyShape(
  artifact: ConnectionWhyArtifact,
): ConnectionShapeResult {
  const violations: ConnectionShapeViolation[] = [];
  if (typeof artifact?.why !== 'string') {
    violations.push({ rule: 'not_string', detail: 'why is not a string' });
    return { ok: false, violations };
  }
  const trimmed = artifact.why.trim();
  if (trimmed.length === 0) {
    violations.push({ rule: 'empty', detail: 'why is empty after trim' });
  }
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 24) {
    violations.push({
      rule: 'word_count_exceeded',
      detail: `${wordCount} words > 24`,
    });
  }
  return { ok: violations.length === 0, violations };
}

export function flattenConnectionWhyText(artifact: ConnectionWhyArtifact): string {
  return artifact.why;
}

// ── Bible-chat reply validator (Phase 2) ───────────────────────────────────
// Chat replies may carry zero citations (a short clarifying answer), but any
// citation present must resolve to a supplied note id or retrieved verse ref.

export interface ChatReply {
  reply: string;
  citations: Citation[];
}

export function validateChatReplyCitations(
  reply: ChatReply,
  allowed: { allowedNoteIds: Set<string>; allowedVerseRefs: Set<string> },
): CitationCheckResult {
  const violations: CitationViolation[] = [];
  const verseRefsLower = new Set<string>();
  for (const r of allowed.allowedVerseRefs) verseRefsLower.add(r.toLowerCase());

  (reply.citations ?? []).forEach((cite) => {
    if (cite.type === 'note' && !allowed.allowedNoteIds.has(cite.ref)) {
      violations.push({ section_index: 0, reason: 'unknown_note', detail: `cited note "${cite.ref}" is not in the user's context` });
    } else if (cite.type === 'verse' && !verseRefsLower.has(cite.ref.toLowerCase())) {
      violations.push({ section_index: 0, reason: 'unknown_verse', detail: `cited verse "${cite.ref}" is not in the retrieved passages` });
    }
  });

  return { ok: violations.length === 0, violations };
}

// ── Name-use validators (sub-project 8) ────────────────────────────────────
// Cap total artifact mentions at 2 across opening + reflection + prompt.
// When firstName === null, reject openings that start with a vocative
// salutation pattern (model invented or imitated a salutation).

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Unicode-aware word boundaries: \b in JavaScript is ASCII-only and fails to
// boundary names ending in non-ASCII letters (e.g., "José"). Use \p{L}\p{M}
// negative lookarounds with the u flag instead.
export function nameMentionCount(text: string, firstName: string): number {
  const re = new RegExp(
    `(?<![\\p{L}\\p{M}])${escapeRegex(firstName)}(?![\\p{L}\\p{M}])`,
    'gu',
  );
  return text.match(re)?.length ?? 0;
}

// Matches the prescribed shape `<First> — ` and likely-vocative variants.
// Capital letter (ASCII A-Z + Latin-1 supplement uppercase, excluding × U+00D7)
// + 0-40 name-allowed chars + space + em-dash + space.
const SPURIOUS_SALUTATION_RE = /^[A-ZÀ-ÖØ-Ý][\p{L}\p{M}'-]{0,40} — /u;

export interface NameRulesInput {
  artifact: DailyDevotion;
  firstName: string | null;
}

// NOTE: flattenDailyDevotionText includes scripture.text, so a name that
// coincidentally appears inside the quoted verse counts toward the 2-use cap.
// Acceptable for V1; consider excluding scripture.text if false positives emerge.
export function applyNameRules({ artifact, firstName }: NameRulesInput): ContentRuleViolation[] {
  const violations: ContentRuleViolation[] = [];
  if (firstName) {
    const flat = flattenDailyDevotionText(artifact);
    const count = nameMentionCount(flat, firstName);
    if (count > 2) {
      violations.push({
        family: 'name',
        rule: 'name_overuse',
        snippet: `first name "${firstName}" used ${count} times (max 2)`,
      });
    }
  } else {
    if (SPURIOUS_SALUTATION_RE.test(artifact.opening)) {
      violations.push({
        family: 'name',
        rule: 'spurious_salutation',
        snippet: artifact.opening.slice(0, 80),
      });
    }
  }
  return violations;
}
