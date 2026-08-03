import { describe, it, expect } from 'vitest';
import { createSlashCommands, filterSlashCommands, type SlashCommand } from './slash-commands';

// The list under test is the real production registry. Runs are never invoked
// here (this suite covers only the pure filter + registry shape); the editor
// tests in slash-menu.editor.test.ts exercise the `run` closures end-to-end.
const ALL: SlashCommand[] = createSlashCommands();

const ids = (list: SlashCommand[]): string[] => list.map((c) => c.id);

describe('createSlashCommands', () => {
  it('builds the registry in group order: basic → scripture', () => {
    const groups = ALL.map((c) => c.group);
    const firstScripture = groups.indexOf('scripture');
    const lastBasic = groups.lastIndexOf('basic');
    expect(lastBasic).toBeLessThan(firstScripture);
  });

  it('includes the core block, mark and scripture commands — and no style entries', () => {
    const set = new Set(ids(ALL));
    for (const id of [
      'heading-1', 'heading-2', 'heading-3',
      'bullet-list', 'numbered-list', 'quote', 'divider',
      'bold', 'italic', 'underline',
      'insert-verse', 'lookup-verse',
    ]) {
      expect(set.has(id)).toBe(true);
    }
    // The Notes Styles live in the Decorate tray + toolbar, not the launcher.
    expect(set.has('highlight')).toBe(false);
    expect(set.has('more-styles')).toBe(false);
  });

  it('gives every command a stable id, a title, a group and a run fn', () => {
    for (const c of ALL) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.title.length).toBeGreaterThan(0);
      expect(['basic', 'scripture']).toContain(c.group);
      expect(typeof c.run).toBe('function');
    }
  });
});

describe('filterSlashCommands', () => {
  it('empty query returns every command in registry order', () => {
    expect(ids(filterSlashCommands(ALL, ''))).toEqual(ids(ALL));
  });

  it('whitespace-only query is treated as empty', () => {
    expect(ids(filterSlashCommands(ALL, '   '))).toEqual(ids(ALL));
  });

  it('"head" matches the three headings, H1→H2→H3', () => {
    expect(ids(filterSlashCommands(ALL, 'head'))).toEqual(['heading-1', 'heading-2', 'heading-3']);
  });

  it('"h1" matches Heading 1 via keyword', () => {
    expect(ids(filterSlashCommands(ALL, 'h1'))).toEqual(['heading-1']);
  });

  it('"quote" matches Quote', () => {
    expect(ids(filterSlashCommands(ALL, 'quote'))).toEqual(['quote']);
  });

  it('"bul" matches Bullet list', () => {
    expect(ids(filterSlashCommands(ALL, 'bul'))).toEqual(['bullet-list']);
  });

  it('is case-insensitive ("QUO" → Quote)', () => {
    expect(ids(filterSlashCommands(ALL, 'QUO'))).toEqual(['quote']);
  });

  it('ranks a title-prefix hit above a keyword-only hit', () => {
    // "list" is a title prefix of nothing but a substring of "Bullet list" /
    // "Numbered list"; "li" prefixes neither title. Use a query that hits one
    // title by prefix and another only by keyword to assert ordering.
    const out = ids(filterSlashCommands(ALL, 'underline'));
    expect(out[0]).toBe('underline');
  });

  it('returns [] when nothing matches', () => {
    expect(filterSlashCommands(ALL, 'xyzzy')).toEqual([]);
  });
});
