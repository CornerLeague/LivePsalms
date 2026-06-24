// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { BibleReadingSettingsSection } from './BibleReadingSettingsSection';
import { BiblePrefsContext } from '@/notepad/bible/prefs/bible-prefs-context';
import type { BibleTranslation } from '@/notepad/bible/translations';
import type { VerseLayout } from '@/notepad/bible/bible-layout-types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const saveSpy = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Stateful harness mirroring the real provider: saveGlobalPrefs applies the
// optimistic context update UNCONDITIONALLY (the hooks' setState lands before the
// DB write resolves and is not rolled back on failure). This is what makes the
// draft re-sync to context even on a failed save — the case the P1 fix guards.
function Harness({ saveResult = { ok: true } as { ok: boolean; error?: string } }) {
  const [translation, setT] = useState<BibleTranslation>('BSB');
  const [verseLayout, setL] = useState<VerseLayout>('inline');
  const saveGlobalPrefs = useCallback(
    async (p: { translation: BibleTranslation; verseLayout: VerseLayout }) => {
      saveSpy(p);
      setT(p.translation);
      setL(p.verseLayout);
      return saveResult;
    },
    [saveResult],
  );
  const value = {
    translation,
    verseLayout,
    setLocalTranslation: setT,
    setLocalVerseLayout: setL,
    saveGlobalPrefs,
  };
  return (
    <BiblePrefsContext.Provider value={value}>
      <BibleReadingSettingsSection />
    </BiblePrefsContext.Provider>
  );
}

describe('BibleReadingSettingsSection', () => {
  it('keeps Save disabled until the draft differs from the saved value', () => {
    render(<Harness />);
    const save = screen.getByRole('button', { name: /save bible settings/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Bible version'), { target: { value: 'KJV' } });
    expect(save).toBeEnabled();
  });

  it('saves the draft, toasts success, and re-disables Save', async () => {
    render(<Harness saveResult={{ ok: true }} />);
    fireEvent.change(screen.getByLabelText('Bible version'), { target: { value: 'KJV' } });
    fireEvent.click(screen.getByRole('button', { name: /save bible settings/i }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ translation: 'KJV', verseLayout: 'inline' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bible settings saved'));
    expect(screen.getByRole('button', { name: /save bible settings/i })).toBeDisabled();
  });

  it('toasts the error and leaves Save enabled for a retry when the save fails', async () => {
    render(<Harness saveResult={{ ok: false, error: 'Network down' }} />);
    fireEvent.change(screen.getByLabelText('Bible version'), { target: { value: 'WEB' } });
    const save = screen.getByRole('button', { name: /save bible settings/i });
    fireEvent.click(save);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network down'));
    // Even though the optimistic update made draft === context (dirty === false),
    // Save stays enabled so the user can retry without re-editing.
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect(saveSpy).toHaveBeenLastCalledWith({ translation: 'WEB', verseLayout: 'inline' });
  });
});
