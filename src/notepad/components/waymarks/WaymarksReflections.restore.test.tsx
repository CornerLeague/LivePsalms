// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('WaymarksReflections restore', () => {
  it('restores a hidden stone back onto the path', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-04'); seed(a, '2026-05');
    await a.setReflectionHidden('u', 'reflection_recap', '2026-04', true);
    render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.queryByText('April 2026')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hidden stones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore this stone.' }));
    // Hidden list empties and April returns to the visible path.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Hidden stones' })).not.toBeInTheDocument());
    expect(screen.getAllByText('April 2026').length).toBeGreaterThan(0);
  });

  it('restore: stays in the hidden list when the unhide write fails, so retry stays live', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-04'); seed(a, '2026-05');
    await a.setReflectionHidden('u', 'reflection_recap', '2026-04', true);
    const setHidden = vi.spyOn(a, 'setReflectionHidden').mockRejectedValue(new Error('unhide write failed'));
    render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Hidden stones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore this stone.' }));
    await waitFor(() => expect(setHidden).toHaveBeenCalledTimes(1));
    // The rejection must be caught (no unhandled rejection escaping the void'd onClick)
    // and the stone must stay in the hidden list with the button live for retry.
    expect(screen.getByRole('button', { name: 'Restore this stone.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this stone.' }));
    await waitFor(() => expect(setHidden).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Restore this stone.' })).toBeInTheDocument();
  });
});
