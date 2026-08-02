// @vitest-environment jsdom
//
// Task 5 — reproduces the desktop-only sample-note hydration bug: the tour's
// `createSampleNote` workspace control (registered by NotepadOnboardingOverlay
// in this file's subject, Notepad.tsx) creates + seeds the tour's sample note,
// but on desktop the editor is ALREADY mounted on the default `content` tab
// when this runs. Before the fix, `useNoteEditor`'s active-note hydrate effect
// (keyed on `activeNote?.id` only, by design — see use-note-editor.ts) never
// re-runs after `createSampleNote` writes real content into the SAME
// (already-active, freshly-created-empty) note id, so the editor keeps
// rendering the empty document it hydrated at creation time. See
// .superpowers/sdd/task-5-brief.md for the full write-up and browser evidence.
//
// This test asserts on the EDITOR'S RENDERED DOM (the real @tiptap/react
// EditorContent output + the title textarea), not on collection/data state —
// a data-only assertion (e.g. activeNote.content) already passes with the bug
// present, because the note's stored data is correct; only the mounted
// editor's view is stale.
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no Range.getClientRects, which real-browser ProseMirror relies on
// to scroll the caret into view on focus (EditorView.scrollToSelection, hit by
// the editor's `editor.commands.focus('start')` re-hydrate call). Stub it —
// same spirit as the ResizeObserver stub other Editor tests already use for a
// different missing jsdom API — so re-hydrating a real (non-empty) document
// doesn't throw. Geometry is irrelevant to this test; only rendered text is.
const zeroRect = (): DOMRect => ({
  bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0,
  toJSON() { return this; },
});
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = function getClientRects() {
    return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
  };
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = zeroRect;
}

// --- Mocks: peripheral/heavy dependencies unrelated to the hydration bug ---
// (Supabase-backed hooks already no-op safely when `@/lib/supabase`'s client is
// null, which it is in this test env — matches the existing precedent in
// MobileNotepadWorkspace.test.tsx, which mocks the same shape of dependencies.)

// jsdom has no ResizeObserver; DecorationLayer needs it. Decorations are
// unrelated to this bug, so stub the layer out instead of polyfilling.
vi.mock('@/notepad/decorations/DecorationLayer', () => ({ DecorationLayer: () => null }));
vi.mock('@/notepad/recordings/RecordingsStrip', () => ({ RecordingsStrip: () => null }));
vi.mock('@/notepad/recordings/RecordingsDock', () => ({ RecordingsDock: () => null }));
vi.mock('@/notepad/components/SearchDialog', () => ({ SearchDialog: () => null }));
vi.mock('@/notepad/components/MigrationDialog', () => ({ MigrationDialog: () => null }));
vi.mock('@/notepad/first-load/useNotepadFirstLoad', () => ({
  useNotepadFirstLoad: () => ({ showMigration: false, dismissMigration: vi.fn() }),
}));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({
    user: null,
    loading: false,
    adapter: undefined,
    session: { signOut: vi.fn() },
  }),
}));
vi.mock('@/auth/context/useAccountProfile', () => ({ useAccountProfile: () => ({ profile: null }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('./notepad/mobile/MobileNotepadWorkspace', () => ({
  MobileNotepadWorkspace: () => <div data-testid="mobile-shell" />,
}));
vi.mock('./notepad/StudyWindow', () => ({ StudyWindow: () => null }));
// Onboarding checklist/tour UI is irrelevant here and would auto-start the real
// tour engine (which itself calls createSampleNote) — stub it out so this test
// exercises ONLY NotepadOnboardingOverlay's control registration + the editor.
vi.mock('@/notepad/onboarding/OnboardingProvider', () => ({
  OnboardingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/notepad/onboarding/OnboardingSurfaces', () => ({ OnboardingSurfaces: () => null }));
// Header tour-replay button reads OnboardingContext; the provider above is a
// pass-through stub (no context value), so render it inert here.
vi.mock('@/notepad/onboarding/TourReplayButton', () => ({ TourReplayButton: () => null }));

import { NotepadProvider } from '@/notepad/context/NotepadProvider';
import { BiblePrefsProvider } from '@/notepad/bible/prefs/BiblePrefsProvider';
import { ThemeContext, type ThemeContextValue } from '@/notepad/theme/theme-context';
import { FakeStorageAdapter, resetFakeAdapterIds } from '@/notepad/collection/fake-storage-adapter';
import { getWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';
import { TOUR_SAMPLE_NOTE_TITLE } from '@/notepad/onboarding/guided-note/guided-note-template';
import { NotepadWorkspace } from './Notepad';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  resetFakeAdapterIds();
});

const themeValue: ThemeContextValue = { theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() };

function renderDesktopWorkspace() {
  const adapter = new FakeStorageAdapter();
  const utils = render(
    <MemoryRouter>
      <ThemeContext.Provider value={themeValue}>
        <NotepadProvider adapter={adapter}>
          <BiblePrefsProvider>
            <NotepadWorkspace />
          </BiblePrefsProvider>
        </NotepadProvider>
      </ThemeContext.Provider>
    </MemoryRouter>,
  );
  return { ...utils, adapter };
}

function editorBodyText(container: HTMLElement): string {
  return container.querySelector('.ProseMirror')?.textContent ?? '';
}

function titleValue(container: HTMLElement): string {
  const el = container.querySelector('textarea[placeholder="Untitled"]') as HTMLTextAreaElement | null;
  return el?.value ?? '';
}

async function runCreateSampleNote(): Promise<string | undefined> {
  let id: string | undefined;
  await act(async () => {
    id = await getWorkspaceControls().createSampleNote?.();
  });
  return id;
}

describe('Notepad desktop sample-note hydration (Task 5)', () => {
  it('hydrates the seeded sample note into the already-mounted desktop editor', async () => {
    const { container } = renderDesktopWorkspace();

    // Let the initial NotepadProvider mount effects (collection.init()) settle
    // before driving the control — mirrors the real tour, which only calls
    // prepare() after the workspace has registered its controls.
    await act(async () => {});

    await runCreateSampleNote();

    expect(editorBodyText(container)).toContain('Grace shows up before we ask.');
    expect(titleValue(container)).toBe('A guided study (sample)');
  });

  it('reuses the existing sample note on a second call — no duplicate, editor still shows its content', async () => {
    const { container, adapter } = renderDesktopWorkspace();
    await act(async () => {});

    const firstId = await runCreateSampleNote();
    const secondId = await runCreateSampleNote();

    expect(secondId).toBe(firstId);
    expect(adapter.notes.filter((n) => n.title === TOUR_SAMPLE_NOTE_TITLE)).toHaveLength(1);
    expect(editorBodyText(container)).toContain('Grace shows up before we ask.');
  });
});
