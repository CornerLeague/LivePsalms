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

describe('MarkerPath date range', () => {
  afterEach(cleanup);

  function dateLabel(markers: Marker[]): string {
    const { container } = render(<MarkerPath markers={markers} />);
    return container.querySelector('.wm-marker__date')?.textContent ?? '';
  }

  it('renders a valid span with both endpoints', () => {
    const label = dateLabel([{ date: '2026-05-12', date_end: '2026-05-18', verse: null, phrase: 'a hard week' }]);
    expect(label).toBe('May 12 – May 18');
  });

  it('renders a single date when there is no date_end', () => {
    const label = dateLabel([{ date: '2026-05-12', verse: null, phrase: 'one day' }]);
    expect(label).toBe('May 12');
  });

  it('does not render a dangling separator when date_end is truthy but unformattable', () => {
    // markerDate() degrades a partial/malformed ISO string to '' (PR #75 hardening).
    // The separator must key off the *formatted* end, not raw `date_end` truthiness,
    // or the label reads "May 12 – " — an unfinished-looking range.
    const label = dateLabel([{ date: '2026-05-12', date_end: '2026-05', verse: null, phrase: 'a partial span' }]);
    expect(label).toBe('May 12');
  });
});
