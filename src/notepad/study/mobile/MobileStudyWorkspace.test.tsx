// src/notepad/study/mobile/MobileStudyWorkspace.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const openNote = vi.fn();
let activeNote: { id: string } | null = null;

vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ notes: [], activeNote, collection: { openNote } }),
}));
vi.mock('../useEnsureStudyFolder', () => ({ useEnsureStudyFolder: () => {} }));
vi.mock('../panes/StudyReader', () => ({
  StudyReader: (p: { onSelectVerse: (r: { verse: number }) => void }) => (
    <div>
      reader-pane
      <button onClick={() => p.onSelectVerse({ verse: 4 })}>tap-verse-4</button>
    </div>
  ),
}));
vi.mock('../panes/StudySidePanel', () => ({
  StudySidePanel: (p: { onOpenInsights?: () => void }) => (
    <div>
      side-panel
      {p.onOpenInsights && <button onClick={p.onOpenInsights}>Open Insights</button>}
    </div>
  ),
}));
vi.mock('../insights/InsightsOverlay', () => ({
  InsightsOverlay: (p: { book: string; chapter: number; selectedVerse: number | null; onClose: () => void }) => (
    <div data-testid="insights-overlay" data-book={p.book} data-chapter={String(p.chapter)} data-verse={String(p.selectedVerse)}>
      <button onClick={p.onClose}>Close overlay</button>
    </div>
  ),
}));
vi.mock('../panes/ApparatusRail', () => ({ ApparatusRail: () => <div>apparatus</div> }));
vi.mock('../StudyModeToggle', () => ({ StudyModeToggle: () => <div>mode-toggle</div> }));
vi.mock('./MobileStudyEditorView', () => ({
  MobileStudyEditorView: (p: { onBack: () => void }) => <button onClick={p.onBack}>editor-back</button>,
}));
vi.mock('@/notepad/recordings/RecordingsDock', () => ({ RecordingsDock: () => <div>recordings-dock</div> }));
// The workspace reads the reader's translation to thread it into ApparatusRail
// (bible_passages is keyed (translation, id) — see useApparatus).
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));

import { MobileStudyWorkspace } from './MobileStudyWorkspace';
import { ThemeContext, type ThemeContextValue } from '@/notepad/theme/theme-context';

afterEach(() => {
  cleanup();
  activeNote = null;
  openNote.mockClear();
  localStorage.clear();
});

// The header hosts the real NotesMenu, which reads theme context.
const themeStub: ThemeContextValue = {
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: vi.fn(),
  lightTheme: 'classic',
  setLightTheme: vi.fn(),
};

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <ThemeContext.Provider value={themeStub}>
        <MobileStudyWorkspace />
      </ThemeContext.Provider>
    </MemoryRouter>,
  );
}

describe('MobileStudyWorkspace', () => {
  it('lands on the Reader tab with the toggle and tab bar visible', () => {
    renderWorkspace();
    expect(screen.getByText('mode-toggle')).toBeInTheDocument();
    // Site menu (Appearance picker access) rides the header on mobile Study.
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /reader/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('always lands on the Reader tab even when Study was the last-used sub-tab, keeping the Study pane mounted', () => {
    // Persist a prior sub-tab choice: Study. Entry should still open on Reader.
    localStorage.setItem('psalms.session.mobileStudyTab', 'study');
    renderWorkspace();
    expect(screen.getByRole('tab', { name: /reader/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /study/i })).toHaveAttribute('aria-selected', 'false');
    // Panes stay mounted (display toggle), so a carried journal note under Study is preserved.
    expect(screen.getByText('side-panel')).toBeInTheDocument();
  });

  it('switches to the Context tab when tapped', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    expect(screen.getByRole('tab', { name: /context/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens Insights over the tab bar and closes back to where the reader was', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /study/i }));
    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));

    expect(screen.getByTestId('insights-overlay')).toBeInTheDocument();
    // Panes stay mounted beneath, so closing restores the reader untouched.
    expect(screen.getByText('reader-pane')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close overlay/i }));
    expect(screen.queryByTestId('insights-overlay')).toBeNull();
    expect(screen.getByRole('tab', { name: /study/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('hands the open passage to the overlay', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /study/i }));
    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));

    const overlay = screen.getByTestId('insights-overlay');
    expect(overlay.getAttribute('data-book')).toBe('jhn');   // DEFAULT_PASSAGE
    expect(overlay.getAttribute('data-chapter')).toBe('1');
  });

  it('carries a verse tapped in the Reader into the overlay', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('tap-verse-4'));
    fireEvent.click(screen.getByRole('tab', { name: /study/i }));
    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));

    expect(screen.getByTestId('insights-overlay').getAttribute('data-verse')).toBe('4');
  });

  it('opens on the whole chapter when no verse has been tapped', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /study/i }));
    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));

    expect(screen.getByTestId('insights-overlay').getAttribute('data-verse')).toBe('null');
  });

  it('shows the full-focus editor (no toggle, no tab bar) when a note is active', () => {
    activeNote = { id: 'n1' };
    renderWorkspace();
    expect(screen.getByText('editor-back')).toBeInTheDocument();
    expect(screen.queryByText('mode-toggle')).toBeNull();
    expect(screen.queryByRole('tab', { name: /reader/i })).toBeNull();
    fireEvent.click(screen.getByText('editor-back'));
    expect(openNote).toHaveBeenCalledWith(null);
  });
});
