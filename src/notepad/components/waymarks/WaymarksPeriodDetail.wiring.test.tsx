// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WaymarksPeriodDetail } from './WaymarksPeriodDetail';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';
import type { ReflectionRecord } from '../../storage/lamplight-adapter';

const artifact: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter: 'You began May circling one decision.\n\nOn the twelfth you set it down.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function seedReady(a: FakeLamplightAdapter, periodKey = '2026-05') {
  a.__seedReflection('u', {
    periodKey, title: artifact.title, artifact,
    createdAt: `${periodKey}-31T09:00:00.000Z`, savedToNotes: false,
  });
}

// jsdom has no matchMedia; usePrefersReducedMotion reads it.
function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  })) as unknown as typeof window.matchMedia;
}

// Detail route + a sentinel Path route so we can assert navigation on hide. Nested under
// a shared parent (mirrors the real app: both live under /notebook/u/:username in App.tsx),
// NOT flat siblings — hide()'s relative navigate('..') resolves against route NESTING, so
// a flat-sibling scaffold has no parent for '..' to resolve to ("No routes matched" at '/').
const renderWired = (
  a: FakeLamplightAdapter,
  onSaveToNotes?: (r: ReflectionRecord) => void | Promise<void>,
  periodKey = '2026-05',
) =>
  render(
    <MemoryRouter initialEntries={[`/notebook/reflections/${periodKey}`]}>
      <Routes>
        <Route path="/notebook/reflections">
          <Route index element={<div>PATH</div>} />
          <Route
            path=":periodKey"
            element={<WaymarksPeriodDetail adapter={a} userId="u" canAccess onSaveToNotes={onSaveToNotes} />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('WaymarksPeriodDetail (wired affordances)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('wm-opened:2026-05', '1'); // skip the seal so the letter is live
    setReducedMotion(false);
  });

  // globals: false in vitest.config.ts — RTL's afterEach auto-cleanup doesn't register;
  // each multi-render jsdom file must call this explicitly (see WaymarksPeriodDetail.test.tsx).
  afterEach(cleanup);

  it('saves an annotation and renders it in the "Your words" aside', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderWired(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I remember the drive.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save your words' }));
    await waitFor(() => expect(screen.getByText('Your words')).toBeInTheDocument());
    // Scoped to the annotation aside via its implicit 'complementary' role: both the
    // <aside> and the wired textarea share aria-label="Your words" (Task 16 + Task 17),
    // and the textarea's DOM value is also rendered text — so an unscoped query is
    // ambiguous on both text and label.
    expect(screen.getByRole('complementary', { name: 'Your words' })).toHaveTextContent('I remember the drive.');
    expect((await a.getReflectionState('u', 'reflection_recap', '2026-05'))?.annotation).toBe('I remember the drive.');
  });

  it('saves to notes: flips the flag, calls the seam, and disables the button', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    const onSaveToNotes = vi.fn();
    renderWired(a, onSaveToNotes);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save to notes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved to notes' })).toBeDisabled());
    expect(onSaveToNotes).toHaveBeenCalledTimes(1);
    expect((await a.getReflection('u', '2026-05'))?.savedToNotes).toBe(true);
  });

  it('save to notes: leaves the flag unset when the note insert fails, so retry stays live', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    const onSaveToNotes = vi.fn().mockRejectedValue(new Error('note insert failed'));
    renderWired(a, onSaveToNotes);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save to notes' }));
    await waitFor(() => expect(onSaveToNotes).toHaveBeenCalledTimes(1));
    // Invariant: saved_to_notes=true must imply the note exists. A persisted flag with
    // no note disables the button on every later visit — the letter becomes unsavable.
    expect((await a.getReflection('u', '2026-05'))?.savedToNotes).toBe(false);
    expect(screen.getByRole('button', { name: 'Save to notes' })).toBeEnabled();
  });

  it('hides the stone and navigates back to The Path', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    renderWired(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Hide this stone' }));
    await waitFor(() => expect(screen.getByText('PATH')).toBeInTheDocument());
    expect((await a.getReflectionState('u', 'reflection_recap', '2026-05'))?.hiddenAt).not.toBeNull();
  });

  it('hide: stays on the letter when the hide write fails, so retry stays live', async () => {
    const a = new FakeLamplightAdapter();
    seedReady(a);
    const setHidden = vi.spyOn(a, 'setReflectionHidden').mockRejectedValue(new Error('hide write failed'));
    renderWired(a);
    await waitFor(() => expect(screen.getByText(artifact.title)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Hide this stone' }));
    await waitFor(() => expect(setHidden).toHaveBeenCalledTimes(1));
    // The rejection must be caught (no unhandled rejection escaping the void'd
    // onClick) and must not navigate — the letter stays up with the button live.
    expect(screen.queryByText('PATH')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide this stone' }));
    await waitFor(() => expect(setHidden).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('PATH')).not.toBeInTheDocument();
    expect(screen.getByText(artifact.title)).toBeInTheDocument();
  });
});
