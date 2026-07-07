// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MarkerPath } from './MarkerPath';
import type { Marker } from '../../storage/lamplight-artifacts';

describe('MarkerPath (defense-in-depth)', () => {
  afterEach(cleanup);

  it('renders nothing (no crash) when markers is undefined', () => {
    // A partial artifact can carry a letter but no markers array. MarkerPath must
    // guard `markers.length` so a partial ready artifact never blanks the route.
    const { container } = render(<MarkerPath markers={undefined as unknown as Marker[]} />);
    expect(container.firstChild).toBeNull();
  });
});
