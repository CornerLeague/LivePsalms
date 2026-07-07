import type { TourRunContext, TourStep, TourViewport } from './tour-engine';
import type { WorkspaceControls } from './workspace-controller';

// The nine tour moments (spec §3; copy §5 verbatim). Pure data: anchors are
// per-viewport data-tour tokens; prepare actions drive the app exclusively
// through the WorkspaceController registry (locked decision 1).

async function ensureSampleNoteOpen(
  controls: Readonly<WorkspaceControls>,
  ctx: TourRunContext,
): Promise<void> {
  if (ctx.sampleNoteId === null) {
    ctx.sampleNoteId = (await controls.createSampleNote?.()) ?? null;
  } else {
    controls.openNote?.(ctx.sampleNoteId);
  }
  // Mobile: the editor tab only sticks once a note is active (effectiveTab
  // guard in MobileNotepadWorkspace), so switch tabs after opening.
  if (ctx.viewport === 'mobile') controls.mobileSetTab?.('editor');
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    placement: 'center',
    copy: {
      title: 'The first page is open.',
      body: 'A one-minute walk through your study space. Skip anytime — it will keep.',
    },
    anchor: () => null,
  },
  {
    id: 'create-note',
    placement: { desktop: 'right', mobile: 'top' },
    copy: {
      title: 'Every study starts here.',
      body: 'Notes, devotions, sermons — each one begins behind this button.',
    },
    anchor: (viewport) =>
      viewport === 'desktop' ? 'new-note-sidebar-button' : 'mobile-new-note-fab',
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'mobile') controls.mobileSetTab?.('notes');
    },
  },
  {
    id: 'sample-page',
    placement: 'bottom',
    copy: {
      title: 'The page is yours.',
      body: "Here's a sample study, opened so you can see the page at work. Write the way you think — the page keeps up.",
    },
    anchor: () => 'editor-page',
    prepare: ensureSampleNoteOpen,
  },
  {
    id: 'verse-links',
    placement: 'bottom',
    copy: {
      title: 'Verses become living links.',
      body: 'Type /verse and the passage drops right into your note. Tap one to read it in place.',
    },
    anchor: () => 'verse-chip',
    prepare: ensureSampleNoteOpen,
  },
  {
    id: 'bible-beside',
    placement: { desktop: 'left', mobile: 'top' },
    copy: {
      title: 'Scripture beside your page.',
      body: {
        desktop: 'Read and write side by side. The Bible stays open next to your note.',
        mobile: 'The whole Bible, one tab away from your note.',
      },
    },
    anchor: (viewport) => (viewport === 'desktop' ? 'editor-bible-panel' : 'mobile-bible-reader'),
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'desktop') {
        controls.desktopSetGraphOpen?.(true);
        controls.desktopSetStudyTab?.('bible');
      } else {
        controls.mobileSetTab?.('bible');
      }
    },
  },
  {
    id: 'highlights',
    placement: { desktop: 'bottom', mobile: 'top' },
    copy: {
      title: 'Mark what speaks to you.',
      body: 'Highlight in textures that read like real ink.',
    },
    anchor: () => 'highlight-toolbar',
    // "Return to editor" (spec §3): mobile switches back to the editor tab;
    // desktop is a no-op beyond reusing the still-open sample note.
    prepare: ensureSampleNoteOpen,
  },
  {
    id: 'graph-map',
    placement: { desktop: 'left', mobile: 'top' },
    copy: {
      title: 'Your notebook becomes a map.',
      body: 'As notes link to verses and to each other, a map takes shape — of what God keeps drawing you toward.',
    },
    anchor: (viewport) => (viewport === 'desktop' ? 'studywindow-graph-tab' : 'more-sheet-graph'),
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'desktop') {
        controls.desktopSetGraphOpen?.(true);
        controls.desktopSetStudyTab?.('graph');
      } else {
        controls.mobileOpenMoreSheet?.('graph');
      }
    },
  },
  {
    id: 'lamplight',
    placement: { desktop: 'left', mobile: 'bottom' },
    copy: {
      title: 'Meet Lamplight. 🕯',
      body: 'A companion for the mid-reading question. Ask what a verse means, where a thread leads, what to study next.',
    },
    anchor: (viewport) => (viewport === 'desktop' ? 'lamplight-panel-entry' : 'header-flame'),
    // Spec §3 lists "none"; on mobile the More sheet from step 6 covers the
    // header flame, so returning to the editor tab (which closes the sheet,
    // mirroring handleSelectTab) is a mechanical necessity per §6 — not a
    // product fork. Desktop stays a true no-op.
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'mobile') controls.mobileSetTab?.('editor');
    },
  },
  {
    id: 'make-it-yours',
    placement: 'center',
    copy: {
      title: 'Make it yours.',
      body: 'A free account keeps your notes on every device — and lights Lamplight for the road ahead.',
    },
    anchor: () => null,
  },
];

/** Per-viewport anchor-token lists locked by the anchors contract test. */
export const TOUR_ANCHOR_TOKENS: Record<TourViewport, Array<string | null>> = {
  desktop: TOUR_STEPS.map((step) => step.anchor('desktop')),
  mobile: TOUR_STEPS.map((step) => step.anchor('mobile')),
};
