// src/notepad/study/insights/insight-doors.parity.test.ts
//
// PARITY SUITE, in the shape of `library-voices-query.test.ts` and
// `personalization.iso.test.ts`: the client's door registry is a hand-kept copy
// of the server's, and this compares the two DIRECTLY rather than asserting the
// same literals twice on both sides.
//
// It matters because a drift here breaks nothing loudly. The client reads
// `bible_passage_insight` by `door` and `section`; if either string diverges
// from what the server writes, the query returns nothing, the door reports
// itself uncached, and every reader pays to generate a door already sitting in
// the table. No error, no red test, just a bill.
//
// A test may import across the `src` / `supabase/functions` boundary that
// production code may not — test files are not bundled into the app.
import { describe, it, expect } from 'vitest';
import { INSIGHT_DOOR_VIEWS, PASSAGE_DOOR_VIEW, DEEPER_DOOR_VIEW, PASSAGE_SECTIONS } from './insight-doors';
import { INSIGHT_DOORS } from '../../../../supabase/functions/lamplight-study/insight-doors';
import { passageRefId } from './passage-insight-stream-client';

describe('client door registry ↔ server door registry', () => {
  it('knows the same doors, in the same order', () => {
    expect(INSIGHT_DOOR_VIEWS.map((d) => d.id)).toEqual(INSIGHT_DOORS.map((d) => d.spec.id));
  });

  it.each(INSIGHT_DOORS.map((d) => [d.spec.id, d] as const))(
    'door %s: section keys match the server exactly',
    (_id, server) => {
      const client = INSIGHT_DOOR_VIEWS.find((d) => d.id === server.spec.id);
      expect(client).toBeDefined();
      // Order too, not just membership: the client renders in registry order.
      expect(client!.sections.map((s) => s.key)).toEqual(server.spec.sections.map((s) => s.key));
    },
  );

  it('no section key is shared between doors', () => {
    const all = INSIGHT_DOOR_VIEWS.flatMap((d) => d.sections.map((s) => s.key));
    expect(new Set(all).size).toBe(all.length);
  });

  it('every client section carries a label the server does not know about', () => {
    // The division of labour: keys are contract, labels are presentation.
    for (const d of INSIGHT_DOOR_VIEWS) {
      for (const s of d.sections) expect(s.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('the door ids the migration 061 check constraint admits', () => {
  it('are exactly these two', () => {
    expect(INSIGHT_DOOR_VIEWS.map((d) => d.id)).toEqual(['passage', 'deeper']);
    expect(PASSAGE_DOOR_VIEW.id).toBe('passage');
    expect(DEEPER_DOOR_VIEW.id).toBe('deeper');
  });
});

describe('the cache key, still pinned on the client side', () => {
  // Unchanged by B3, and still the other half of a contract written in two
  // places: the server composes the ref_id that gets WRITTEN, this composes the
  // one that gets READ.
  it('composes chapter and verse refs exactly as the server does', () => {
    expect(passageRefId({ book: 'psa', chapter: 27, verse: null })).toBe('psa.27');
    expect(passageRefId({ book: 'psa', chapter: 27, verse: 4 })).toBe('psa.27.4');
    expect(passageRefId({ book: 'PSA', chapter: 27, verse: null })).toBe('psa.27');
  });
});

describe('B2 compatibility', () => {
  it('PASSAGE_SECTIONS still names Door 1’s four sections', () => {
    expect(PASSAGE_SECTIONS.map((s) => s.key)).toEqual([
      'overview', 'in_chapter', 'chapter_shape', 'reflection',
    ]);
  });
});
