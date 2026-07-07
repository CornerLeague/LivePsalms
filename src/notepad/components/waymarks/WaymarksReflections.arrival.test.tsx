// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, periodKey: string) {
  a.__seedReflection('u', {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}

describe('WaymarksReflections newest-stone seal (decision 12)', () => {
  beforeEach(() => localStorage.clear());

  it('seals exactly one stone — the newest unopened head of the path', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-04'); seed(a, '2026-05');
    const { container } = render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(container.querySelectorAll('.wm-stone__seal')).toHaveLength(1);
  });

  it('does not seal the newest stone once it has been opened', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-05');
    localStorage.setItem('wm-opened:2026-05', '1');
    const { container } = render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(container.querySelectorAll('.wm-stone__seal')).toHaveLength(0);
  });
});
