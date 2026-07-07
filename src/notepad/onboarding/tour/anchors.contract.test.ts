import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_ANCHOR_TOKENS } from './tour-steps';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');

/** Which component source carries each data-tour token (both viewports, all 9 steps). */
const TOKEN_SOURCES: Record<string, string> = {
  'new-note-sidebar-button': 'src/notepad/components/NotepadToolbar.tsx',
  'editor-page': 'src/notepad/components/Editor.tsx',
  'verse-chip': 'src/notepad/extensions/ScriptureRefView.tsx',
  'editor-bible-panel': 'src/components/sections/notepad/StudyWindow.tsx',
  'highlight-toolbar': 'src/notepad/components/Editor.tsx',
  'studywindow-graph-tab': 'src/components/sections/notepad/StudyWindow.tsx',
  'lamplight-panel-entry': 'src/components/sections/Notepad.tsx',
  'mobile-new-note-fab': 'src/components/sections/notepad/mobile/MobileFabMenu.tsx',
  'mobile-bible-reader': 'src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx',
  'more-sheet-graph': 'src/components/sections/notepad/mobile/MobileMoreSheet.tsx',
  'header-flame': 'src/components/sections/notepad/mobile/HeaderLamplightFlame.tsx',
};

describe('tour anchors contract — step ↔ token lists (drift fails CI)', () => {
  it('desktop tokens, in step order', () => {
    expect(TOUR_ANCHOR_TOKENS.desktop).toEqual([
      null,
      'new-note-sidebar-button',
      'editor-page',
      'verse-chip',
      'editor-bible-panel',
      'highlight-toolbar',
      'studywindow-graph-tab',
      'lamplight-panel-entry',
      null,
    ]);
  });

  it('mobile tokens, in step order', () => {
    expect(TOUR_ANCHOR_TOKENS.mobile).toEqual([
      null,
      'mobile-new-note-fab',
      'editor-page',
      'verse-chip',
      'mobile-bible-reader',
      'highlight-toolbar',
      'more-sheet-graph',
      'header-flame',
      null,
    ]);
  });
});

describe('tour anchor tokens exist in their owning component source', () => {
  it.each(Object.entries(TOKEN_SOURCES))('%s → %s', (token, file) => {
    const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    expect(source, `${file} must carry the ${token} token`).toContain(token);
  });
});
