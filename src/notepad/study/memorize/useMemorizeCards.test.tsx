// @vitest-environment jsdom
// src/notepad/study/memorize/useMemorizeCards.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { useMemorizeCards } from './useMemorizeCards';
import { InMemoryMemorizeAdapter } from './in-memory-memorize-adapter';
import type { NewMemorizeCard } from './memorize-types';

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
