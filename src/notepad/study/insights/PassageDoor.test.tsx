// @vitest-environment jsdom
// src/notepad/study/insights/PassageDoor.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PASSAGE_SECTIONS, type PassageInsightSseEvent, type PassageInsightInvoke } from './passage-insight-stream-client';
import { DEEPER_DOOR_VIEW, PASSAGE_DOOR_VIEW } from './insight-doors';

type Result = { data: unknown; error: unknown };

const { from, setResult, eqs } = vi.hoisted(() => {
  let result: Result = { data: [], error: null };
  const eqs: Array<[string, unknown]> = [];
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    // Recorded, not swallowed: "this door reads its OWN cache rows" is the
    // assertion that keeps two doors from rendering each other's content.
    builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder; };
    builder.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej);
    return builder;
  });
  return { from, setResult: (r: Result) => { result = r; }, eqs };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { PassageDoor } from './PassageDoor';

const KEYS = PASSAGE_SECTIONS.map((s) => s.key);
const SCOPE = { book: 'psa', chapter: 27, verse: null };

function rows(bodies: Partial<Record<string, string>> = {}) {
  return KEYS.map((k) => ({ section: k, body: bodies[k] ?? `The body of ${k}.` }));
}

function scriptedInvoke(beats: PassageInsightSseEvent[]): PassageInsightInvoke {
  return vi.fn(async (_scope, handlers) => {
    for (const b of beats) handlers.onEvent(b);
  });
}

beforeEach(() => { setResult({ data: [], error: null }); from.mockClear(); eqs.length = 0; });
afterEach(() => cleanup());

describe('PassageDoor — a cached door', () => {
  it('renders every section immediately, with no generate action', async () => {
    setResult({ data: rows(), error: null });
    render(<PassageDoor scope={SCOPE} invoke={scriptedInvoke([])} canGenerate />);

    for (const s of PASSAGE_SECTIONS) {
      expect(await screen.findByText(s.label)).toBeTruthy();
      expect(screen.getByText(`The body of ${s.key}.`)).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /study this passage/i })).toBeNull();
  });

  it('shows no spinner — a cached door is one query, not a wait', async () => {
    setResult({ data: rows(), error: null });
    render(<PassageDoor scope={SCOPE} invoke={scriptedInvoke([])} canGenerate />);

    await screen.findByText('Overview');
    expect(screen.queryByText(/composing|generating|thinking/i)).toBeNull();
  });

  it('renders NOTHING for an empty section — no heading, no placeholder, no apology', async () => {
    setResult({ data: rows({ chapter_shape: '' }), error: null });
    render(<PassageDoor scope={SCOPE} invoke={scriptedInvoke([])} canGenerate />);

    await screen.findByText('Overview');
    // Omission is first-class: the heading goes with the body.
    expect(screen.queryByText("The Chapter's Shape")).toBeNull();
    expect(screen.getByText('The body of overview.')).toBeTruthy();
  });

  it('is visible to a reader who cannot generate — cached doors are free and public', async () => {
    setResult({ data: rows(), error: null });
    render(<MemoryRouter><PassageDoor scope={SCOPE} invoke={null} canGenerate={false} /></MemoryRouter>);

    expect(await screen.findByText('Overview')).toBeTruthy();
    expect(screen.getByText('The body of overview.')).toBeTruthy();
  });
});

describe('PassageDoor — an uncached door', () => {
  it('offers "Study this passage" rather than generating on open', async () => {
    const invoke = scriptedInvoke([]);
    render(<PassageDoor scope={SCOPE} invoke={invoke} canGenerate />);

    expect(await screen.findByRole('button', { name: /study this passage/i })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('streams sections in when the reader presses it', async () => {
    const sections = Object.fromEntries(KEYS.map((k) => [k, `Final ${k}.`]));
    const invoke = scriptedInvoke([
      { t: 'text', field: 'overview', delta: 'David opens by naming the LORD.' },
      { t: 'done', payload: { ok: true, cached: true, sections } },
    ]);
    render(<PassageDoor scope={SCOPE} invoke={invoke} canGenerate />);

    await userEvent.click(await screen.findByRole('button', { name: /study this passage/i }));

    expect(await screen.findByText('Final overview.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('shows a section the moment it arrives, before the rest', async () => {
    let emit!: (ev: PassageInsightSseEvent) => void;
    let release!: () => void;
    const invoke: PassageInsightInvoke = vi.fn(async (_s, handlers) => {
      emit = handlers.onEvent;
      await new Promise<void>((r) => { release = r; });
    });
    render(<PassageDoor scope={SCOPE} invoke={invoke} canGenerate />);

    await userEvent.click(await screen.findByRole('button', { name: /study this passage/i }));
    await waitFor(() => expect(emit).toBeDefined());

    emit({ t: 'text', field: 'overview', delta: 'David opens by naming the LORD.' });

    // Overview is on screen while the other three have not arrived — the whole
    // point of streaming rather than waiting for the door to complete.
    expect(await screen.findByText('David opens by naming the LORD.')).toBeTruthy();
    expect(screen.queryByText('Reflection & Application')).toBeNull();
    release();
  });

  it('hides the generate action from a signed-out or non-entitled reader', async () => {
    render(<MemoryRouter><PassageDoor scope={SCOPE} invoke={null} canGenerate={false} /></MemoryRouter>);

    await waitFor(() => expect(from).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /study this passage/i })).toBeNull();
  });

  it('shows a blocked affordance rather than an empty panel', async () => {
    // The door is listed in the overlay's chooser, so opening it must explain
    // itself. Silence would read as a broken door.
    const { container } = render(
      <MemoryRouter><PassageDoor scope={SCOPE} invoke={null} canGenerate={false} userId="u1" /></MemoryRouter>,
    );
    await waitFor(() => expect(from).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent!.trim().length).toBeGreaterThan(0));
  });

  it('offers sign-in to a signed-out reader, and the paywall to a signed-in one', async () => {
    const out = render(
      <MemoryRouter><PassageDoor scope={SCOPE} invoke={null} canGenerate={false} userId={null} /></MemoryRouter>,
    );
    await waitFor(() => expect(out.container.textContent!.trim().length).toBeGreaterThan(0));
    const signedOut = out.container.textContent!;
    cleanup();

    const inn = render(
      <MemoryRouter><PassageDoor scope={SCOPE} invoke={null} canGenerate={false} userId="u1" /></MemoryRouter>,
    );
    await waitFor(() => expect(inn.container.textContent!.trim().length).toBeGreaterThan(0));
    expect(inn.container.textContent).not.toBe(signedOut);
  });

  it('offers the door again after a failed generation', async () => {
    const invoke = scriptedInvoke([
      { t: 'text', field: 'overview', delta: 'David opens' },
      { t: 'error', reason: 'validators_failed' },
    ]);
    render(<PassageDoor scope={SCOPE} invoke={invoke} canGenerate />);

    await userEvent.click(await screen.findByRole('button', { name: /study this passage/i }));

    // Not stranded: the button comes back, and the half-written text does not
    // stay on screen pretending to be a door.
    expect(await screen.findByRole('button', { name: /study this passage/i })).toBeTruthy();
    expect(screen.queryByText('David opens')).toBeNull();
  });
});

// ── Two doors, one component (B3) ────────────────────────────────────────────

describe('PassageDoor — rendering Door 2', () => {
  const DEEPER_KEYS = DEEPER_DOOR_VIEW.sections.map((s) => s.key);
  const deeperRows = () => DEEPER_KEYS.map((k) => ({ section: k, body: `The body of ${k}.` }));

  it('renders Door 2’s headings, not Door 1’s', async () => {
    setResult({ data: deeperRows(), error: null });
    render(<PassageDoor scope={SCOPE} invoke={scriptedInvoke([])} canGenerate door={DEEPER_DOOR_VIEW} />);

    for (const s of DEEPER_DOOR_VIEW.sections) {
      expect(await screen.findByText(s.label)).toBeTruthy();
    }
    // And none of Door 1's, which is the half that would fail silently.
    for (const s of PASSAGE_DOOR_VIEW.sections) {
      expect(screen.queryByText(s.label)).toBeNull();
    }
  });

  it('reads its own cache rows', async () => {
    setResult({ data: deeperRows(), error: null });
    render(<PassageDoor scope={SCOPE} invoke={scriptedInvoke([])} canGenerate door={DEEPER_DOOR_VIEW} />);
    await screen.findByText('How to Read This Passage');

    expect(eqs).toContainEqual(['door', 'deeper']);
    expect(eqs).not.toContainEqual(['door', 'passage']);
  });

  it('tells the server which door to generate', async () => {
    const invoke = scriptedInvoke([]);
    render(<PassageDoor scope={SCOPE} invoke={invoke} canGenerate door={DEEPER_DOOR_VIEW} />);

    const button = await screen.findByRole('button', { name: /study this passage/i });
    await userEvent.click(button);

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const handlers = (invoke as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(handlers.doorId).toBe('deeper');
  });

  it('omits an empty Read With Care entirely — no heading, no placeholder', async () => {
    // Door 2 hits this more often than Door 1: a genealogy invites no cautions,
    // and §9 says an ungroundable one is not written at all.
    setResult({
      data: deeperRows().map((r) => (r.section === 'read_with_care' ? { ...r, body: '' } : r)),
      error: null,
    });
    render(<PassageDoor scope={SCOPE} invoke={scriptedInvoke([])} canGenerate door={DEEPER_DOOR_VIEW} />);

    expect(await screen.findByText('Theological Significance')).toBeTruthy();
    expect(screen.queryByText('Read With Care')).toBeNull();
  });

  it('still defaults to Door 1 when no door is passed', async () => {
    setResult({ data: rows(), error: null });
    render(<PassageDoor scope={SCOPE} invoke={scriptedInvoke([])} canGenerate />);

    expect(await screen.findByText('Overview')).toBeTruthy();
    expect(eqs).toContainEqual(['door', 'passage']);
  });
});
