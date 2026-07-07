import { describe, it, expect } from 'vitest';
import { MONTHLY_REFLECTION_PROMPT, type MonthlyReflectionContext } from './monthly-reflection';
import { MARKER_MIN, MARKER_MAX, MONTHLY_PROMPT_VERSION } from '../../_shared/reflection-constants';

function makeCtx(overrides: Partial<MonthlyReflectionContext> = {}): MonthlyReflectionContext {
  return {
    periodKey: '2026-05',
    periodLabel: 'May 2026',
    monthStart: '2026-05-01',
    monthEnd: '2026-05-31',
    notes: [
      { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' },
      { id: 'n2', day: '2026-05-27', text: 'Early walk, Psalm 27 open again.' },
    ],
    candidates: [
      { ref: 'Ps 27:14', provenance: 'flagged', note_day: '2026-05-12' },
      { ref: 'Ps 27:4', provenance: 'highlighted', note_day: '2026-05-27' },
    ],
    allowedVerseRefs: new Set(['Ps 27:14', 'Ps 27:4']),
    allowedNoteDays: new Set(['2026-05-12', '2026-05-27']),
    ...overrides,
  };
}

describe('MONTHLY_REFLECTION_PROMPT', () => {
  it('is versioned monthly-reflection-v1', () => {
    expect(MONTHLY_REFLECTION_PROMPT.promptVersion).toBe(MONTHLY_PROMPT_VERSION);
    expect(MONTHLY_PROMPT_VERSION).toBe('monthly-reflection-v1');
  });

  it('carries the §5 voice rules verbatim (titles / battles / sparse)', () => {
    const s = MONTHLY_REFLECTION_PROMPT.system;
    expect(s).toContain('underline-worthy, not devotional headers');
    expect(s).toContain('witnessed, not reopened');
    expect(s).toContain('a graceful floor');
    // §6.4 anti-examples are explicit so validators never reject the exemplar
    expect(s).toContain('Psalm 27');       // narrative book/chapter is ALLOWED in prose
    expect(s).toContain('Ps 27:14');       // verse-level citation is FORBIDDEN in prose
    expect(s).toContain('the twelfth');    // spelled-out date is ALLOWED
  });

  it('embeds the §2.2 May-2026 exemplar as the one-shot', () => {
    expect(MONTHLY_REFLECTION_PROMPT.system).toContain('The Month You Stopped Waiting');
    expect(MONTHLY_REFLECTION_PROMPT.system).toContain('the day the circling stopped');
  });

  it('tool schema is strict JSON with 1–6 markers and a nullable verse', () => {
    const schema = MONTHLY_REFLECTION_PROMPT.tool.input_schema as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        markers: { minItems: number; maxItems: number; items: { properties: { verse: { type: string[] } } } };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['title', 'letter', 'markers']);
    expect(schema.properties.markers.minItems).toBe(MARKER_MIN);
    expect(schema.properties.markers.maxItems).toBe(MARKER_MAX);
    expect(schema.properties.markers.items.properties.verse.type).toEqual(['string', 'null']);
  });

  it('buildMessages substitutes period + notes + a verse allowlist', () => {
    const [msg] = MONTHLY_REFLECTION_PROMPT.buildMessages(makeCtx());
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('May 2026');
    expect(msg.content).toContain('[note n1 · 2026-05-12]');
    // The allowlist instruction lists every candidate ref and permits null
    expect(msg.content).toContain('Ps 27:14');
    expect(msg.content).toContain('Ps 27:4');
    expect(msg.content).toMatch(/or null/i);
  });

  it('{{period_label}} is a systemTokens placeholder, not hardcoded', () => {
    expect(MONTHLY_REFLECTION_PROMPT.system).toContain('{{period_label}}');
  });
});
