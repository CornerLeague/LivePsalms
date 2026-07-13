// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockFrom, mockSelect, mockSelectEq, mockMaybeSingle, mockUpdate, mockUpdateEq } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
  const mockUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect, update: mockUpdate }));
  return { mockFrom, mockSelect, mockSelectEq, mockMaybeSingle, mockUpdate, mockUpdateEq };
});

vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }));

import { BiblePrefsProvider } from './BiblePrefsProvider';
import { useBiblePrefs } from './bible-prefs-context';

function Probe() {
  const { translation, verseLayout, textSize, setLocalTranslation, setLocalVerseLayout, setLocalTextSize, saveGlobalPrefs } = useBiblePrefs();
  return (
    <div>
      <span data-testid="t">{translation}</span>
      <span data-testid="l">{verseLayout}</span>
      <span data-testid="s">{textSize}</span>
      <button onClick={() => setLocalTranslation('KJV')}>set-local-kjv</button>
      <button onClick={() => setLocalVerseLayout('spaced')}>set-local-spaced</button>
      <button onClick={() => setLocalTextSize('xlarge')}>set-local-xlarge</button>
      <button onClick={() => { void saveGlobalPrefs({ translation: 'WEB', verseLayout: 'lines', textSize: 'large' }); }}>save-global</button>
    </div>
  );
}

describe('BiblePrefsProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSelectEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockSelectEq });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
  });
  afterEach(() => cleanup());

  it('provides defaults and local setters', () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    expect(screen.getByTestId('t').textContent).toBe('BSB');
    expect(screen.getByTestId('l').textContent).toBe('inline');
    expect(screen.getByTestId('s').textContent).toBe('base');
    fireEvent.click(screen.getByText('set-local-kjv'));
    fireEvent.click(screen.getByText('set-local-spaced'));
    fireEvent.click(screen.getByText('set-local-xlarge'));
    expect(screen.getByTestId('t').textContent).toBe('KJV');
    expect(screen.getByTestId('l').textContent).toBe('spaced');
    expect(screen.getByTestId('s').textContent).toBe('xlarge');
  });

  it('saveGlobalPrefs updates all three values', async () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    fireEvent.click(screen.getByText('save-global'));
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('WEB'));
    expect(screen.getByTestId('l').textContent).toBe('lines');
    expect(screen.getByTestId('s').textContent).toBe('large');
  });

  it('seeds all three prefs from a SINGLE combined profile read', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { bible_translation: 'KJV', bible_verse_layout: 'lines', text_size: 'xlarge' },
      error: null,
    });
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('KJV'));
    expect(screen.getByTestId('l').textContent).toBe('lines');
    expect(screen.getByTestId('s').textContent).toBe('xlarge');
    expect(localStorage.getItem('psalms.bible.translation')).toBe('KJV');
    expect(localStorage.getItem('psalms.bible.verseLayout')).toBe('lines');
    expect(localStorage.getItem('psalms.textSize')).toBe('xlarge');
    // The fix: one round-trip reading all columns, not one per pref.
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledWith('bible_translation, bible_verse_layout, text_size');
    expect(mockSelectEq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('skips the profile read entirely when all three prefs are already stored locally', async () => {
    localStorage.setItem('psalms.bible.translation', 'WEB');
    localStorage.setItem('psalms.bible.verseLayout', 'spaced');
    localStorage.setItem('psalms.textSize', 'large');
    mockMaybeSingle.mockResolvedValue({
      data: { bible_translation: 'KJV', bible_verse_layout: 'lines', text_size: 'xlarge' },
      error: null,
    });
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    await waitFor(() => expect(mockFrom).not.toHaveBeenCalled());
    expect(screen.getByTestId('t').textContent).toBe('WEB'); // local wins
    expect(screen.getByTestId('l').textContent).toBe('spaced');
    expect(screen.getByTestId('s').textContent).toBe('large');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('seeds only the pref missing locally; the local pick wins', async () => {
    localStorage.setItem('psalms.bible.translation', 'WEB'); // local present → keep
    mockMaybeSingle.mockResolvedValue({
      data: { bible_translation: 'KJV', bible_verse_layout: 'lines', text_size: 'xlarge' },
      error: null,
    });
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    await waitFor(() => expect(screen.getByTestId('l').textContent).toBe('lines'));
    expect(screen.getByTestId('t').textContent).toBe('WEB'); // not overwritten
    expect(screen.getByTestId('s').textContent).toBe('xlarge');
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it('a local pick made while the profile read is in flight wins over the seed', async () => {
    let resolveRead!: (v: { data: unknown; error: null }) => void;
    const pending = new Promise<{ data: unknown; error: null }>((r) => { resolveRead = r; });
    mockMaybeSingle.mockReturnValue(pending);

    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    // Read is still in flight; the user picks KJV in the reader.
    fireEvent.click(screen.getByText('set-local-kjv'));
    expect(screen.getByTestId('t').textContent).toBe('KJV');

    // The now-stale read resolves with a different remote translation.
    resolveRead({ data: { bible_translation: 'WEB', bible_verse_layout: 'lines' }, error: null });

    // The untouched pref still seeds...
    await waitFor(() => expect(screen.getByTestId('l').textContent).toBe('lines'));
    // ...but the in-flight local pick must NOT be clobbered.
    expect(screen.getByTestId('t').textContent).toBe('KJV');
    expect(localStorage.getItem('psalms.bible.translation')).toBe('KJV');
  });

  it('ignores invalid remote values', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { bible_translation: 'NIV', bible_verse_layout: 'paragraph' },
      error: null,
    });
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    expect(screen.getByTestId('t').textContent).toBe('BSB');
    expect(screen.getByTestId('l').textContent).toBe('inline');
  });

  it('useBiblePrefs throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/BiblePrefsProvider/);
    spy.mockRestore();
  });
});
