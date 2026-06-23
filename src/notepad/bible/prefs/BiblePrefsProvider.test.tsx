// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BiblePrefsProvider } from './BiblePrefsProvider';
import { useBiblePrefs } from './bible-prefs-context';

// Auth session: provider sources userId from here.
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' } }),
}));
// Stub supabase so the hooks' profile read/write are inert in this unit test.
vi.mock('@/lib/supabase', () => ({ supabase: null }));

function Probe() {
  const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();
  return (
    <div>
      <span data-testid="t">{translation}</span>
      <span data-testid="l">{verseLayout}</span>
      <button onClick={() => setTranslation('KJV')}>set-kjv</button>
      <button onClick={() => setVerseLayout('spaced')}>set-spaced</button>
    </div>
  );
}

describe('BiblePrefsProvider', () => {
  it('provides defaults and propagates setters', () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    expect(screen.getByTestId('t').textContent).toBe('BSB');
    expect(screen.getByTestId('l').textContent).toBe('inline');
    fireEvent.click(screen.getByText('set-kjv'));
    fireEvent.click(screen.getByText('set-spaced'));
    expect(screen.getByTestId('t').textContent).toBe('KJV');
    expect(screen.getByTestId('l').textContent).toBe('spaced');
  });

  it('useBiblePrefs throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/BiblePrefsProvider/);
    spy.mockRestore();
  });
});
