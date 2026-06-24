// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BiblePrefsProvider } from './BiblePrefsProvider';
import { useBiblePrefs } from './bible-prefs-context';

vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' } }),
}));
// supabase null → saveGlobalPrefs takes the signed-out no-op path but still updates state.
vi.mock('@/lib/supabase', () => ({ supabase: null }));

function Probe() {
  const { translation, verseLayout, setLocalTranslation, setLocalVerseLayout, saveGlobalPrefs } = useBiblePrefs();
  return (
    <div>
      <span data-testid="t">{translation}</span>
      <span data-testid="l">{verseLayout}</span>
      <button onClick={() => setLocalTranslation('KJV')}>set-local-kjv</button>
      <button onClick={() => setLocalVerseLayout('spaced')}>set-local-spaced</button>
      <button onClick={() => { void saveGlobalPrefs({ translation: 'WEB', verseLayout: 'lines' }); }}>save-global</button>
    </div>
  );
}

describe('BiblePrefsProvider', () => {
  afterEach(() => cleanup());

  it('provides defaults and local setters', () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    expect(screen.getByTestId('t').textContent).toBe('BSB');
    expect(screen.getByTestId('l').textContent).toBe('inline');
    fireEvent.click(screen.getByText('set-local-kjv'));
    fireEvent.click(screen.getByText('set-local-spaced'));
    expect(screen.getByTestId('t').textContent).toBe('KJV');
    expect(screen.getByTestId('l').textContent).toBe('spaced');
  });

  it('saveGlobalPrefs updates both values', async () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    fireEvent.click(screen.getByText('save-global'));
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('WEB'));
    expect(screen.getByTestId('l').textContent).toBe('lines');
  });

  it('useBiblePrefs throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/BiblePrefsProvider/);
    spy.mockRestore();
  });
});
