// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeContext, type ThemeContextValue } from '../theme/theme-context';

vi.mock('./panes/ApparatusRail', () => ({ ApparatusRail: () => <div>rail</div> }));
vi.mock('./panes/StudySidePanel', () => ({
  StudySidePanel: (p: { onOpenInsights?: () => void; handoff?: { id: number; text: string } | null }) => (
    <div data-testid="side-panel" data-handoff={p.handoff ? p.handoff.text : ''}>
      panel
      {p.onOpenInsights && <button onClick={p.onOpenInsights}>Open Insights</button>}
    </div>
  ),
}));
// The doors are built by the workspace, so `onHandoff` is only reachable through
// the registry. Capture the deps and expose a press.
const doorDeps: Array<{ onHandoff?: (p: string) => void }> = [];
vi.mock('./insights/doors', async (orig) => {
  const actual = await orig<typeof import('./insights/doors')>();
  return {
    ...actual,
    passageDoor: (deps: { onHandoff?: (p: string) => void }) => {
      doorDeps.push(deps);
      return { id: 'passage', label: 'The Passage', blurb: '', render: () => null };
    },
    deeperDoor: () => ({ id: 'deeper', label: 'Deeper In', blurb: '', render: () => null }),
    referenceDoor: () => ({ id: 'reference', label: 'Sources & Reference', blurb: '', render: () => null }),
  };
});
vi.mock('./insights/InsightsOverlay', () => ({
  InsightsOverlay: (p: { book: string; chapter: number; selectedVerse: number | null; onClose: () => void }) => (
    <div data-testid="insights-overlay" data-book={p.book} data-chapter={String(p.chapter)} data-verse={String(p.selectedVerse)}>
      <button onClick={p.onClose}>Close overlay</button>
      <button onClick={() => doorDeps[doorDeps.length - 1]?.onHandoff?.('What is Psalm 27 not saying?')}>
        press-seeded-prompt
      </button>
    </div>
  ),
}));
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

// useEnsureStudyFolder reaches for the real folder hierarchy, so the workspace
// needs its provider even when every pane around it is mocked.
function renderWorkspace() {
  return render(
    <ThemeContext.Provider value={themeValue}>
      <MemoryRouter>
        <FolderHierarchyContext.Provider value={new FolderHierarchy(new FakeStorageAdapter())}>
          <StudyWorkspace />
        </FolderHierarchyContext.Provider>
      </MemoryRouter>
    </ThemeContext.Provider>,
  );
}

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

  it('owns the Insights overlay — it covers the workspace, not just the side pane', () => {
    renderWorkspace();
    expect(screen.queryByTestId('insights-overlay')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));
    expect(screen.getByTestId('insights-overlay')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close overlay/i }));
    expect(screen.queryByTestId('insights-overlay')).toBeNull();
  });

  it('hands the reader’s open passage to the overlay', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));

    const overlay = screen.getByTestId('insights-overlay');
    expect(overlay.getAttribute('data-book')).toBe('jhn');   // DEFAULT_PASSAGE
    expect(overlay.getAttribute('data-chapter')).toBe('1');
  });
});

describe('DesktopStudyWorkspace — the Insights handoff (B4)', () => {
  it('closes the overlay and lands the seeded prompt in the side panel', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));
    expect(screen.getByTestId('side-panel').getAttribute('data-handoff')).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /press-seeded-prompt/i }));

    // One press: the full-screen study gets out of the way, and the question is
    // waiting in the pane the reader is returned to.
    expect(screen.queryByTestId('insights-overlay')).toBeNull();
    expect(screen.getByTestId('side-panel').getAttribute('data-handoff')).toBe('What is Psalm 27 not saying?');
  });

  it('gives the doors a handoff handler at all', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /open insights/i }));
    expect(typeof doorDeps[doorDeps.length - 1]?.onHandoff).toBe('function');
  });
});
