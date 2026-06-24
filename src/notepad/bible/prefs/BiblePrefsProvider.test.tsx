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

  it('seeds both prefs from a SINGLE combined profile read', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { bible_translation: 'KJV', bible_verse_layout: 'lines' },
      error: null,
    });
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('KJV'));
    expect(screen.getByTestId('l').textContent).toBe('lines');
    expect(localStorage.getItem('psalms.bible.translation')).toBe('KJV');
    expect(localStorage.getItem('psalms.bible.verseLayout')).toBe('lines');
    // The fix: one round-trip reading both columns, not one per pref.
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledWith('bible_translation, bible_verse_layout');
    expect(mockSelectEq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('skips the profile read entirely when both prefs are already stored locally', async () => {
    localStorage.setItem('psalms.bible.translation', 'WEB');
    localStorage.setItem('psalms.bible.verseLayout', 'spaced');
    mockMaybeSingle.mockResolvedValue({
      data: { bible_translation: 'KJV', bible_verse_layout: 'lines' },
      error: null,
    });
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    await waitFor(() => expect(mockFrom).not.toHaveBeenCalled());
    expect(screen.getByTestId('t').textContent).toBe('WEB'); // local wins
    expect(screen.getByTestId('l').textContent).toBe('spaced');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('seeds only the pref missing locally; the local pick wins', async () => {
    localStorage.setItem('psalms.bible.translation', 'WEB'); // local present → keep
    mockMaybeSingle.mockResolvedValue({
      data: { bible_translation: 'KJV', bible_verse_layout: 'lines' },
      error: null,
    });
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    await waitFor(() => expect(screen.getByTestId('l').textContent).toBe('lines'));
    expect(screen.getByTestId('t').textContent).toBe('WEB'); // not overwritten
    expect(mockSelect).toHaveBeenCalledTimes(1);
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
