import { describe, it, expect } from 'vitest';
import { formatVerseRef, formatDisplayVerseRef, buildPassages, fetchPassageText, stripPsalmSuperscription, superscriptionApplies, type BiblePassageRow } from './bible-passage';
import { parseRefToIds } from './verse-verify';
import type { RetrievedItem } from './retrieval';

// Fake supabase: returns KJV for jhn.3.16 only; BSB for both ids.
function fakeSupabase() {
  return {
    from() {
      return {
        select() { return this; },
        eq(_col: string, val: string) { (this as Record<string, unknown>)._t = val; return this; },
        in(_col: string, ids: string[]) { (this as Record<string, unknown>)._ids = ids; return this; },
        then(res: (v: unknown) => void) {
          const t = (this as Record<string, string>)._t;
          const ids = (this as Record<string, string[]>)._ids;
          const rows = ids
            .filter((id) => (t === 'KJV' ? id === 'jhn.3.16' : true))
            .map((id) => ({ id, text: `${t}:${id}`, book: 'jhn', chapter: 3, verse_start: 16, verse_end: 16 }));
          res({ data: rows, error: null });
          return this;
        },
      };
    },
  };
}

function makeRow(over: Partial<BiblePassageRow> = {}): BiblePassageRow {
  return {
    id: 'p1',
    book: 'Psalm',
    chapter: 23,
    verse_start: 4,
    verse_end: 4,
    text: 'Even though I walk through the valley…',
    ...over,
  };
}

function makeRetrieved(over: Partial<RetrievedItem> = {}): RetrievedItem {
  return {
    id: 'r1',
    source_id: 'p1',
    chunk_index: 0,
    chunk_text: 'chunk',
    similarity: 0.9,
    metadata: {},
    ...over,
  };
}

describe('fetchPassageText fallback', () => {
  it('uses the chosen translation, falling back to BSB per-id', async () => {
    const byId = await fetchPassageText(fakeSupabase() as never, ['jhn.3.16', 'jhn.3.17'], 'KJV');
    expect(byId.get('jhn.3.16')?.text).toBe('KJV:jhn.3.16');
    expect(byId.get('jhn.3.17')?.text).toBe('BSB:jhn.3.17'); // fell back
  });
});

describe('formatVerseRef', () => {
  it('formats a single-verse reference as Book C:V', () => {
    expect(formatVerseRef({ book: 'Psalm', chapter: 23, verse_start: 4, verse_end: 4 })).toBe('Psalm 23:4');
  });

  it('formats a multi-verse range as Book C:Vs-Ve', () => {
    expect(formatVerseRef({ book: 'Romans', chapter: 8, verse_start: 28, verse_end: 30 })).toBe('Romans 8:28-30');
  });
});

describe('buildPassages', () => {
  it('joins a retrieved item to its row, with rerank_score present', () => {
    const rows = [makeRow()];
    const retrieved = [makeRetrieved({ similarity: 0.91, rerank_score: 0.77 })];
    const out = buildPassages(rows, retrieved);
    expect(out).toEqual([
      {
        source_id: 'p1',
        text: 'Even though I walk through the valley…',
        ref: 'Psalm 23:4',
        metadata: { book: 'Psalm', chapter: 23, similarity: 0.91, rerank_score: 0.77 },
      },
    ]);
  });

  it('carries rerank_score as undefined when absent', () => {
    const out = buildPassages([makeRow()], [makeRetrieved()]);
    expect(out).toHaveLength(1);
    expect(out[0].metadata).toEqual({ book: 'Psalm', chapter: 23, similarity: 0.9, rerank_score: undefined });
    expect('rerank_score' in (out[0].metadata as Record<string, unknown>)).toBe(true);
  });

  it('produces a range ref when verse_start !== verse_end', () => {
    const rows = [makeRow({ verse_start: 4, verse_end: 6 })];
    const out = buildPassages(rows, [makeRetrieved()]);
    expect(out[0].ref).toBe('Psalm 23:4-6');
  });

  it('skips a retrieved item whose source_id is missing from the rows', () => {
    const rows = [makeRow({ id: 'p1' })];
    const retrieved = [
      makeRetrieved({ source_id: 'p1' }),
      makeRetrieved({ id: 'r2', source_id: 'missing' }),
    ];
    const out = buildPassages(rows, retrieved);
    expect(out).toHaveLength(1);
    expect(out[0].source_id).toBe('p1');
  });

  it('returns an empty array for empty inputs', () => {
    expect(buildPassages([], [])).toEqual([]);
    expect(buildPassages([makeRow()], [])).toEqual([]);
  });

  it('orders output by the retrieved array, not the rows', () => {
    const rows = [
      makeRow({ id: 'a', book: 'Genesis', chapter: 1, verse_start: 1, verse_end: 1 }),
      makeRow({ id: 'b', book: 'Exodus', chapter: 2, verse_start: 2, verse_end: 2 }),
    ];
    const retrieved = [
      makeRetrieved({ id: 'rb', source_id: 'b' }),
      makeRetrieved({ id: 'ra', source_id: 'a' }),
    ];
    const out = buildPassages(rows, retrieved);
    expect(out.map(p => p.source_id)).toEqual(['b', 'a']);
  });
});

// ── Devotion refs are DISPLAY refs ───────────────────────────────────────────
// bible_passages.book holds the OSIS code, so formatVerseRef yields "psa 23:4".
// That string was going into the devotion's allowlist, into the prompt, into the
// model's scripture.ref, and onto the reader's card — and the eval baseline
// caught the model echoing it into the reflection prose too ("The image in
// psa 16:6…"). buildPassages feeds the devotion path exclusively, so this is the
// seam where the devotion gets human refs without touching study or chat.

describe('formatDisplayVerseRef', () => {
  it('renders the full book name for an OSIS code', () => {
    expect(formatDisplayVerseRef({ book: 'psa', chapter: 23, verse_start: 4, verse_end: 4 }))
      .toBe('Psalms 23:4');
  });

  it('renders a range', () => {
    expect(formatDisplayVerseRef({ book: 'psa', chapter: 23, verse_start: 4, verse_end: 6 }))
      .toBe('Psalms 23:4-6');
  });

  it('handles numbered books', () => {
    expect(formatDisplayVerseRef({ book: '1jn', chapter: 4, verse_start: 8, verse_end: 8 }))
      .toBe('1 John 4:8');
  });

  it('falls back to the raw book value for an unknown code rather than rendering blank', () => {
    expect(formatDisplayVerseRef({ book: 'John', chapter: 3, verse_start: 16, verse_end: 16 }))
      .toBe('John 3:16');
  });
});

describe('buildPassages — display refs', () => {
  const retrieved = [
    { id: 'e1', source_id: 'psa.23.4', chunk_index: 0, chunk_text: 'x', similarity: 0.9, metadata: {} },
  ];
  const rows = [
    { id: 'psa.23.4', book: 'psa', chapter: 23, verse_start: 4, verse_end: 4, text: 'Even though I walk…' },
  ];

  it('gives the devotion a human ref, not the raw OSIS code', () => {
    expect(buildPassages(rows, retrieved)[0].ref).toBe('Psalms 23:4');
  });

  it('LOAD-BEARING: the ref it produces parses back to the same verse id', () => {
    // The allowlist ref must be verifiable. When it was "psa 23:4" the shared
    // parser could not read it, so Scripture verification silently skipped every
    // devotion — the bug the first live eval run surfaced.
    const ref = buildPassages(rows, retrieved)[0].ref;
    expect(parseRefToIds(ref)).toEqual(['psa.23.4']);
  });
});

// ── Psalm superscriptions (slice-1d carry-out) ───────────────────────────────
// BSB/KJV/WEB fuse the editorial superscription into verse 1's text, so the
// devotion card led with "For the choirmaster. A Psalm of David." instead of
// the verse. Every fixture string below is the REAL bible_passages row text.

describe('stripPsalmSuperscription', () => {
  const strip = stripPsalmSuperscription;

  it('strips a simple BSB heading', () => {
    expect(strip('A Psalm of David. The LORD is my shepherd; I shall not want.'))
      .toBe('The LORD is my shepherd; I shall not want.');
  });

  it('strips a stacked BSB heading', () => {
    expect(strip('For the choirmaster. A Psalm of David. How long, O LORD? Will You forget me forever?'))
      .toBe('How long, O LORD? Will You forget me forever?');
  });

  it('strips a tune-name heading with curly quotes', () => {
    expect(strip('For the choirmaster. To the tune of “The Doe of the Dawn.” A Psalm of David. My God, my God, why have You forsaken me?'))
      .toBe('My God, my God, why have You forsaken me?');
  });

  it('strips a narrative sentence only after an authorship lead (BSB Ps 51)', () => {
    expect(strip('For the choirmaster. A Psalm of David. When Nathan the prophet came to him after his adultery with Bathsheba. Have mercy on me, O God.'))
      .toBe('Have mercy on me, O God.');
  });

  it('strips a narrative with quoted speech inside (BSB Ps 52)', () => {
    expect(strip('For the choirmaster. A Maskil of David. After Doeg the Edomite went to Saul and told him, “David has gone to the house of Ahimelech.” Why do you boast of evil, O mighty man?'))
      .toBe('Why do you boast of evil, O mighty man?');
  });

  it('THE TRAP: keeps a body that starts with "When" after a non-authorship lead (Ps 126)', () => {
    expect(strip('A song of ascents. When the LORD restored the captives of Zion, we were like dreamers.'))
      .toBe('When the LORD restored the captives of Zion, we were like dreamers.');
  });

  it('keeps a body that starts with "When" when there is no heading at all (Ps 114)', () => {
    const text = 'When Israel departed from Egypt, the house of Jacob from a people of foreign tongue,';
    expect(strip(text)).toBe(text);
  });

  it('strips the "He said:" hinge (BSB Ps 18)', () => {
    expect(strip('For the choirmaster. Of David the servant of the LORD, who sang this song to the LORD on the day the LORD had delivered him from the hand of all his enemies and from the hand of Saul. He said: I love You, O LORD, my strength.'))
      .toBe('I love You, O LORD, my strength.');
  });

  it('strips the KJV comma-joined form with brackets and "And he said," (KJV Ps 18)', () => {
    expect(strip('To the chief Musician, [A Psalm] of David, the servant of the LORD, who spake unto the LORD the words of this song in the day [that] the LORD delivered him from the hand of all his enemies, and from the hand of Saul: And he said, I will love thee, O LORD, my strength.'))
      .toBe('I will love thee, O LORD, my strength.');
  });

  it('strips a bracket-leading KJV heading with an inline narrative (KJV Ps 34)', () => {
    expect(strip('[A Psalm] of David, when he changed his behaviour before Abimelech; who drove him away, and he departed. I will bless the LORD at all times: his praise [shall] continually [be] in my mouth.'))
      .toBe('I will bless the LORD at all times: his praise [shall] continually [be] in my mouth.');
  });

  it('strips WEB "By" attributions without touching Ps 137\'s "By the rivers" body', () => {
    expect(strip('For the Chief Musician. By the sons of Korah. According to Alamoth. God is our refuge and strength, a very present help in trouble.'))
      .toBe('God is our refuge and strength, a very present help in trouble.');
    const rivers = 'By the rivers of Babylon, there we sat down. Yes, we wept, when we remembered Zion.';
    expect(strip(rivers)).toBe(rivers);
  });

  it('strips WEB instrument and contemplation forms', () => {
    expect(strip('For the Chief Musician. For a stringed instrument. By David. Hear my cry, God. Listen to my prayer.'))
      .toBe('Hear my cry, God. Listen to my prayer.');
    expect(strip('A contemplation by David, when he was in the cave. A Prayer. I cry with my voice to the LORD. With my voice, I ask the LORD for mercy.'))
      .toBe('I cry with my voice to the LORD. With my voice, I ask the LORD for mercy.');
  });

  it('strips the KJV Maschil/semicolon form (KJV Ps 142)', () => {
    expect(strip('Maschil of David; A Prayer when he was in the cave. I cried unto the LORD with my voice; with my voice unto the LORD did I make my supplication.'))
      .toBe('I cried unto the LORD with my voice; with my voice unto the LORD did I make my supplication.');
  });

  it('stops at a body that opens with a colon clause (BSB Ps 110)', () => {
    expect(strip('A Psalm of David. The LORD said to my Lord: “Sit at My right hand until I make Your enemies a footstool for Your feet.”'))
      .toBe('The LORD said to my Lord: “Sit at My right hand until I make Your enemies a footstool for Your feet.”');
  });

  it('leaves psalms without a superscription untouched', () => {
    for (const body of [
      'Blessed is the man who does not walk in the counsel of the wicked, or set foot on the path of sinners.',
      'Hallelujah! Praise God in His sanctuary. Praise Him in His mighty heavens.',
      'He who dwells in the shelter of the Most High will abide in the shadow of the Almighty.',
    ]) expect(strip(body)).toBe(body);
  });

  it('strips Habakkuk 3:1 in all three renderings', () => {
    expect(strip('A prayer of Habakkuk the prophet, according to Shigionoth. O LORD, I have heard the report of You.'))
      .toBe('O LORD, I have heard the report of You.');
    expect(strip('A prayer of Habakkuk, the prophet, set to victorious music. LORD, I have heard of your fame.'))
      .toBe('LORD, I have heard of your fame.');
  });

  it('handles the five shapes the 453-row audit initially missed', () => {
    // KJV Ps 54: the heading's quoted question ends with '?', not '.'.
    expect(strip('To the chief Musician on Neginoth, Maschil, [A Psalm] of David, when the Ziphims came and said to Saul, Doth not David hide himself with us? Save me, O God, by thy name, and judge me by thy strength.'))
      .toBe('Save me, O God, by thy name, and judge me by thy strength.');
    // KJV Ps 145: possessive form.
    expect(strip('David’s [Psalm] of praise. I will extol thee, my God, O king; and I will bless thy name for ever and ever.'))
      .toBe('I will extol thee, my God, O king; and I will bless thy name for ever and ever.');
    // WEB Ps 7 / 16 / 145: meditation, Poem, praise psalm.
    expect(strip('A meditation by David, which he sang to the LORD, concerning the words of Cush, the Benjamite. LORD, my God, I take refuge in you. Save me from all those who pursue me, and deliver me,'))
      .toBe('LORD, my God, I take refuge in you. Save me from all those who pursue me, and deliver me,');
    expect(strip('A Poem by David. Preserve me, God, for I take refuge in you.'))
      .toBe('Preserve me, God, for I take refuge in you.');
    expect(strip('A praise psalm by David. I will exalt you, my God, the King. I will praise your name forever and ever.'))
      .toBe('I will exalt you, my God, the King. I will praise your name forever and ever.');
  });

  it('never strips a text down to nothing', () => {
    expect(strip('A Psalm of David.')).toBe('A Psalm of David.');
    // Habakkuk 3:1 IS entirely the heading in all three translations — the
    // verse row must come through whole rather than be emptied.
    expect(strip('This is a prayer of Habakkuk the prophet, according to Shigionoth:'))
      .toBe('This is a prayer of Habakkuk the prophet, according to Shigionoth:');
    expect(strip('A prayer of Habakkuk the prophet upon Shigionoth.'))
      .toBe('A prayer of Habakkuk the prophet upon Shigionoth.');
  });
});

describe('superscriptionApplies', () => {
  it('applies to psalm verse-1 rows and pericopes, and to Habakkuk 3', () => {
    expect(superscriptionApplies({ book: 'psa', chapter: 13, verse_start: 1 })).toBe(true);
    expect(superscriptionApplies({ book: 'psa', chapter: 13, verse_start: 1, verse_end: 6 } as never)).toBe(true);
    expect(superscriptionApplies({ book: 'hab', chapter: 3, verse_start: 1 })).toBe(true);
  });

  it('does not apply elsewhere', () => {
    expect(superscriptionApplies({ book: 'psa', chapter: 13, verse_start: 2 })).toBe(false);
    expect(superscriptionApplies({ book: 'jhn', chapter: 3, verse_start: 1 })).toBe(false);
    expect(superscriptionApplies({ book: 'hab', chapter: 2, verse_start: 1 })).toBe(false);
  });
});

describe('buildPassages — superscriptions', () => {
  it('hands the devotion the verse BODY for a titled psalm', () => {
    const rows = [{ id: 'psa.13.1', book: 'psa', chapter: 13, verse_start: 1, verse_end: 1, text: 'For the choirmaster. A Psalm of David. How long, O LORD? Will You forget me forever?' }];
    const retrieved = [{ id: 'e1', source_id: 'psa.13.1', chunk_index: 0, chunk_text: 'x', similarity: 0.9, metadata: {} }];
    expect(buildPassages(rows, retrieved)[0].text).toBe('How long, O LORD? Will You forget me forever?');
  });

  it('leaves non-verse-1 psalm rows and other books alone', () => {
    const rows = [
      { id: 'psa.23.4', book: 'psa', chapter: 23, verse_start: 4, verse_end: 4, text: 'Even though I walk…' },
      { id: 'jhn.3.16', book: 'jhn', chapter: 3, verse_start: 16, verse_end: 16, text: 'For God so loved the world…' },
    ];
    const retrieved = rows.map((r, i) => ({ id: `e${i}`, source_id: r.id, chunk_index: 0, chunk_text: 'x', similarity: 0.9, metadata: {} }));
    expect(buildPassages(rows, retrieved).map((p) => p.text)).toEqual(['Even though I walk…', 'For God so loved the world…']);
  });
});
