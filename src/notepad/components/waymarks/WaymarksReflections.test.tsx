// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
const renderPath = (a: FakeLamplightAdapter, canAccess = true) =>
  render(
    <MemoryRouter>
      <WaymarksReflections adapter={a} userId="u" canAccess={canAccess} />
    </MemoryRouter>,
  );

describe('WaymarksReflections (Waymarks)', () => {
  it('renders visible stones oldest-first with plain year dividers', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, 'u', '2025-11'); seed(a, 'u', '2026-01'); seed(a, 'u', '2026-05');
    renderPath(a);
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    const may = screen.getByText('May 2026');
    const jan = screen.getByText('January 2026');
    // oldest-first: January 2026 appears before May 2026 in document order
    expect(jan.compareDocumentPosition(may) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits hidden stones from the walk but reveals them under "Hidden stones"', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, 'u', '2026-04'); seed(a, 'u', '2026-05');
    await a.setReflectionHidden('u', 'reflection_recap', '2026-04', true);
    renderPath(a);
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.queryByText('April 2026')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hidden stones' }));
    expect(screen.getByText('April 2026')).toBeInTheDocument();
  });

  it('shows the invitation (not a paywall) for a never-subscribed user with no stones', async () => {
    const a = new FakeLamplightAdapter();
    renderPath(a, false);
    await waitFor(() => expect(screen.getByText('See your own months marked')).toBeInTheDocument());
  });

  it('backfills missing months on first open, then repaints the new stone', async () => {
    const a = new FakeLamplightAdapter();
    a.__setBackfillTargets('u', ['2026-03']);
    a.__queueReflectionResult({ ok: true, artifact: art, cached: false });
    renderPath(a);
    await waitFor(() => expect(screen.getByText('March 2026')).toBeInTheDocument());
  });
});
