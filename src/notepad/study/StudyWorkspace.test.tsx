// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeContext, type ThemeContextValue } from '../theme/theme-context';

vi.mock('./panes/ApparatusRail', () => ({ ApparatusRail: () => <div>rail</div> }));
vi.mock('./panes/StudySidePanel', () => ({ StudySidePanel: () => <div>panel</div> }));
vi.mock('./StudyModeToggle', () => ({ StudyModeToggle: () => <div>toggle</div> }));
vi.mock('@/notepad/components/NotepadAuthControls', () => ({ NotepadAuthControls: () => <div>auth</div> }));
vi.mock('@/notepad/recordings/RecordingsDock', () => ({ RecordingsDock: () => <div>recordings-dock</div> }));
vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ notes: [], activeNote: null, collection: { openNote: vi.fn() } }),
}));
// The StudyReader mock reports its (unchanged) passage from an effect on EVERY
// render — the exact shape that previously caused "Maximum update depth exceeded".
// If StudyWorkspace's handler isn't stable + guarded, render() throws here.
vi.mock('./panes/StudyReader', async () => {
  const { useEffect, createElement } = await import('react');
  return {
    StudyReader: (props: { book: string; chapter: number; onPassageChange: (r: { book: string; chapter: number }) => void }) => {
      useEffect(() => {
        props.onPassageChange({ book: props.book, chapter: props.chapter });
      });
      return createElement('div', null, `reader ${props.book}:${props.chapter}`);
    },
  };
});
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: { id: 'u1' }, loading: false }) }));
// The workspace reads the reader's translation to thread it into ApparatusRail
// (bible_passages is keyed (translation, id) — see useApparatus).
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));

const isMobile = { value: false };
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => isMobile.value }));
vi.mock('./mobile/MobileStudyWorkspace', () => ({ MobileStudyWorkspace: () => <div>mobile-study</div> }));

import { MemoryRouter } from 'react-router-dom';
import { FolderHierarchyContext } from '../context/useFolderHierarchy';
import { FolderHierarchy } from '../collection/folder-hierarchy';
import { FakeStorageAdapter } from '../collection/fake-storage-adapter';
import { StudyWorkspace } from './StudyWorkspace';

afterEach(() => {
  cleanup();
  isMobile.value = false;
});

const themeValue: ThemeContextValue = { theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() };

describe('StudyWorkspace', () => {
  it('renders the toggle and three panes under data-mode="study" without an update loop', () => {
    const hierarchy = new FolderHierarchy(new FakeStorageAdapter());
    const { container } = render(
      <ThemeContext.Provider value={themeValue}>
        <MemoryRouter>
          <FolderHierarchyContext.Provider value={hierarchy}>
            <StudyWorkspace />
          </FolderHierarchyContext.Provider>
        </MemoryRouter>
      </ThemeContext.Provider>,
    );
    const root = container.querySelector('[data-mode="study"]');
    expect(root).toBeTruthy();
    expect(root?.textContent).toContain('toggle');
    expect(root?.textContent).toContain('rail');
    expect(root?.textContent).toContain('reader jhn:1');
    expect(root?.textContent).toContain('panel');
  });

  it('collapses the context rail to a reopen strip', () => {
    const hierarchy = new FolderHierarchy(new FakeStorageAdapter());
    render(
      <ThemeContext.Provider value={themeValue}>
        <MemoryRouter>
          <FolderHierarchyContext.Provider value={hierarchy}>
            <StudyWorkspace />
          </FolderHierarchyContext.Provider>
        </MemoryRouter>
      </ThemeContext.Provider>,
    );
    expect(screen.getByText('rail')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /collapse context/i }));
    expect(screen.queryByText('rail')).toBeNull();
    expect(screen.getByRole('button', { name: /expand context/i })).toBeInTheDocument();
  });

  it('renders the mobile workspace below the breakpoint', () => {
    isMobile.value = true;
    render(
      <ThemeContext.Provider value={themeValue}>
        <MemoryRouter>
          <StudyWorkspace />
        </MemoryRouter>
      </ThemeContext.Provider>,
    );
    expect(screen.getByText('mobile-study')).toBeInTheDocument();
  });
});
