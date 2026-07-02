// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { NotepadCompatRedirect } from './NotepadCompatRedirect';

afterEach(cleanup);

// Renders the resolved location so a test can assert the full URL landed on
// after the redirect — pathname AND search AND hash. The search/hash matter:
// already-sent Supabase auth emails point at /notepad/notes and carry the
// OAuth callback in the query (`?code=`) or the fragment (`#access_token=`),
// which the redirect must not drop.
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {/* Legacy /notepad* routes under test — each redirects to /notebook*. */}
        <Route path="/notepad" element={<NotepadCompatRedirect />} />
        <Route path="/notepad/notes" element={<NotepadCompatRedirect />} />
        <Route path="/notepad/u/:username" element={<NotepadCompatRedirect />} />
        {/* Destinations — render the probe so we can read where we landed. */}
        <Route path="/notebook" element={<LocationProbe />} />
        <Route path="/notebook/notes" element={<LocationProbe />} />
        <Route path="/notebook/u/:username" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NotepadCompatRedirect (legacy /notepad → /notebook)', () => {
  it('redirects /notepad to /notebook', () => {
    renderAt('/notepad');
    expect(screen.getByTestId('location').textContent).toBe('/notebook');
  });

  it('redirects /notepad/notes to /notebook/notes', () => {
    renderAt('/notepad/notes');
    expect(screen.getByTestId('location').textContent).toBe('/notebook/notes');
  });

  it('redirects /notepad/u/:username preserving the username', () => {
    renderAt('/notepad/u/natalie');
    expect(screen.getByTestId('location').textContent).toBe('/notebook/u/natalie');
  });

  it('preserves the query string so already-sent auth-email links still complete (?code=)', () => {
    renderAt('/notepad/notes?code=abc123');
    expect(screen.getByTestId('location').textContent).toBe('/notebook/notes?code=abc123');
  });

  it('preserves the URL fragment so implicit-flow auth tokens survive (#access_token=)', () => {
    renderAt('/notepad/notes#access_token=xyz');
    expect(screen.getByTestId('location').textContent).toBe('/notebook/notes#access_token=xyz');
  });
});
