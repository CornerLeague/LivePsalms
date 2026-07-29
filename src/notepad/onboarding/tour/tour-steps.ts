import type { TourRunContext, TourStep, TourViewport } from './tour-engine';
import type { WorkspaceControls } from './workspace-controller';

// The twelve tour moments (spec §3; copy §5 verbatim). Pure data: anchors are
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
  // guard in MobileNotepadWorkspace), so switch tabs after opening. Desktop:
  // activeTab is session-persisted, so a returning user whose last tab was
  // backlinks/info/lamplight would have the editor (and its data-tour
  // anchors) unmounted on replay — force the content tab to keep it mounted.
  if (ctx.viewport === 'mobile') controls.mobileSetTab?.('editor');
  else controls.desktopSetActiveTab?.('content');
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
      body: 'Type /verse to drop in a passage by reference, or /lookup to find one by the words you remember. Tap any verse to read it in place.',
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
    anchor: () => 'editor-page',
    // "Return to editor" (spec §3): mobile switches back to the editor tab;
    // desktop is a no-op beyond reusing the still-open sample note.
    prepare: ensureSampleNoteOpen,
  },
  {
    id: 'decorations',
    placement: { desktop: 'top', mobile: 'top' },
    copy: {
      title: 'Decorate the page.',
      body: 'Drop in stickers, shapes, and marks to make a page feel like yours.',
    },
    anchor: () => 'decoration-tray',
    // Open the decorations tray (idempotent note-ensure first, so the editor is
    // mounted and the tray has a note to attach to), then reveal it.
    prepare: async (controls, ctx) => {
      await ensureSampleNoteOpen(controls, ctx);
      // openDecorationTray registers on Editor mount (Editor.tsx) and is deleted
      // on unmount. After a 768px viewport remount the new Editor's mount effect
      // may not have re-registered it yet, so the imperative open would silently
      // no-op and the decoration-tray anchor would never render (resolver then
      // times out → the step is skipped). Poll the live registry briefly for the
      // control; the anchor resolver's own ~2s budget covers the tray render once
      // it fires. Normal forward flow exits at i=0 (control already present).
      for (let i = 0; i < 20 && !controls.openDecorationTray; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      controls.openDecorationTray?.(true);
    },
  },
  {
    id: 'appearance',
    placement: 'bottom',
    copy: {
      title: 'Pick your palette.',
      body: "Open this menu to choose the notebook's colors — a shelf of palettes from Soft Sand to Abyssal Teal. The little moon nearby turns the lights down.",
    },
    anchor: () => 'notes-menu-trigger',
    // Leaving decorations: close the tray so the spotlight moves to a tidy
    // header. Mobile returns to the editor tab — its header carries the menu
    // trigger, and setting a tab also closes the More sheet when arriving via
    // Back from graph-map (mirroring handleSelectTab). Desktop toolbar is
    // always mounted, so no further driving is needed.
    prepare: (controls, ctx) => {
      controls.openDecorationTray?.(false);
      if (ctx.viewport === 'mobile') controls.mobileSetTab?.('editor');
    },
  },
  {
    id: 'graph-map',
    placement: { desktop: 'left', mobile: 'top' },
    copy: {
      title: 'Your notebook becomes a map.',
      body: 'As notes link to verses and to each other, a map takes shape — showing how God pieces your story together.',
    },
    anchor: (viewport) => (viewport === 'desktop' ? 'studywindow-graph-tab' : 'more-sheet-graph'),
    prepare: (controls, ctx) => {
      // Redundant in the forward flow (appearance closes it), but kept so the
      // tray never lingers if the appearance step is ever skipped or removed.
      controls.openDecorationTray?.(false);
      if (ctx.viewport === 'desktop') {
        controls.desktopSetGraphOpen?.(true);
        controls.desktopSetStudyTab?.('graph');
      } else {
        controls.mobileOpenMoreSheet?.('graph');
      }
    },
  },
  {
    id: 'study',
    placement: { desktop: 'bottom', mobile: 'bottom' },
    copy: {
      title: 'Go deeper in Study.',
      body: 'Flip to Study for close reading — the original Hebrew and Greek behind each verse, word-by-word meanings, and the roots underneath.',
    },
    anchor: () => 'study-toggle',
    // Point + describe only — the tour never enters Study (that route unmounts
    // the tour host). Mobile switches to the Notes tab so the header toggle is
    // on-screen — MobileNotepadWorkspace hides the StudyModeToggle on the editor
    // tab; desktop toggle is always in the header.
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'mobile') controls.mobileSetTab?.('notes');
    },
  },
  {
    id: 'lamplight',
    placement: { desktop: 'left', mobile: 'bottom' },
    copy: {
      title: 'Meet Lamplight. 🕯',
      body: 'A companion for the mid-reading questions, your journey reflections, scripture study plans, and much more.',
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
