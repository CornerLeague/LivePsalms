// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BibleReadingSettingsSection } from './BibleReadingSettingsSection';
import { BiblePrefsContext } from '@/notepad/bible/prefs/bible-prefs-context';

afterEach(cleanup);

function renderWithPrefs(value: Parameters<typeof BiblePrefsContext.Provider>[0]['value']) {
  return render(
    <BiblePrefsContext.Provider value={value}>
      <BibleReadingSettingsSection />
    </BiblePrefsContext.Provider>,
  );
}

describe('BibleReadingSettingsSection', () => {
  it('reflects current version and calls setTranslation on change', () => {
    const setTranslation = vi.fn();
    renderWithPrefs({ translation: 'BSB', setTranslation, verseLayout: 'inline', setVerseLayout: vi.fn() });
    const select = screen.getByLabelText('Bible version') as HTMLSelectElement;
    expect(select.value).toBe('BSB');
    fireEvent.change(select, { target: { value: 'KJV' } });
    expect(setTranslation).toHaveBeenCalledWith('KJV');
  });

  it('calls setVerseLayout when a layout option is chosen', () => {
    const setVerseLayout = vi.fn();
    renderWithPrefs({ translation: 'BSB', setTranslation: vi.fn(), verseLayout: 'inline', setVerseLayout });
    fireEvent.click(screen.getByRole('button', { name: /Spaced/i }));
    expect(setVerseLayout).toHaveBeenCalledWith('spaced');
  });
});
