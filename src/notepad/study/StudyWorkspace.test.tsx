// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('./panes/ApparatusRail', () => ({ ApparatusRail: () => <div>rail</div> }));
vi.mock('./panes/StudySidePanel', () => ({ StudySidePanel: () => <div>panel</div> }));
vi.mock('./StudyModeToggle', () => ({ StudyModeToggle: () => <div>toggle</div> }));
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

import { MemoryRouter } from 'react-router-dom';
import { FolderHierarchyContext } from '../context/useFolderHierarchy';
import { FolderHierarchy } from '../collection/folder-hierarchy';
import { FakeStorageAdapter } from '../collection/fake-storage-adapter';
import { StudyWorkspace } from './StudyWorkspace';

afterEach(cleanup);

describe('StudyWorkspace', () => {
  it('renders the toggle and three panes under data-mode="study" without an update loop', () => {
    const hierarchy = new FolderHierarchy(new FakeStorageAdapter());
    const { container } = render(
      <MemoryRouter>
        <FolderHierarchyContext.Provider value={hierarchy}>
          <StudyWorkspace />
        </FolderHierarchyContext.Provider>
      </MemoryRouter>,
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
      <MemoryRouter>
        <FolderHierarchyContext.Provider value={hierarchy}>
          <StudyWorkspace />
        </FolderHierarchyContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByText('rail')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /collapse context/i }));
    expect(screen.queryByText('rail')).toBeNull();
    expect(screen.getByRole('button', { name: /expand context/i })).toBeInTheDocument();
  });
});
