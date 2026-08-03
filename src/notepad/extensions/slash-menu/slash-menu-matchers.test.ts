import { describe, it, expect } from 'vitest';
import { matchSlashBeforeCursor } from './slash-menu-matchers';

describe('matchSlashBeforeCursor', () => {
  it('fires on a bare "/" at the start of a block', () => {
    expect(matchSlashBeforeCursor('/')).toEqual({ from: 0, to: 1, query: '' });
  });

  it('fires on "/" after whitespace, offsets land on the slash', () => {
    expect(matchSlashBeforeCursor('notes /')).toEqual({ from: 6, to: 7, query: '' });
  });

  it('captures the query run after "/"', () => {
    expect(matchSlashBeforeCursor('/head')).toEqual({ from: 0, to: 5, query: 'head' });
    expect(matchSlashBeforeCursor('a /bul')).toEqual({ from: 2, to: 6, query: 'bul' });
  });

  it('allows spaces in the query (multi-word titles)', () => {
    expect(matchSlashBeforeCursor('/bullet list')).toEqual({ from: 0, to: 12, query: 'bullet list' });
  });

  it('does NOT fire mid-word (no boundary before "/")', () => {
    expect(matchSlashBeforeCursor('word/')).toBeNull();
    expect(matchSlashBeforeCursor('http://x')).toBeNull();
  });

  it('anchors to the active slash run when several exist', () => {
    expect(matchSlashBeforeCursor('a /b /c')).toEqual({ from: 5, to: 7, query: 'c' });
  });

  it('cedes "/verse" and "/lookup" to the scripture pickers', () => {
    expect(matchSlashBeforeCursor('/verse')).toBeNull();
    expect(matchSlashBeforeCursor('/verse John 3:16')).toBeNull();
    expect(matchSlashBeforeCursor('/lookup')).toBeNull();
    expect(matchSlashBeforeCursor('/lookup love your enemies')).toBeNull();
  });

  it('cedes case-insensitively', () => {
    expect(matchSlashBeforeCursor('/VERSE ')).toBeNull();
    expect(matchSlashBeforeCursor('/Lookup grace')).toBeNull();
  });

  it('does NOT cede lookalikes that the scripture pickers also ignore', () => {
    // "/versed" and "/lookupx" fail the scripture matchers' word boundary, so
    // they stay in the launcher rather than vanishing into no-man's-land.
    expect(matchSlashBeforeCursor('/versed')).toEqual({ from: 0, to: 7, query: 'versed' });
    expect(matchSlashBeforeCursor('/lookupx')).toEqual({ from: 0, to: 8, query: 'lookupx' });
  });
});
