import { describe, it, expect } from 'vitest';
import { buildContestedIndex, findContestedRefs } from './contested-refs.ts';
import { CONTESTED_PASSAGES } from './voice.ts';

const index = buildContestedIndex(CONTESTED_PASSAGES);

describe('buildContestedIndex', () => {
  it('normalizes verse-level entries to OSIS ids', () => {
    expect(index.verses.has('rom.9.16')).toBe(true);
    expect(index.verses.has('1ti.2.12')).toBe(true);
  });

  it('normalizes chapter-only entries to chapter keys', () => {
    expect(index.chapters.has('rev.13')).toBe(true);
    expect(index.chapters.has('mat.24')).toBe(true);
    expect(index.chapters.has('2th.2')).toBe(true);
  });

  it('reads every configured entry — a silent skip would disable the guard', () => {
    const accounted = CONTESTED_PASSAGES.filter((e) => {
      const hit = findContestedRefs(e, index);
      return hit.length > 0;
    });
    expect(accounted).toHaveLength(CONTESTED_PASSAGES.length);
  });
});

describe('findContestedRefs — the false negative that motivated this', () => {
  // Study chat is instructed to cite the ref it was supplied, and supplied refs
  // are OSIS-coded. The old substring guard never saw these.
  it('catches an OSIS-form verse ref', () => {
    expect(findContestedRefs('Paul says mercy does not depend on effort (rom 9:16).', index))
      .toHaveLength(1);
  });

  it('catches an OSIS-form range that spans contested verses', () => {
    const hits = findContestedRefs('the choice precedes birth (rom 9:11–12)', index);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule).toBe('rom.9.11');
  });

  it('still catches the human-readable form', () => {
    expect(findContestedRefs('as Romans 9:16 puts it', index)).toHaveLength(1);
  });

  it('catches a chapter-level mention in either spelling', () => {
    expect(findContestedRefs('the imagery of Revelation 13', index)).toHaveLength(1);
    expect(findContestedRefs('the imagery of rev 13:1', index)).toHaveLength(1);
  });
});

describe('findContestedRefs — the false positive that came with substring matching', () => {
  it('does not flag 1 Corinthians 11:20, which merely starts like 11:2', () => {
    expect(findContestedRefs('the Lord’s Supper in 1 Corinthians 11:20', index)).toEqual([]);
  });

  it('does not flag an uncontested verse in a partly contested chapter', () => {
    // Romans 9:11-23 is listed; 9:1 is not.
    expect(findContestedRefs('Paul’s anguish for his kinsmen (rom 9:1)', index)).toEqual([]);
  });

  it('does not flag an uncontested book', () => {
    expect(findContestedRefs('as Psalm 27:4 says, and jhn 3:16', index)).toEqual([]);
  });
});

describe('findContestedRefs — shape', () => {
  it('reports the surface form and its position so a snippet can be built', () => {
    const text = 'Consider rom 9:16 closely.';
    const [hit] = findContestedRefs(text, index);
    expect(hit.matched).toBe('rom 9:16');
    expect(text.slice(hit.index, hit.index + hit.matched.length)).toBe('rom 9:16');
  });

  it('reports every occurrence, not just the first', () => {
    expect(findContestedRefs('rom 9:16 … and again Romans 9:18', index)).toHaveLength(2);
  });

  it('ignores a bare book name with no chapter', () => {
    expect(findContestedRefs('the letter to the Romans is long', index)).toEqual([]);
  });
});
