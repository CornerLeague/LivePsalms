// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { WaymarksLockedPreview } from './WaymarksLockedPreview';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, periodKey: string) {
  a.__seedReflection('u', {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}

describe('WaymarksReflections downgrade (lapsed Plus keeps the path)', () => {
  it('keeps stones readable with a quiet head-note and NO paywall CTA when downgraded', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, '2026-05');
    render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess={false} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    expect(screen.getByText(/Your path is here whenever you return\./)).toBeInTheDocument();
    // Not the locked invitation — no upgrade CTA.
    expect(screen.queryByText('See your own months marked')).not.toBeInTheDocument();
  });
});

describe('WaymarksLockedPreview is an invitation, not a paywall', () => {
  it('shows no numbers and no paywall vocabulary', () => {
    const { container } = render(<WaymarksLockedPreview />);
    expect(container.textContent ?? '').not.toMatch(/\d/);
    expect(container.textContent ?? '').not.toMatch(/unlock|upgrade to|paywall|\$/i);
  });
});
