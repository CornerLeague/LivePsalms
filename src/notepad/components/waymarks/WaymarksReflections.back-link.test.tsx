// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, userId: string, periodKey: string) {
  a.__seedReflection(userId, {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}

describe('WaymarksReflections back link', () => {
  it('renders a "← Notebook" link to the parent route in the ready state', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, 'u', '2026-05');
    render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess={true} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    const back = screen.getByRole('link', { name: '← Notebook' });
    expect(back).toHaveClass('wm-back');
    // to=".." from the default MemoryRouter route ("/") resolves to "/"
    expect(back.getAttribute('href')).toBe('/');
  });
});
