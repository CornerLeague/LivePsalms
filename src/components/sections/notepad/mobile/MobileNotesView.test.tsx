// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeContext, type ThemeContextValue } from '../../../../notepad/theme/theme-context';

vi.mock('../../../../notepad/components/Sidebar', () => ({
  NotepadSidebar: () => <div data-testid="sidebar" />,
}));
import { MobileNotesView } from './MobileNotesView';

afterEach(cleanup);

const themeValue: ThemeContextValue = { theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() };

describe('<MobileNotesView />', () => {
  const props = {
    onExit: vi.fn(),
    onOpenSearch: vi.fn(),
    onNewNote: vi.fn(),
    onScanNote: vi.fn(),
    onUploadFiles: vi.fn(),
    onOpenNote: vi.fn(),
  };

  it('renders the sidebar and the FAB menu trigger', () => {
    const { getByTestId, getByLabelText } = render(
      <ThemeContext.Provider value={themeValue}>
        <MobileNotesView {...props} />
      </ThemeContext.Provider>,
    );
    expect(getByTestId('sidebar')).toBeTruthy();
    expect(getByLabelText('New note menu')).toBeTruthy();
  });

  it('wires exit, search, and new-note actions', () => {
    const onExit = vi.fn();
    const onOpenSearch = vi.fn();
    const onNewNote = vi.fn();
    const { getByLabelText } = render(
      <ThemeContext.Provider value={themeValue}>
        <MobileNotesView {...props} onExit={onExit} onOpenSearch={onOpenSearch} onNewNote={onNewNote} />
      </ThemeContext.Provider>,
    );
    fireEvent.click(getByLabelText('Home'));
    fireEvent.click(getByLabelText('Search notes'));
    // Open the FAB menu, then pick "New note".
    fireEvent.click(getByLabelText('New note menu'));
    fireEvent.click(getByLabelText('New note'));
    expect(onExit).toHaveBeenCalledOnce();
    expect(onOpenSearch).toHaveBeenCalledOnce();
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it('renders a Lamplight flame button that calls onOpenLamplight', () => {
    const onOpenLamplight = vi.fn();
    const { getByRole } = render(
      <ThemeContext.Provider value={themeValue}>
        <MobileNotesView
          onExit={() => {}}
          onOpenSearch={() => {}}
          onNewNote={() => {}}
          onScanNote={() => {}}
          onUploadFiles={() => {}}
          onOpenNote={() => {}}
          onOpenLamplight={onOpenLamplight}
          lamplightHasConnections={false}
        />
      </ThemeContext.Provider>,
    );
    const btn = getByRole('button', { name: /Lamplight/i });
    fireEvent.click(btn);
    expect(onOpenLamplight).toHaveBeenCalledTimes(1);
  });

  it('shows the connection dot on the flame only when lamplightHasConnections is true', () => {
    const base = {
      onExit: () => {}, onOpenSearch: () => {}, onNewNote: () => {},
      onScanNote: () => {}, onUploadFiles: () => {}, onOpenNote: () => {},
      onOpenLamplight: () => {},
    };
    const { container, rerender } = render(
      <ThemeContext.Provider value={themeValue}>
        <MobileNotesView {...base} lamplightHasConnections={false} />
      </ThemeContext.Provider>,
    );
    expect(container.querySelector('[data-testid="lamplight-dot"]')).toBeNull();
    rerender(
      <ThemeContext.Provider value={themeValue}>
        <MobileNotesView {...base} lamplightHasConnections />
      </ThemeContext.Provider>,
    );
    expect(container.querySelector('[data-testid="lamplight-dot"]')).not.toBeNull();
  });
});
