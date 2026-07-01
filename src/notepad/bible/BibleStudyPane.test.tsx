// @vitest-environment jsdom
// src/notepad/bible/BibleStudyPane.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

const useAuthSession = vi.fn();
const useLamplightSettings = vi.fn();
const useLamplightEntitlement = vi.fn();
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => useAuthSession() }));
vi.mock('@/notepad/hooks/useLamplightSettings', () => ({ useLamplightSettings: () => useLamplightSettings() }));
vi.mock('@/notepad/hooks/useLamplightEntitlement', () => ({ useLamplightEntitlement: () => useLamplightEntitlement() }));
vi.mock('./prefs/bible-prefs-context', () => ({
  useBiblePrefs: () => ({
    translation: 'BSB',
    verseLayout: 'inline',
    setLocalTranslation: vi.fn(),
    setLocalVerseLayout: vi.fn(),
    saveGlobalPrefs: vi.fn(),
  }),
}));
const { readerProps } = vi.hoisted(() => ({ readerProps: { current: null as Record<string, unknown> | null } }));
vi.mock('./BibleReader', () => ({ BibleReader: (p: { onPassageChange?: (r: unknown) => void } & Record<string, unknown>) => {
  readerProps.current = p;
  // emit a passage on mount so the chat has a book/chapter
  p.onPassageChange?.({ book: 'jhn', chapter: 10 });
  return <div data-testid="bible-reader">reader</div>;
} }));
vi.mock('@/notepad/components/lamplight/chat/LamplightChat', () => ({ LamplightChat: () => <div data-testid="chat">chat</div> }));
vi.mock('@/notepad/components/lamplight/SignInGate', () => ({ SignInGate: () => <div data-testid="signin">signin</div> }));
vi.mock('@/notepad/components/lamplight/PaywallCard', () => ({ PaywallCard: () => <div data-testid="paywall">paywall</div> }));

const { focusFake } = vi.hoisted(() => ({
  focusFake: {
    focusModeOn: false,
    toggleFocusMode: vi.fn(),
    savedLists: [],
    quickList: { id: '__quick__', title: 'Quick list', position: -1, items: [] },
    activeListId: '__quick__',
    activeList: { id: '__quick__', title: 'Quick list', position: -1, items: [] },
    canSave: false,
    selectList: vi.fn(),
    newList: vi.fn(),
    saveQuickList: vi.fn(),
    deleteList: vi.fn(),
    addRefs: vi.fn(),
    removeItem: vi.fn(),
    reorderItem: vi.fn(),
  },
}));
vi.mock('./focus/useScriptureFocusLists', () => ({ useScriptureFocusLists: () => focusFake }));
vi.mock('./focus/FocusListView', () => ({ FocusListView: () => <div data-testid="focus-body">focus</div> }));
vi.mock('./verse-search-client', () => ({ createBrowserVerseSearchDeps: () => ({}) }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { BibleStudyPane } from './BibleStudyPane';

const adapter = {} as never;
beforeEach(() => {
  useAuthSession.mockReturnValue({ user: { id: 'u1' } });
  useLamplightSettings.mockReturnValue({ isLoading: false, settings: { enabled: true } });
  useLamplightEntitlement.mockReturnValue({ isLoading: false, hasAccess: () => true });
  focusFake.addRefs.mockResolvedValue(true);
});
afterEach(cleanup);

describe('BibleStudyPane', () => {
  it('always shows the reader; chat is hidden until toggled on', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    expect(screen.getByTestId('bible-reader')).toBeInTheDocument();
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument();
  });

  it('opens the chat when the entitled user toggles Lamplight on', async () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /lamplight/i }));
    await waitFor(() => expect(screen.getByTestId('chat')).toBeInTheDocument());
  });

  it('shows the paywall (not the chat) when toggled on without entitlement', () => {
    useLamplightEntitlement.mockReturnValue({ isLoading: false, hasAccess: () => false });
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /lamplight/i }));
    expect(screen.getByTestId('paywall')).toBeInTheDocument();
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument();
  });

  it('shows the sign-in gate when toggled on while logged out', () => {
    useAuthSession.mockReturnValue({ user: null });
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /lamplight/i }));
    expect(screen.getByTestId('signin')).toBeInTheDocument();
  });

  it('disables the chat button and shows the Settings hint when Lamplight is off', () => {
    useLamplightSettings.mockReturnValue({ isLoading: false, settings: { enabled: false } });
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    const button = screen.getByRole('button', { name: /lamplight/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/enable lamplight in settings/i)).toBeInTheDocument();
  });

  it('does not open the chat when the button is clicked while Lamplight is off', () => {
    useLamplightSettings.mockReturnValue({ isLoading: false, settings: { enabled: false } });
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /lamplight/i }));
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('keeps the button enabled for signed-out users (sign-in flow preserved)', () => {
    useAuthSession.mockReturnValue({ user: null });
    useLamplightSettings.mockReturnValue({ isLoading: false, settings: null });
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    const button = screen.getByRole('button', { name: /lamplight/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(screen.getByTestId('signin')).toBeInTheDocument();
  });

  it('passes the verse-layout preference and change handler down to the reader', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    expect(readerProps.current?.verseLayout).toBe('inline');
    expect(typeof readerProps.current?.onVerseLayoutChange).toBe('function');
  });

  it('shows a resize handle between reader and chat only when chat is open', async () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /lamplight/i }));
    await waitFor(() => expect(screen.getByRole('separator')).toBeInTheDocument());
  });
});

describe('BibleStudyPane — Scripture Focus wiring', () => {
  it('passes a focus bridge to the reader', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    const bridge = readerProps.current?.focus as Record<string, unknown> | undefined;
    expect(bridge).toBeTruthy();
    expect(typeof bridge?.onToggleFocusMode).toBe('function');
    expect(typeof bridge?.renderFocusBody).toBe('function');
  });

  it('toggling via the bridge calls the hook toggle', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    (readerProps.current?.focus as { onToggleFocusMode: () => void }).onToggleFocusMode();
    expect(focusFake.toggleFocusMode).toHaveBeenCalled();
  });

  it('renderFocusBody renders the focus list view', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    const node = (readerProps.current?.focus as { renderFocusBody: () => ReactNode }).renderFocusBody();
    render(<>{node}</>);
    expect(screen.getByTestId('focus-body')).toBeInTheDocument();
  });
});
