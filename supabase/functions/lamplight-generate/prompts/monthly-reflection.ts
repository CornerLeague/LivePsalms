// Monthly reflection ("letter") prompt — Waymarks. Composes UNDER
// LAMPLIGHT_SYSTEM_FRAGMENT via composeSystem (generateWithRetry bakes in the
// base voice fragment; `system` below is the artifact stance only).
// promptVersion is persisted on lamplight_artifacts.prompt_version.
//
// Deliberate inversion vs daily-devotion.ts: this prompt OWNS the input-contract
// types so Task 2 compiles before the pipeline (Task 6) exists.

import { MARKER_MIN, MARKER_MAX, MONTHLY_PROMPT_VERSION } from '../../_shared/reflection-constants.ts';

// ── Input contract (consumed by the candidate builder, Task 4, and the pipeline, Task 6) ──
export interface MonthNote {
  id: string;
  day: string;   // notes.created_at bucketed to a local YYYY-MM-DD day
  text: string;  // plaintext extracted from notes.content
}

export type CandidateProvenance =
  | 'flagged' | 'highlighted' | 'studied' | 'focus_listed' | 'semantic';

export interface ReflectionCandidate {
  ref: string;                    // display ref, e.g. "Ps 27:14"
  provenance: CandidateProvenance;
  note_day?: string;              // the month's-own-trail day this ref was touched (null for 'semantic')
}

export interface MonthlyReflectionContext {
  periodKey: string;              // 'YYYY-MM'
  periodLabel: string;            // 'May 2026'
  monthStart: string;             // ISO YYYY-MM-DD (local month bounds)
  monthEnd: string;               // ISO YYYY-MM-DD
  notes: MonthNote[];
  candidates: ReflectionCandidate[];   // deduped, provenance-tagged (~8–12)
  allowedVerseRefs: Set<string>;       // the allowlist (validator 2 + prompt instruction)
  allowedNoteDays: Set<string>;        // source-note created_at days (validator 3 anchoring)
}

export const MONTHLY_REFLECTION_PROMPT = {
  promptVersion: MONTHLY_PROMPT_VERSION,

  system: `Compose a monthly reflection for someone who journals — Lamplight reading back the month just lived and returning it as a letter. You receive the month's notes (each tagged with the day it was written) and, for scripture, a candidate list of verse references the reader actually touched that month plus a few semantic neighbours. Write for {{period_label}}.

Voice rules (these are the product — hold them exactly):
- Titles: underline-worthy, not devotional headers. Aim for something a person would want to keep. A month might come back as "The Month You Stopped Waiting" or "Small Faithfulness." Never generic, never a sermon title.
- Battles: witnessed, not reopened. When you surface a hard season, name that the season happened and that the reader wrote their way through it. Do not recount the painful detail, quote the darkest lines back, or re-narrate the wound. The register is a hand on the shoulder, not a replay. Mark the stone and move on.
- Sparse periods: a graceful floor. When someone barely wrote, shift from "here is your arc" to "here is what you kept coming back to say." Honor the little that was written and never count the gaps. Never a scorecard of how often they showed up. A single honest entry can be the whole stone.

The letter:
- Second person; reads whole and uninterrupted; 60–350 words.
- No numerals that tally the reader's activity (no "you wrote 14 days", no counts, no streak language). Spelled-out dates like "on the twelfth" are fine.
- No verse-level citations in the prose. You MAY name a book or chapter narratively — "Psalm 27 open again and again" is welcome — but a verse-level reference like "Ps 27:14" belongs ONLY in a marker, never in the letter.

The markers (${MARKER_MIN}–${MARKER_MAX}):
- Each marks a moment: a turning point, a win, a battle, a thread, or a pivot.
- Each carries a date (or a start+end span for something like a hard week), at most ONE verse chosen from the supplied candidate list — or null when no verse fits (abstention is welcome, never forced) — and a short phrase in your own words. The phrase is your naming of the moment, never a quote copied from the notes.
- A verse you place in a marker MUST be one of the supplied candidate references exactly, or null.

One-shot register exemplar — this is the standard to match (May 2026):
Title: "The Month You Stopped Waiting"
Letter:
"You began May circling a decision you had been holding since March. On the twelfth the circling stopped — that entry doesn't argue with itself; it simply asks to be led, and then goes quiet.
The middle of the month held a hard week. You know which one. You wrote through it rather than around it, and the writing held you. The stone stands; the details can rest.
And a small thing you almost didn't record: the early walks, Psalm 27 open again and again. You kept returning without calling it returning. That thread is what this month was made of."
Markers:
- 2026-05-12 · Ps 27:14 · "the day the circling stopped"
- 2026-05-17 to 2026-05-23 · Ps 34:18 · "a hard week, witnessed"
- 2026-05-27 · Ps 27:4 · "the walk you kept taking"

Notice in the exemplar: the hard week is pointed at, never replayed ("You know which one… the details can rest"); the prose says "Psalm 27" narratively while the verse-level refs (Ps 27:14, Ps 34:18, Ps 27:4) live only in the markers; "the twelfth" is spelled out, not written as a count.

Output strictly as the emit_monthly_reflection tool: { title, letter, markers }.`,

  tool: {
    name: 'emit_monthly_reflection',
    description: 'Return the monthly reflection artifact JSON.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'letter', 'markers'],
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 80 },
        letter: { type: 'string', minLength: 1 }, // word bounds enforced by validator 1, not char count
        markers: {
          type: 'array',
          minItems: MARKER_MIN,
          maxItems: MARKER_MAX,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'verse', 'phrase'],
            properties: {
              date: { type: 'string', description: 'ISO YYYY-MM-DD within the month.' },
              date_end: { type: 'string', description: 'Optional ISO YYYY-MM-DD end of a span.' },
              verse: {
                type: ['string', 'null'],
                description: 'Exactly one reference from the supplied candidate list, or null to abstain.',
              },
              phrase: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
    },
  },

  buildMessages(ctx: MonthlyReflectionContext): Array<{ role: 'user'; content: string }> {
    const notesBlock = ctx.notes
      .map((n) => `[note ${n.id} · ${n.day}]\n${n.text}`)
      .join('\n\n');
    const candidatesBlock = ctx.candidates
      .map((c) => `- ${c.ref} (${c.provenance}${c.note_day ? `, ${c.note_day}` : ''})`)
      .join('\n');
    const refsList = [...ctx.allowedVerseRefs].join(', ');
    return [{
      role: 'user',
      content:
        `Month: ${ctx.periodLabel} (${ctx.monthStart} to ${ctx.monthEnd}).\n\n` +
        `The month's notes:\n${notesBlock}\n\n` +
        `Candidate verses (month's-own-trail entries outrank semantic ones when register fits):\n${candidatesBlock}\n\n` +
        `Each marker's verse must be exactly one of: ${refsList} — or null.\n\n` +
        `Write the reflection for ${ctx.periodLabel} now.`,
    }];
  },
} as const;
