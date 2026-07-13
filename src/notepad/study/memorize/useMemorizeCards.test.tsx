// @vitest-environment jsdom
// src/notepad/study/memorize/useMemorizeCards.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { useMemorizeCards } from './useMemorizeCards';
import { InMemoryMemorizeAdapter } from './in-memory-memorize-adapter';
import type { MemorizeCard, NewMemorizeCard } from './memorize-types';
import { loadMemorizeCards, saveMemorizeCards } from '@/notepad/session/session-storage';

// Auth + supabase are read at module scope by the hook; the adapterOverride path
// bypasses them, but useAuthSession must still return a shape.
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: null }));

afterEach(cleanup);

const nc = (verse: number): NewMemorizeCard => ({ book: 'jhn', chapter: 3, verse, translation: 'BSB', text: `v${verse}` });

function Harness({ adapter }: { adapter: InMemoryMemorizeAdapter }) {
  const { cards, canSave, addCards, removeCard } = useMemorizeCards({ adapterOverride: adapter });
  return (
    <div>
      <span data-testid="count">{cards.length}</span>
      <span data-testid="canSave">{String(canSave)}</span>
      <button onClick={() => void addCards([nc(16), nc(17)])}>add</button>
      <button onClick={() => cards[0] && void removeCard(cards[0].id)}>remove</button>
    </div>
  );
}

describe('useMemorizeCards (adapter injection)', () => {
  it('loads, adds (optimistically), and removes via the injected adapter', async () => {
    const adapter = new InMemoryMemorizeAdapter();
    render(<Harness adapter={adapter} />);
    expect(screen.getByTestId('canSave').textContent).toBe('true');
    await act(async () => { fireEvent.click(screen.getByText('add')); });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await act(async () => { fireEvent.click(screen.getByText('remove')); });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});

describe('useMemorizeCards (guest)', () => {
  it('canSave is false and cards persist to localStorage when adapterOverride is null', async () => {
    localStorage.clear();
    function GuestHarness() {
      const { cards, canSave, addCards } = useMemorizeCards({ adapterOverride: null });
      return (
        <div>
          <span data-testid="count">{cards.length}</span>
          <span data-testid="canSave">{String(canSave)}</span>
          <button onClick={() => void addCards([nc(16)])}>add</button>
        </div>
      );
    }
    render(<GuestHarness />);
    expect(screen.getByTestId('canSave').textContent).toBe('false');
    await act(async () => { fireEvent.click(screen.getByText('add')); });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(localStorage.getItem('psalms.memorize.cards')).toContain('"verse":16');
  });
});

// Defect (y): two independent guest useMemorizeCards() instances (e.g.
// MemorizePanel + StudyReader) share one localStorage key. Every guest mutation
// used to derive its next array from the stale in-memory `cards` closure and
// blind-write the whole array, so a second instance's write could clobber the
// first's persisted deck. The fix is merge-on-read (R1) + cross-instance sync (R2).
describe('useMemorizeCards (guest) — defect (y): no data loss across instances', () => {
  function GuestHarness() {
    const { cards, addCards } = useMemorizeCards({ adapterOverride: null });
    return (
      <div>
        <span data-testid="count">{cards.length}</span>
        <button onClick={() => void addCards([nc(99)])}>add-99</button>
      </div>
    );
  }

  it('R1: addCards merges into a freshly-read store instead of clobbering a write the stale closure never saw', async () => {
    localStorage.clear();
    // Mounts against an EMPTY store, so this instance's `cards` closure is [].
    render(<GuestHarness />);

    const seeded: MemorizeCard[] = [
      {
        id: 'seed-1', book: 'jhn', chapter: 1, verse: 1, translation: 'BSB', text: 'In the beginning...',
        mastery: 80, attempts: 3, lastPracticedAt: '2026-01-01T00:00:00.000Z', position: 0,
      },
      {
        id: 'seed-2', book: 'jhn', chapter: 1, verse: 2, translation: 'BSB', text: 'He was with God...',
        mastery: 0, attempts: 0, lastPracticedAt: null, position: 1,
      },
    ];
    // Simulate a sibling instance (e.g. MemorizePanel) persisting directly to
    // the store WITHOUT dispatching the change event -- this instance never
    // hears about it, so its in-memory `cards` stays stale/empty.
    saveMemorizeCards(seeded);

    await act(async () => { fireEvent.click(screen.getByText('add-99')); });

    const stored = loadMemorizeCards();
    expect(stored).toHaveLength(3);
    expect(new Set(stored.map((c) => c.id)).size).toBe(3); // no dupes
    const byId = new Map(stored.map((c) => [c.id, c]));
    expect(byId.get('seed-1')).toMatchObject({ mastery: 80, attempts: 3 });
    expect(byId.get('seed-2')).toBeDefined();
    expect(stored.some((c) => c.verse === 99)).toBe(true);
  });

  function TwoInstances() {
    const a = useMemorizeCards({ adapterOverride: null });
    const b = useMemorizeCards({ adapterOverride: null });
    return (
      <div>
        <span data-testid="countA">{a.cards.length}</span>
        <span data-testid="countB">{b.cards.length}</span>
        <button onClick={() => void a.addCards([nc(16), nc(17)])}>add-via-a</button>
      </div>
    );
  }

  it('R2: a write from one mounted guest instance live-syncs into a sibling instance without remounting it', async () => {
    localStorage.clear();
    render(<TwoInstances />);
    expect(screen.getByTestId('countA').textContent).toBe('0');
    expect(screen.getByTestId('countB').textContent).toBe('0');

    await act(async () => { fireEvent.click(screen.getByText('add-via-a')); });

    await waitFor(() => expect(screen.getByTestId('countB').textContent).toBe('2'));
    expect(screen.getByTestId('countA').textContent).toBe('2');
  });
});
