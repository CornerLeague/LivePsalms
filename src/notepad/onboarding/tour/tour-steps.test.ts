import { describe, expect, it, vi } from 'vitest';
import type { TourRunContext } from './tour-engine';
import { TOUR_ANCHOR_TOKENS, TOUR_STEPS } from './tour-steps';

function makeCtx(viewport: 'desktop' | 'mobile', sampleNoteId: string | null = null): TourRunContext {
  return { viewport, sampleNoteId };
}

describe('TOUR_STEPS', () => {
  it('has the eleven approved moments in order', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      'welcome',
      'create-note',
      'sample-page',
      'verse-links',
      'bible-beside',
      'highlights',
      'decorations',
      'graph-map',
      'study',
      'lamplight',
      'make-it-yours',
    ]);
  });

  it('uses the approved copy verbatim (spot checks)', () => {
    expect(TOUR_STEPS[0].copy.title).toBe('The first page is open.');
    expect(TOUR_STEPS[0].copy.body).toBe(
      'A one-minute walk through your study space. Skip anytime — it will keep.',
    );
    expect(TOUR_STEPS[3].copy.body).toBe(
      'Type /verse to drop in a passage by reference, or /lookup to find one by the words you remember. Tap any verse to read it in place.',
    );
    expect(TOUR_STEPS[6].copy.title).toBe('Decorate the page.');
    expect(TOUR_STEPS[6].copy.body).toBe(
      'Drop in stickers, shapes, and marks to make a page feel like yours.',
    );
    expect(TOUR_STEPS[7].copy.body).toBe(
      'As notes link to verses and to each other, a map takes shape — showing how God pieces your story together.',
    );
    expect(TOUR_STEPS[8].copy.title).toBe('Go deeper in Study.');
    expect(TOUR_STEPS[8].copy.body).toBe(
      'Flip to Study for close reading — the original Hebrew and Greek behind each verse, word-by-word meanings, and the roots underneath.',
    );
    expect(TOUR_STEPS[9].copy.title).toBe('Meet Lamplight. 🕯');
    expect(TOUR_STEPS[9].copy.body).toBe(
      'A companion for the mid-reading questions, your journey reflections, scripture study plans, and much more.',
    );
    expect(TOUR_STEPS[10].copy.body).toBe(
      'A free account keeps your notes on every device — and lights Lamplight for the road ahead.',
    );
  });

  it('bible-beside is the only step with per-viewport body copy', () => {
    const dual = TOUR_STEPS.filter((step) => typeof step.copy.body !== 'string');
    expect(dual.map((step) => step.id)).toEqual(['bible-beside']);
  });

  it('exposes the per-viewport anchor token lists', () => {
    expect(TOUR_ANCHOR_TOKENS.desktop).toEqual([
      null,
      'new-note-sidebar-button',
      'editor-page',
      'verse-chip',
      'editor-bible-panel',
      'editor-page',
      'decoration-tray',
      'studywindow-graph-tab',
      'study-toggle',
      'lamplight-panel-entry',
      null,
    ]);
    expect(TOUR_ANCHOR_TOKENS.mobile).toEqual([
      null,
      'mobile-new-note-fab',
      'editor-page',
      'verse-chip',
      'mobile-bible-reader',
      'editor-page',
      'decoration-tray',
      'more-sheet-graph',
      'study-toggle',
      'header-flame',
      null,
    ]);
  });

  describe('prepare actions (registry-only, idempotent)', () => {
    it('step 1 mobile switches to the notes tab; desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[1].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('notes');
      mobileSetTab.mockClear();
      await TOUR_STEPS[1].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('step 2 creates the sample note once, caches the id, and reuses it after', async () => {
      const createSampleNote = vi.fn(async () => 'sample-1');
      const openNote = vi.fn();
      const ctx = makeCtx('desktop');
      await TOUR_STEPS[2].prepare?.({ createSampleNote, openNote }, ctx);
      expect(createSampleNote).toHaveBeenCalledTimes(1);
      expect(ctx.sampleNoteId).toBe('sample-1');
      await TOUR_STEPS[2].prepare?.({ createSampleNote, openNote }, ctx);
      expect(createSampleNote).toHaveBeenCalledTimes(1);
      expect(openNote).toHaveBeenCalledWith('sample-1');
    });

    it('steps 2, 3, 5 activate the desktop content tab so the editor anchors mount', async () => {
      for (const index of [2, 3, 5]) {
        const openNote = vi.fn();
        const desktopSetActiveTab = vi.fn();
        await TOUR_STEPS[index].prepare?.({ openNote, desktopSetActiveTab }, makeCtx('desktop', 'sample-1'));
        expect(desktopSetActiveTab).toHaveBeenCalledWith('content');
      }
    });

    it('steps 3 and 5 ensure the sample note on mobile (openNote + editor tab)', async () => {
      for (const index of [3, 5]) {
        const openNote = vi.fn();
        const mobileSetTab = vi.fn();
        await TOUR_STEPS[index].prepare?.({ openNote, mobileSetTab }, makeCtx('mobile', 'sample-1'));
        expect(openNote).toHaveBeenCalledWith('sample-1');
        expect(mobileSetTab).toHaveBeenCalledWith('editor');
      }
    });

    it('step 4 desktop opens the study pane on Bible; mobile switches tabs', async () => {
      const desktopSetGraphOpen = vi.fn();
      const desktopSetStudyTab = vi.fn();
      await TOUR_STEPS[4].prepare?.({ desktopSetGraphOpen, desktopSetStudyTab }, makeCtx('desktop'));
      expect(desktopSetGraphOpen).toHaveBeenCalledWith(true);
      expect(desktopSetStudyTab).toHaveBeenCalledWith('bible');
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[4].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('bible');
    });

    it('step 6 (decorations) ensures the note then opens the decoration tray', async () => {
      const openNote = vi.fn();
      const desktopSetActiveTab = vi.fn();
      const openDecorationTray = vi.fn();
      await TOUR_STEPS[6].prepare?.(
        { openNote, desktopSetActiveTab, openDecorationTray },
        makeCtx('desktop', 'sample-1'),
      );
      expect(desktopSetActiveTab).toHaveBeenCalledWith('content');
      expect(openDecorationTray).toHaveBeenCalledWith(true);
      const mobileSetTab = vi.fn();
      const openDecorationTray2 = vi.fn();
      await TOUR_STEPS[6].prepare?.(
        { openNote: vi.fn(), mobileSetTab, openDecorationTray: openDecorationTray2 },
        makeCtx('mobile', 'sample-1'),
      );
      expect(mobileSetTab).toHaveBeenCalledWith('editor');
      expect(openDecorationTray2).toHaveBeenCalledWith(true);
    });

    it('step 7 desktop shows the Graph tab (and closes the decoration tray); mobile opens the More sheet on Graph', async () => {
      const desktopSetGraphOpen = vi.fn();
      const desktopSetStudyTab = vi.fn();
      const openDecorationTray = vi.fn();
      await TOUR_STEPS[7].prepare?.(
        { desktopSetGraphOpen, desktopSetStudyTab, openDecorationTray },
        makeCtx('desktop'),
      );
      expect(openDecorationTray).toHaveBeenCalledWith(false);
      expect(desktopSetGraphOpen).toHaveBeenCalledWith(true);
      expect(desktopSetStudyTab).toHaveBeenCalledWith('graph');
      const mobileOpenMoreSheet = vi.fn();
      await TOUR_STEPS[7].prepare?.({ mobileOpenMoreSheet }, makeCtx('mobile'));
      expect(mobileOpenMoreSheet).toHaveBeenCalledWith('graph');
    });

    it('step 8 (study) switches to the Notes tab on mobile so the header toggle shows; desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[8].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('notes');
      mobileSetTab.mockClear();
      await TOUR_STEPS[8].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('step 9 mobile returns to the editor tab (closes the More sheet); desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[9].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('editor');
      mobileSetTab.mockClear();
      await TOUR_STEPS[9].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('steps 0 and 10 are centered with no prepare', () => {
      expect(TOUR_STEPS[0].anchor('desktop')).toBeNull();
      expect(TOUR_STEPS[0].prepare).toBeUndefined();
      expect(TOUR_STEPS[10].anchor('mobile')).toBeNull();
      expect(TOUR_STEPS[10].prepare).toBeUndefined();
    });
  });
});
