// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WaymarksPeriodDetail } from './WaymarksPeriodDetail';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const artifact: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling one decision, turning it over on the drive to work and again before sleep.\n\n' +
    'On the twelfth something in you set it down — not because the answer arrived, but because you were ready to stop.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function seedReady(a: FakeLamplightAdapter, periodKey = '2026-05') {
  a.__seedReflection('u', {
    periodKey, title: artifact.title, artifact,
    createdAt: `${periodKey}-31T09:00:00.000Z`, savedToNotes: false,
  });
}

// jsdom has no matchMedia; usePrefersReducedMotion reads it. Stub per-test.
function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  })) as unknown as typeof window.matchMedia;
}

const renderDetail = (a: FakeLamplightAdapter, periodKey = '2026-05', canAccess = true) =>
  render(
    <MemoryRouter initialEntries={[`/notebook/reflections/${periodKey}`]}>
      <Routes>
        <Route
          path="/notebook/reflections/:periodKey"
          element={<WaymarksPeriodDetail adapter={a} userId="u" canAccess={canAccess} />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('WaymarksPeriodDetail (the opened stone)', () => {
  beforeEach(() => {
    localStorage.clear();
    setReducedMotion(false);
  });

  // globals: false in vitest.config.ts — RTL's afterEach auto-detection at module-load
  // time silently no-ops here, matching this codebase's convention in every other
  // multi-render jsdom test file (e.g. SecuritySection.test.tsx, DecorationItem.test.tsx).
  afterEach(cleanup);

  it('shows the seal, then reveals the letter + markers when broken', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderDetail(a);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Break the seal' })).toBeInTheDocument());
    // Letter is still sealed.
    expect(screen.queryByText(artifact.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }));
    expect(screen.getByText(artifact.title)).toBeInTheDocument();
    expect(screen.getByText('THE MOMENTS, MARKED')).toBeInTheDocument();
    expect(screen.getByText('Ps 27:14')).toBeInTheDocument();
    // The affordances render as static copy (Task 17 wires them).
    expect(screen.getByText('＋ Add your words.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save to notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide this stone' })).toBeInTheDocument();
    // Opened is persisted so the ceremony never replays.
    expect(localStorage.getItem('wm-opened:2026-05')).toBe('1');
  });

  it('reveals the letter directly when the stone was already opened', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    localStorage.setItem('wm-opened:2026-05', '1');
    renderDetail(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Break the seal' })).not.toBeInTheDocument();
  });

  it('skips the ceremony under reduced motion and shows the letter directly', async () => {
    setReducedMotion(true);
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderDetail(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Break the seal' })).not.toBeInTheDocument();
  });

  it('renders the user annotation as a separate "Your words" aside, not in place of the letter', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    await a.setReflectionAnnotation('u', 'reflection_recap', '2026-05', 'I remember the drive.');
    localStorage.setItem('wm-opened:2026-05', '1');
    renderDetail(a);
    await waitFor(() => expect(screen.getByText('Your words')).toBeInTheDocument());
    // Scoped to the aside (implicit 'complementary' role): Task 17's wired textarea
    // pre-populates its draft from the same annotation, so an unscoped text query is
    // ambiguous (matches the aside's <p> and the textarea's rendered value alike).
    expect(screen.getByRole('complementary', { name: 'Your words' })).toHaveTextContent('I remember the drive.');
    // The original letter is still present alongside it.
    expect(screen.getByText(artifact.title)).toBeInTheDocument();
  });

  it('shows the empty-month copy when the month has nothing written', async () => {
    const a = new FakeLamplightAdapter();
    a.__queueReflectionResult({ ok: false, reason: 'no_notes' }); // → controller phase 'empty'
    renderDetail(a);
    await waitFor(() => expect(screen.getByText('Nothing was written here.')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: '← The Path' })).toBeInTheDocument();
  });

  it('shows the retry affordance when the stone is not ready', async () => {
    const a = new FakeLamplightAdapter();
    a.__queueReflectionResult({ ok: false, reason: 'network' }); // → phase 'unavailable' | 'error'
    renderDetail(a);
    await waitFor(() => expect(screen.getByText("This one isn't ready yet. Try again.")).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
