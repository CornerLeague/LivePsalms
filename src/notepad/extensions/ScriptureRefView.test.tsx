// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ScriptureRefCard } from './ScriptureRefView';

// Repo vitest config has globals:false and no auto-cleanup, so RTL renders
// must be torn down between tests (matches the convention in other .test.tsx).
afterEach(cleanup);

const baseAttrs = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  translation: 'BSB' as const, text: 'For God so loved the world',
};

describe('ScriptureRefCard', () => {
  it('renders collapsed by default as a reference label, without refetching present text', () => {
    const fetchVerseText = vi.fn();
    render(<ScriptureRefCard attrs={baseAttrs} online activeTranslation={baseAttrs.translation} updateText={vi.fn()} fetchVerseText={fetchVerseText} />);
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
    expect(screen.queryByText(/For God so loved/)).toBeNull();
    expect(fetchVerseText).not.toHaveBeenCalled();
  });

  it('keeps the reference pill visible when expanded', () => {
    const { container } = render(<ScriptureRefCard attrs={baseAttrs} online activeTranslation={baseAttrs.translation} updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    // Pill stays AND the verse + reference·translation meta are now revealed.
    expect(screen.getByRole('button').textContent).toContain('John 3:16');
    expect(screen.getByText(/For God so loved/)).toBeTruthy();
    expect(container.querySelector('.scripture-ref-verse__meta')?.textContent).toBe('John 3:16 · BSB');
  });

  it('shows the reference alongside the translation in the expanded meta line', () => {
    const { container } = render(<ScriptureRefCard attrs={baseAttrs} online activeTranslation={baseAttrs.translation} updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    fireEvent.click(screen.getByRole('button')); // expand
    // Collapsed pill query would now be ambiguous (pill + meta both say "John 3:16"),
    // so scope to the verse-panel meta span.
    const meta = container.querySelector('.scripture-ref-verse__meta');
    expect(meta?.textContent).toBe('John 3:16 · BSB');
  });

  it('collapses again on a second click, hiding the verse but keeping the pill', () => {
    render(<ScriptureRefCard attrs={baseAttrs} online activeTranslation={baseAttrs.translation} updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    const pill = screen.getByRole('button');
    fireEvent.click(pill); // expand
    expect(screen.getByText(/For God so loved/)).toBeTruthy();
    fireEvent.click(pill); // collapse
    expect(screen.queryByText(/For God so loved/)).toBeNull();
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
  });

  it('lazy-fills empty text when online and writes it back', async () => {
    const updateText = vi.fn();
    const fetchVerseText = vi.fn(async () => ({ text: 'Backfilled verse', translation: 'BSB', reference: 'John 3:16' }));
    render(<ScriptureRefCard attrs={{ ...baseAttrs, text: '' }} online activeTranslation={baseAttrs.translation} updateText={updateText} fetchVerseText={fetchVerseText} />);
    await waitFor(() => expect(fetchVerseText).toHaveBeenCalledOnce());
    expect(updateText).toHaveBeenCalledWith('Backfilled verse');
  });

  it('does not lazy-fill when offline', () => {
    const fetchVerseText = vi.fn();
    render(<ScriptureRefCard attrs={{ ...baseAttrs, text: '' }} online={false} activeTranslation={baseAttrs.translation} updateText={vi.fn()} fetchVerseText={fetchVerseText} />);
    expect(fetchVerseText).not.toHaveBeenCalled();
  });
});

describe('ScriptureRefCard live re-flow', () => {
  it('re-resolves displayed text when the active version differs from the captured one', async () => {
    const fetchVerseText = vi.fn(async (_ref: string, opts?: { translation?: string }) =>
      ({ text: `KJV text (${opts?.translation})`, translation: opts?.translation ?? 'BSB', reference: 'John 3:16' }));
    render(
      <ScriptureRefCard
        attrs={baseAttrs}
        online={true}
        activeTranslation="KJV"
        updateText={vi.fn()}
        fetchVerseText={fetchVerseText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /John 3:16/ }));   // expand
    await waitFor(() => expect(screen.getByText(/KJV text \(KJV\)/)).toBeTruthy());
    expect(fetchVerseText).toHaveBeenCalledWith('John 3:16', expect.objectContaining({ translation: 'KJV' }));
  });

  it('shows the captured snapshot (no fetch) when active version equals the captured one', async () => {
    const fetchVerseText = vi.fn();
    render(
      <ScriptureRefCard
        attrs={baseAttrs}
        online={true}
        activeTranslation="BSB"
        updateText={vi.fn()}
        fetchVerseText={fetchVerseText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /John 3:16/ }));
    expect(screen.getByText('For God so loved the world')).toBeTruthy();
    expect(fetchVerseText).not.toHaveBeenCalled();
  });
});
