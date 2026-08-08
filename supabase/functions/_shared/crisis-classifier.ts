// supabase/functions/_shared/crisis-classifier.ts
//
// Stage two of two, and the only stage that makes a judgement.
//
// ⚠️ THIS FAILS CLOSED. `makeDoctrinalClassifier` — whose shape this otherwise
// borrows — fails OPEN on purpose, because the availability of generation must
// never hinge on a second model call succeeding. Inverting that here is
// deliberate: a classifier that waved every note through whenever the model was
// unreachable would be a silent hole in the one layer that exists to have none.
// Anyone reusing that module as a template must flip this consciously.
//
// Its ENTIRE job is one distinction: lament versus risk. Not "is this person
// sad", not "is this negative" — those questions have obvious answers on the
// Psalter and the wrong ones.
//
// ⚠️ ON UNCERTAINTY, IT CHOOSES `risk` — AND THAT DEPENDS ON THE COPY.
//
// Choosing risk when unsure is only tolerable because the response is an OFFER,
// not an assertion: Woebot's confirm-then-resource protocol, which asks whether
// it would help to see somewhere to talk rather than telling someone what they
// are. Under that copy a false positive is a gentle, declinable door.
//
// If the copy is ever written as a statement about the reader — "it sounds like
// you are in crisis" — then this policy must invert, because a false positive
// stops being a door and becomes a misdiagnosis handed to a grieving person.
// **The uncertainty policy and the response copy are one decision in two
// files.** Task 8 owns the copy; whoever writes it owns this line too.

import type { LLMAdapter, ToolSchema } from './openai.ts';
import type { SafetyClass } from './note-safety.ts';

export const CRISIS_CLASSIFIER_VERSION = 'crisis-2026-08-07-v1';

const MAX_TEXT_CHARS = 6000;

const CLASSIFIER_SYSTEM = `You read one journal entry from a Christian journaling app and place it in exactly one of three classes. This is your only job.

- risk: the writer indicates risk to themselves. Stated intent to end their life; a plan; preparation (putting affairs in order, giving possessions away, saying goodbyes, an unexplained calm after a period of despair); seeking means; or current self-harm.
- lament: real pain brought into words, and not risk to self. Grief, despair, doubt, exhaustion, anger at God, protest, hopelessness about circumstances, faith, work or a relationship. Wishing one had never been born. Wanting a situation to end. Wanting to escape a job, a role, or a place.
- ok: none of the above is present.

CRITICAL — this app exists for people writing their worst days, and its tradition is the Psalter. Biblical lament is the app working, not a warning sign. Psalm 88 ends in darkness with no resolution. Job curses the day of his birth. These are prayers, and their modern equivalents are lament, not risk.

Phrases that are NOT risk on their own, because they carry ordinary non-risk meanings:
- "I don't want to be here" — most often grief: not wanting to be in a world the person who died is absent from.
- "I can't keep doing this" / "I can't go on" — most often a job, a role, or a season.
- "I want to disappear" — most often wanting to leave a situation, not a life.
- "I wish I had never been born" — protest and grief; this is Job 3.
Classify these as risk ONLY when the entry also carries intent, a plan, preparation, or means directed at ending the writer's life.

When you genuinely cannot tell lament from risk, answer risk. A reader is then offered somewhere to talk, which they may decline; that is a smaller harm than missing someone.

Answer with the classify_entry tool. Give a short plain reason naming the specific signal you used.`;

const CLASSIFIER_TOOL: ToolSchema = {
  name: 'classify_entry',
  description: 'Place the journal entry in exactly one safety class.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['safety_class', 'reason'],
    properties: {
      safety_class: { type: 'string', enum: ['ok', 'lament', 'risk'] },
      reason: { type: 'string', maxLength: 200 },
    },
  },
};

export interface CrisisVerdict {
  safety_class: SafetyClass;
  reason: string;
  classifier_version: string;
  /**
   * True when `risk` was returned because the classifier could not answer, not
   * because it judged the entry risky.
   *
   * Kept distinct so a model outage is never read as a spike in real risk —
   * the two would otherwise be indistinguishable in the data, and the second
   * is the number this whole slice exists to watch.
   */
  failedClosed: boolean;
}

const VALID = new Set<SafetyClass>(['ok', 'lament', 'risk']);

function closed(reason: string): CrisisVerdict {
  return { safety_class: 'risk', reason, classifier_version: CRISIS_CLASSIFIER_VERSION, failedClosed: true };
}

export function makeCrisisClassifier(llm: LLMAdapter): (text: string) => Promise<CrisisVerdict> {
  return async (text: string): Promise<CrisisVerdict> => {
    // Nothing written cannot be anything. Withholding every blank note would
    // cost model calls and buy nothing.
    if (!text.trim()) {
      return { safety_class: 'ok', reason: 'empty', classifier_version: CRISIS_CLASSIFIER_VERSION, failedClosed: false };
    }

    try {
      const { parsed } = await llm.generate<{ safety_class?: string; reason?: string }>({
        model: 'fast',
        system: CLASSIFIER_SYSTEM,
        messages: [{ role: 'user', content: `Journal entry:\n${text.slice(0, MAX_TEXT_CHARS)}` }],
        tool: CLASSIFIER_TOOL,
        maxTokens: 256,
      });

      const cls = parsed?.safety_class;
      if (typeof cls !== 'string' || !VALID.has(cls as SafetyClass)) {
        return closed('classifier returned no usable class');
      }
      return {
        safety_class: cls as SafetyClass,
        reason: (parsed.reason ?? '').slice(0, 200),
        classifier_version: CRISIS_CLASSIFIER_VERSION,
        failedClosed: false,
      };
    } catch (err) {
      console.error('[crisis-classifier] failed closed', err);
      return closed('classifier unavailable');
    }
  };
}
