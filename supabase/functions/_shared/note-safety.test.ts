import { describe, it, expect } from 'vitest';
import { isWithheldFromGeneration, partitionBySafety, type NoteSafetyRow } from './note-safety.ts';

// One predicate, three call sites. The whole point of putting it here is that
// "what counts as withheld" is answered once — the gate sites do not each get
// to have an opinion.
describe('isWithheldFromGeneration', () => {
  it('withholds a note classified as risk', () => {
    expect(isWithheldFromGeneration({ safety_class: 'risk' })).toBe(true);
  });

  it('⚠️ withholds an UNCLASSIFIED note, exactly as it withholds risk', () => {
    // The asymmetry argued in design §1.2, as a test rather than a comment.
    // Excluding a pending note costs a slightly less current devotion.
    // Including one costs precisely what this layer exists to prevent.
    expect(isWithheldFromGeneration(undefined)).toBe(true);
    expect(isWithheldFromGeneration(null)).toBe(true);
    expect(isWithheldFromGeneration({ safety_class: null })).toBe(true);
  });

  it('allows ok', () => {
    expect(isWithheldFromGeneration({ safety_class: 'ok' })).toBe(false);
  });

  it('⚠️ allows LAMENT — the app exists for this', () => {
    // Lament is the app functioning, not a failure state. It is recorded
    // separately from `ok` only so the false-positive rate is countable; it
    // must never change what the reader gets.
    expect(isWithheldFromGeneration({ safety_class: 'lament' })).toBe(false);
  });

  it('treats an unrecognised class as withheld', () => {
    // A value the check constraint should have refused. If one ever appears,
    // fail closed rather than guess.
    expect(isWithheldFromGeneration({ safety_class: 'weird' as NoteSafetyRow['safety_class'] })).toBe(true);
  });
});

describe('partitionBySafety', () => {
  const rows: NoteSafetyRow[] = [
    { note_id: 'a', safety_class: 'ok' },
    { note_id: 'b', safety_class: 'risk' },
    { note_id: 'c', safety_class: 'lament' },
    { note_id: 'd', safety_class: null },
  ];

  it('keeps ok and lament, drops risk and unclassified', () => {
    const { kept, withheld } = partitionBySafety(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      rows,
      (n) => n.id,
    );
    expect(kept.map((n) => n.id)).toEqual(['a', 'c']);
    expect(withheld.map((n) => n.id)).toEqual(['b', 'd']);
  });

  it('withholds a note with NO row at all', () => {
    // The common case in practice: the classification job has not run yet.
    const { kept, withheld } = partitionBySafety([{ id: 'unseen' }], [], (n) => n.id);
    expect(kept).toEqual([]);
    expect(withheld.map((n) => n.id)).toEqual(['unseen']);
  });

  it('returns withheld ids so callers can over-fetch and top up', () => {
    // The study path ranks BEFORE it fetches bodies, so it needs to know how
    // many slots it lost — otherwise a withheld note silently costs a shown
    // one. See note-safety's doc comment.
    const { withheld } = partitionBySafety([{ id: 'b' }], rows, (n) => n.id);
    expect(withheld).toHaveLength(1);
  });

  it('is empty-safe at both ends', () => {
    expect(partitionBySafety([], rows, (n: { id: string }) => n.id).kept).toEqual([]);
    expect(partitionBySafety([{ id: 'a' }], [], (n) => n.id).kept).toEqual([]);
  });
});
