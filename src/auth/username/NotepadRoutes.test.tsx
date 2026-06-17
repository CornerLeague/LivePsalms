// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { UsernameGate } from './username-gate';

// Mocks must be declared before importing the module under test.
let mockGate: UsernameGate = { kind: 'loading' };
vi.mock('./username-gate', () => ({
  useUsernameGate: () => mockGate,
}));
vi.mock('@/components/sections/Notepad', () => ({
  Notepad: () => <div>EDITOR</div>,
}));
vi.mock('./UsernameClaim', () => ({
  UsernameClaim: () => <div>PICKER</div>,
}));

// Mocks for the new layout components (T19)
const mountSpy = vi.fn();
vi.mock('@/notepad/context/NotepadProvider', () => ({
  NotepadProvider: ({ children }: { children: React.ReactNode }) => { mountSpy(); return <>{children}</>; },
}));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ adapter: undefined }),
}));

import { LegacyNotepadRoute, VanityNotepadRoute, LocalNotepadLayout } from './NotepadRoutes';

afterEach(cleanup);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notepad/notes" element={<LegacyNotepadRoute />} />
        <Route path="/notepad/u/:username" element={<VanityNotepadRoute />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('LegacyNotepadRoute (/notepad/notes)', () => {
  beforeEach(() => {
    mockGate = { kind: 'loading' };
  });

  it('renders the editor for signed-out users (local mode)', () => {
    mockGate = { kind: 'signed-out' };
    renderAt('/notepad/notes');
    expect(screen.getByText('EDITOR')).toBeInTheDocument();
  });

  it('renders the picker when a username is needed', () => {
    mockGate = { kind: 'needs-username' };
    renderAt('/notepad/notes');
    expect(screen.getByText('PICKER')).toBeInTheDocument();
  });

  it('redirects a signed-in user with a username to their vanity route', () => {
    mockGate = { kind: 'ready', username: 'natalie' };
    renderAt('/notepad/notes');
    expect(screen.getByTestId('location')).toHaveTextContent('/notepad/u/natalie');
    expect(screen.getByText('EDITOR')).toBeInTheDocument();
  });
});

describe('VanityNotepadRoute (/notepad/u/:username)', () => {
  beforeEach(() => {
    mockGate = { kind: 'loading' };
  });

  it('renders the editor when the param matches the owner', () => {
    mockGate = { kind: 'ready', username: 'natalie' };
    renderAt('/notepad/u/natalie');
    expect(screen.getByText('EDITOR')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/notepad/u/natalie');
  });

  it('redirects to the owner route when the param does not match', () => {
    mockGate = { kind: 'ready', username: 'natalie' };
    renderAt('/notepad/u/someone_else');
    expect(screen.getByTestId('location')).toHaveTextContent('/notepad/u/natalie');
    expect(screen.getByText('EDITOR')).toBeInTheDocument();
  });

  it('redirects signed-out users back to /notepad/notes (local mode)', () => {
    mockGate = { kind: 'signed-out' };
    renderAt('/notepad/u/whoever');
    expect(screen.getByTestId('location')).toHaveTextContent('/notepad/notes');
    expect(screen.getByText('EDITOR')).toBeInTheDocument();
  });
});

describe('loading state', () => {
  beforeEach(() => {
    mockGate = { kind: 'loading' };
  });

  it('LegacyNotepadRoute shows the spinner, not the editor, while loading', () => {
    renderAt('/notepad/notes');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('EDITOR')).not.toBeInTheDocument();
    expect(screen.queryByText('PICKER')).not.toBeInTheDocument();
  });

  it('VanityNotepadRoute shows the spinner, not the editor, while loading', () => {
    renderAt('/notepad/u/natalie');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('EDITOR')).not.toBeInTheDocument();
  });
});

describe('LocalNotepadLayout', () => {
  it('mounts NotepadProvider once and renders the active child', () => {
    mockGate = { kind: 'signed-out' };
    mountSpy.mockClear();
    render(
      <MemoryRouter initialEntries={['/notepad/notes/study']}>
        <Routes>
          <Route path="/notepad/notes" element={<LocalNotepadLayout />}>
            <Route index element={<div>journal</div>} />
            <Route path="study" element={<div>study</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('study')).toBeTruthy();
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });
});
