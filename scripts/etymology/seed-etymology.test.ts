import { describe, it, expect } from 'vitest';
import {
  stripNiqqud,
  extractRootStrongs,
  buildLexicon,
  parseLimit,
  narrateDevelopment,
  type OsHebrewEntry,
} from './seed-etymology';
import { buildGroundingRecord } from './etymology-grounding';

describe('stripNiqqud', () => {
  it('removes Hebrew vowel points to yield the consonantal root', () => {
    expect(stripNiqqud('רָעָה')).toBe('רעה');
  });
  it('leaves already-consonantal text unchanged', () => {
    expect(stripNiqqud('רעה')).toBe('רעה');
  });
});

describe('extractRootStrongs', () => {
  it("returns the referenced Strong's number for a derived word", () => {
    expect(extractRootStrongs('H7473', 'from H7462')).toBe('H7462');
  });
  it('handles "the same as H## (…)" derivations', () => {
    expect(extractRootStrongs('H3', 'from the same as H24 (אָבִיב);')).toBe('H24');
  });
  it('normalizes zero-padded references to the dictionary key form', () => {
    expect(extractRootStrongs('H7473', 'from H07462')).toBe('H7462');
  });
  it('falls back to the word itself for a primitive root', () => {
    expect(extractRootStrongs('H7462', 'a primitive root;')).toBe('H7462');
  });
  it("falls back to the word itself when no Strong's pointer is present", () => {
    expect(extractRootStrongs('H5', 'of foreign origin;')).toBe('H5');
  });
});

describe('buildLexicon', () => {
  const dict: Record<string, OsHebrewEntry> = {
    H7462: { lemma: 'רָעָה', derivation: 'a primitive root', strongs_def: 'to tend, graze', kjv_def: 'feed, shepherd' },
    H7473: { lemma: 'רֹעֶה', derivation: 'from H7462', strongs_def: 'shepherd', kjv_def: 'shepherd' },
  };

  it('resolves a primitive root to its own consonantal lemma with its gloss', () => {
    const lex = buildLexicon(dict);
    expect(lex.H7462).toMatchObject({ root: 'רעה', rootGloss: 'to tend, graze', bdbGloss: 'to tend, graze' });
  });

  it('resolves a derived word to its root word + gloss', () => {
    const lex = buildLexicon(dict);
    expect(lex.H7473.root).toBe('רעה');
    expect(lex.H7473.rootGloss).toBe('to tend, graze');
  });

  it('links same-root family members as related words (excluding self)', () => {
    const lex = buildLexicon(dict);
    expect(lex.H7462.related).toContainEqual({ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' });
    expect(lex.H7462.related.find((r) => r.strongs === 'H7462')).toBeUndefined();
  });

  it('produces entries consumable by buildGroundingRecord', () => {
    const rec = buildGroundingRecord('H7462', buildLexicon(dict));
    expect(rec).toMatchObject({ strongs: 'H7462', root: 'רעה', source: "Strong's + BDB" });
  });
});

describe('parseLimit', () => {
  it('defaults to Infinity when no --limit flag is present', () => {
    expect(parseLimit(['--dry-run'])).toBe(Infinity);
  });
  it('parses a positive integer limit', () => {
    expect(parseLimit(['--dry-run', '--limit=5'])).toBe(5);
  });
  it('throws on a non-numeric value instead of silently seeding everything', () => {
    expect(() => parseLimit(['--limit=abc'])).toThrow(/--limit/);
  });
  it('throws on an empty value', () => {
    expect(() => parseLimit(['--limit='])).toThrow(/--limit/);
  });
  it('throws on zero or a negative value', () => {
    expect(() => parseLimit(['--limit=0'])).toThrow(/--limit/);
    expect(() => parseLimit(['--limit=-3'])).toThrow(/--limit/);
  });
  it('throws on a non-integer value', () => {
    expect(() => parseLimit(['--limit=2.5'])).toThrow(/--limit/);
  });
});

describe('narrateDevelopment (retry on 429)', () => {
  const dict: Record<string, OsHebrewEntry> = {
    H7462: { lemma: 'רָעָה', derivation: 'a primitive root', strongs_def: 'to tend, graze', kjv_def: 'feed' },
  };
  const toolResponse = {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          tool_calls: [{
            type: 'function',
            function: {
              name: 'emit_development',
              arguments: JSON.stringify({ body: 'Formed from the root, meaning to tend.' }),
            },
          }],
        },
      }],
    }),
    text: async () => '',
  } as unknown as Response;

  it('retries after a 429 (rate limit) and returns the narration', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) {
        return { ok: false, status: 429, text: async () => 'rate limited', json: async () => ({}) } as unknown as Response;
      }
      return toolResponse;
    }) as unknown as typeof fetch;

    const rec = buildGroundingRecord('H7462', buildLexicon(dict));
    const body = await narrateDevelopment(rec, 'key', fetchImpl, {
      sleepImpl: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    expect(body).toBe('Formed from the root, meaning to tend.');
    expect(calls).toBe(2);
    expect(sleeps).toHaveLength(1);
  });

  it('throws on a non-retryable error status', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 400, text: async () => 'bad request', json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const rec = buildGroundingRecord('H7462', buildLexicon(dict));
    await expect(
      narrateDevelopment(rec, 'key', fetchImpl, { sleepImpl: async () => {} }),
    ).rejects.toThrow(/openai 400/);
  });
});
