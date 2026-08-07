// @vitest-environment jsdom
// src/notepad/study/mobile/MobileStudyWorkspace.overlay.test.tsx
//
// The REAL InsightsOverlay, inside the mobile workspace.
//
// `MobileStudyWorkspace.test.tsx` mocks the overlay entirely — a div with a
// close button — so its six Insights assertions cover the wiring and say
// nothing whatever about the overlay's behaviour. That is worth having and it
// is not the same thing as knowing the overlay works over the tab bar, which is
// what parent §2 actually asks for.
//
// The doors are stubbed instead, because a real door reaches Supabase; the
// overlay's own chrome is what is under test here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ notes: [], activeNote: null, collection: { openNote: vi.fn() } }),
}));
vi.mock('../useEnsureStudyFolder', () => ({ useEnsureStudyFolder: () => {} }));
vi.mock('../panes/StudyReader', () => ({ StudyReader: () => <div>reader-pane</div> }));
vi.mock('../panes/StudySidePanel', () => ({
  StudySidePanel: (p: { onOpenInsights?: () => void }) => (
    <div>
      side-panel
      {p.onOpenInsights && <button onClick={p.onOpenInsights}>Open Insights</button>}
    </div>
  ),
}));
vi.mock('../panes/ApparatusRail', () => ({ ApparatusRail: () => <div>apparatus</div> }));
vi.mock('../StudyModeToggle', () => ({ StudyModeToggle: () => <div>mode-toggle</div> }));
vi.mock('./MobileStudyEditorView', () => ({ MobileStudyEditorView: () => <div>editor</div> }));
vi.mock('@/notepad/recordings/RecordingsDock', () => ({ RecordingsDock: () => <div>recordings-dock</div> }));
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('@/components/notes-menu/NotesMenu', () => ({ NotesMenu: () => <div>notes-menu</div> }));
// Stubs the HOOK only, keeping the real `entitledAndSignedIn` — it is a pure
// predicate, and mocking it away is how the promo defect stayed invisible.
vi.mock('@/notepad/hooks/useLamplightEntitlement', async (orig) => ({
  ...(await orig<typeof import('@/notepad/hooks/useLamplightEntitlement')>()),
  useLamplightEntitlement: () => ({ hasAccess: () => true }),
}));
vi.mock('../insights/doors', async (orig) => {
  const actual = await orig<typeof import('../insights/doors')>();
  const stub = (id: string, label: string) => () => ({
    id, label, blurb: `${label} blurb`, render: () => <div>{`${id}-door-content`}</div>,
  });
  return {
    ...actual,
    passageDoor: stub('passage', 'The Passage'),
    deeperDoor: stub('deeper', 'Deeper In'),
    referenceDoor: stub('reference', 'Sources & Reference'),
  };
});

import { MobileStudyWorkspace } from './MobileStudyWorkspace';

afterEach(() => { cleanup(); localStorage.clear(); });

function open() {
  render(<MemoryRouter><MobileStudyWorkspace /></MemoryRouter>);
  fireEvent.click(screen.getByRole('tab', { name: /study/i }));
  fireEvent.click(screen.getByRole('button', { name: /open insights/i }));
}

describe('the real Insights overlay on mobile', () => {
  it('covers the tab bar by construction, not by luck', () => {
    open();
    const dialog = screen.getByRole('dialog');
    const workspace = document.querySelector('.study-workspace') as HTMLElement;

    // A body-level portal at z-index 1000 paints above a `position: fixed`
    // sibling with no z-index (`auto`), and StudyTabBar sits in that sibling's
    // normal flow. Both halves asserted, because either one changing silently
    // is how the overlay would start rendering UNDER the tab bar.
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.zIndex).toBe('1000');
    expect(workspace.style.zIndex).toBe('');
  });

  it('offers all three doors in reading order', () => {
    open();
    const chooser = screen.getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t.includes('blurb'));
    expect(chooser).toHaveLength(3);
    expect(chooser[0]).toContain('The Passage');
    expect(chooser[2]).toContain('Sources & Reference');
  });

  it('opens a door and comes back out of it', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /The Passage/ }));
    expect(screen.getByText('passage-door-content')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /all insights/i }));
    expect(screen.queryByText('passage-door-content')).toBeNull();
    expect(screen.getByRole('button', { name: /Deeper In/ })).toBeTruthy();
  });

  it('closes back to the Study tab, with the panes still mounted beneath', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /close insights/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('tab', { name: /study/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('reader-pane')).toBeInTheDocument();
  });

  it('restores body scroll on close, so the workspace underneath is usable again', () => {
    document.body.style.overflow = 'auto';
    open();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: /close insights/i }));
    expect(document.body.style.overflow).toBe('auto');
  });
});
