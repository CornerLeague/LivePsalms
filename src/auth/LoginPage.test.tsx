// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Mocks must be declared before importing the module under test.
let mockUser: { id: string } | null = null;
vi.mock('./context/useAuthSession', () => ({
  useAuthSession: () => ({ user: mockUser }),
}));
vi.mock('./AuthCard', () => ({
  AuthCard: () => <div>AUTH_CARD</div>,
}));

import { LoginPage } from './LoginPage';

afterEach(cleanup);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/notepad/notes" element={<div>NOTES</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockUser = null;
  });

  it('shows the auth card and stays on /login when signed out', () => {
    renderAt();
    expect(screen.getByText('AUTH_CARD')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('redirects an already-signed-in user to /notepad/notes without navigating during render', () => {
    // navigate() during render emits a React console.error ("Cannot update a
    // component while rendering a different component"). The declarative
    // <Navigate> must not trigger it — guards the desktop login-redirect bug.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUser = { id: 'u1' };

    renderAt();

    expect(screen.getByTestId('location')).toHaveTextContent('/notepad/notes');
    expect(screen.getByText('NOTES')).toBeInTheDocument();
    expect(screen.queryByText('AUTH_CARD')).not.toBeInTheDocument();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
