import { describe, it, expect } from 'vitest';
import { parseStudyBody } from './parse-body.ts';

describe('parseStudyBody', () => {
  it('defaults mode to chat, include_notes to false, note_ids to []', () => {
    expect(parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi' })).toEqual({
      ok: true, book: 'jhn', chapter: 10, message: 'hi', mode: 'chat',
      includeNotes: false, noteIds: [], stream: false,
    });
  });
  it('accepts include_notes + note_ids and insight mode', () => {
    expect(parseStudyBody({ book: 'rom', chapter: 8, mode: 'insight', include_notes: true, note_ids: ['n1'] })).toEqual({
      ok: true, book: 'rom', chapter: 8, message: '', mode: 'insight',
      includeNotes: true, noteIds: ['n1'], stream: false,
    });
  });
  it('rejects a missing/invalid passage', () => {
    expect(parseStudyBody({ chapter: 10 }).ok).toBe(false);
    expect(parseStudyBody({ book: 'jhn' }).ok).toBe(false);
  });
  it('rejects an empty chat message', () => {
    expect(parseStudyBody({ book: 'jhn', chapter: 10, message: '   ' }).ok).toBe(false);
  });
});
