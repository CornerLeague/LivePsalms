// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeContext, type ThemeContextValue } from '../../notepad/theme/theme-context';

const isMobile = { value: false };
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => isMobile.value }));
vi.mock('./notepad/mobile/MobileNotepadWorkspace', () => ({
  MobileNotepadWorkspace: () => <div data-testid="mobile-shell" />,
}));
// Stand in for the (heavy) desktop body so this test stays focused on the switch.
vi.mock('@/notepad/context/NotepadProvider', () => ({
  NotepadProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ adapter: {} }) }));
vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ notes: [], activeNote: null, collection: {} }),
}));

// The desktop body reads many hooks; mock the workspace's own module boundary by
// mocking the leaf imports it pulls. Simplest: assert via the mobile path and a
// sentinel for desktop using a spy on the rendered marker the desktop path emits.

import { Notepad } from './Notepad';

afterEach(cleanup);

const themeValue: ThemeContextValue = { theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() };

describe('Notepad breakpoint switch', () => {
  it('renders the mobile shell when useIsMobile() is true', () => {
    isMobile.value = true;
    const { getByTestId } = render(
      <ThemeContext.Provider value={themeValue}>
        <Notepad />
      </ThemeContext.Provider>,
    );
    expect(getByTestId('mobile-shell')).toBeTruthy();
  });
});
