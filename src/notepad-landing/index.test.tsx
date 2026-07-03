// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, afterEach } from 'vitest';
import { NotepadLanding } from './index';

afterEach(cleanup);

describe('NotepadLanding (stub)', () => {
  it('renders the locked hero H1', () => {
    render(
      <MemoryRouter initialEntries={['/notebook']}>
        <Routes>
          <Route path="/notebook" element={<NotepadLanding />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: /your walk with god isn’t just a journey/i }),
    ).toBeInTheDocument();
  });

  it('renders the primary CTA that links to /notebook/notes', () => {
    render(
      <MemoryRouter initialEntries={['/notebook']}>
        <Routes>
          <Route path="/notebook" element={<NotepadLanding />} />
        </Routes>
      </MemoryRouter>,
    );
    const ctas = screen.getAllByRole('link', { name: /open your notebook/i });
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    expect(ctas[0]).toHaveAttribute('href', '/notebook/notes');
  });
});
