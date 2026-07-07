// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReflectionLetter } from './ReflectionLetter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

describe('ReflectionLetter (defense-in-depth)', () => {
  afterEach(cleanup);

  it('does not crash when the artifact has no letter — renders the title, no paragraphs', () => {
    // A partial/empty artifact ({} cast) has letter === undefined. The render layer
    // is the last line of defence: a missing letter must never blank the route.
    const artifact = { title: 'March 2026' } as ReflectionArtifact;
    expect(() => render(<ReflectionLetter artifact={artifact} />)).not.toThrow();
    expect(screen.getByText('March 2026')).toBeInTheDocument();
  });
});
