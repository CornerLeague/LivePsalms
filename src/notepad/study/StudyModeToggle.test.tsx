// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StudyModeToggle } from './StudyModeToggle';

afterEach(cleanup);

describe('StudyModeToggle', () => {
  it('marks Study active on a /study URL', () => {
    render(<MemoryRouter initialEntries={['/notebook/u/ann/study']}><StudyModeToggle /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /study/i }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /journal/i }).getAttribute('aria-current')).toBeNull();
  });
  it('marks Journal active on the base URL', () => {
    render(<MemoryRouter initialEntries={['/notebook/u/ann']}><StudyModeToggle /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /journal/i }).getAttribute('aria-current')).toBe('page');
  });
});
