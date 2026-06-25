import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Walk src/ and assert no file outside prefs/ or *.test.* calls the raw hooks.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('Bible prefs single-instance invariant', () => {
  it('useBibleTranslation/useBibleVerseLayout are called only inside prefs/ (and their hook files)', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      if (file.includes('/bible/prefs/')) continue;
      if (file.endsWith('useBibleTranslation.ts')) continue;
      if (file.endsWith('useBibleVerseLayout.ts')) continue;
      if (/\.test\.(ts|tsx)$/.test(file)) continue;
      const src = readFileSync(file, 'utf8');
      if (/useBibleTranslation\s*\(/.test(src) || /useBibleVerseLayout\s*\(/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
