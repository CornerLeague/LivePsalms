import { describe, expect, it, vi } from 'vitest';
import type { TourRunContext } from './tour-engine';
import { TOUR_ANCHOR_TOKENS, TOUR_STEPS } from './tour-steps';

function makeCtx(viewport: 'desktop' | 'mobile', sampleNoteId: string | null = null): TourRunContext {
  return { viewport, sampleNoteId };
}

describe('TOUR_STEPS', () => {
  it('has the nine approved moments in order (locked decision 2)', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      'welcome',
      'create-note',
      'sample-page',
      'verse-links',
      'bible-beside',
      'highlights',
      'graph-map',
      'lamplight',
      'make-it-yours',
    ]);
  });

  it('uses the approved copy verbatim (spot checks from spec §5)', () => {
    expect(TOUR_STEPS[0].copy.title).toBe('The first page is open.');
    expect(TOUR_STEPS[0].copy.body).toBe(
      'A one-minute walk through your study space. Skip anytime — it will keep.',
    );
    expect(TOUR_STEPS[2].copy.body).toBe(
      "Here's a sample study, opened so you can see the page at work. Write the way you think — the page keeps up.",
    );
    expect(TOUR_STEPS[7].copy.title).toBe('Meet Lamplight. 🕯');
    expect(TOUR_STEPS[8].copy.body).toBe(
      'A free account keeps your notes on every device — and lights Lamplight for the road ahead.',
    );
  });

  it('step 4 is the only step with per-viewport body copy', () => {
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
      'highlight-toolbar',
      'studywindow-graph-tab',
      'lamplight-panel-entry',
      null,
    ]);
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

    it('step 2 mobile switches to the editor tab only after the note is open', async () => {
      const calls: string[] = [];
      const controls = {
        createSampleNote: vi.fn(async () => {
          calls.push('create');
          return 'sample-1';
        }),
        mobileSetTab: vi.fn(() => {
          calls.push('tab');
        }),
      };
      await TOUR_STEPS[2].prepare?.(controls, makeCtx('mobile'));
      expect(calls).toEqual(['create', 'tab']);
      expect(controls.mobileSetTab).toHaveBeenCalledWith('editor');
    });

    it('steps 3 and 5 also ensure the sample note (Back-safe)', async () => {
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

    it('step 6 desktop shows the Graph tab; mobile opens the More sheet on Graph', async () => {
      const desktopSetGraphOpen = vi.fn();
      const desktopSetStudyTab = vi.fn();
      await TOUR_STEPS[6].prepare?.({ desktopSetGraphOpen, desktopSetStudyTab }, makeCtx('desktop'));
      expect(desktopSetGraphOpen).toHaveBeenCalledWith(true);
      expect(desktopSetStudyTab).toHaveBeenCalledWith('graph');
      const mobileOpenMoreSheet = vi.fn();
      await TOUR_STEPS[6].prepare?.({ mobileOpenMoreSheet }, makeCtx('mobile'));
      expect(mobileOpenMoreSheet).toHaveBeenCalledWith('graph');
    });

    it('step 7 mobile returns to the editor tab (closes the More sheet); desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[7].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('editor');
      mobileSetTab.mockClear();
      await TOUR_STEPS[7].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('steps 0 and 8 are centered with no prepare', () => {
      expect(TOUR_STEPS[0].anchor('desktop')).toBeNull();
      expect(TOUR_STEPS[0].prepare).toBeUndefined();
      expect(TOUR_STEPS[8].anchor('mobile')).toBeNull();
      expect(TOUR_STEPS[8].prepare).toBeUndefined();
    });
  });
});
