// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeContext, type ThemeContextValue } from '../../../../notepad/theme/theme-context';

vi.mock('../../../../notepad/components/Editor', () => ({
  NotepadEditor: (props: { toolbarPlacement?: string }) => (
    <div data-testid="editor" data-placement={props.toolbarPlacement} />
  ),
}));
vi.mock('./useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));
import { MobileEditorView } from './MobileEditorView';

afterEach(cleanup);

const themeValue: ThemeContextValue = { theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() };

describe('<MobileEditorView />', () => {
  it('renders the editor with bottom toolbar placement', () => {
    render(
      <ThemeContext.Provider value={themeValue}>
        <MobileEditorView onExit={vi.fn()} hasActiveNote onNewNote={vi.fn()} />
      </ThemeContext.Provider>,
    );
    expect(screen.getByTestId('editor').getAttribute('data-placement')).toBe('bottom');
  });

  it('does not render a Note details button (removed as redundant with the More tab)', () => {
    render(
      <ThemeContext.Provider value={themeValue}>
        <MobileEditorView onExit={vi.fn()} hasActiveNote onNewNote={vi.fn()} />
      </ThemeContext.Provider>,
    );
    expect(screen.queryByLabelText('Note details')).toBeNull();
  });

  it('shows the New note FAB when no note is displayed', () => {
    render(
      <ThemeContext.Provider value={themeValue}>
        <MobileEditorView onExit={vi.fn()} hasActiveNote={false} onNewNote={vi.fn()} />
      </ThemeContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument();
  });

  it('hides the New note FAB when a note is displayed', () => {
    render(
      <ThemeContext.Provider value={themeValue}>
        <MobileEditorView onExit={vi.fn()} hasActiveNote onNewNote={vi.fn()} />
      </ThemeContext.Provider>,
    );
    expect(screen.queryByRole('button', { name: 'New note' })).toBeNull();
  });

  it('calls onNewNote when the FAB is tapped in the empty state', () => {
    const onNewNote = vi.fn();
    render(
      <ThemeContext.Provider value={themeValue}>
        <MobileEditorView onExit={vi.fn()} hasActiveNote={false} onNewNote={onNewNote} />
      </ThemeContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    expect(onNewNote).toHaveBeenCalledTimes(1);
  });
});
