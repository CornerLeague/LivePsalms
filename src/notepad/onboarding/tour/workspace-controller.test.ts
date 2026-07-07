import { describe, expect, it, vi } from 'vitest';
import {
  getWorkspaceControls,
  registerWorkspaceControls,
  subscribeWorkspaceControls,
} from './workspace-controller';

describe('workspace-controller registry', () => {
  it('merges registered controls and removes them on unregister', () => {
    const setTab = vi.fn();
    const unregister = registerWorkspaceControls({ mobileSetTab: setTab });
    expect(getWorkspaceControls().mobileSetTab).toBe(setTab);
    unregister();
    expect(getWorkspaceControls().mobileSetTab).toBeUndefined();
  });

  it('merges controls from independent registrations', () => {
    const openNote = vi.fn();
    const setGraphOpen = vi.fn();
    const unregisterShared = registerWorkspaceControls({ openNote });
    const unregisterDesktop = registerWorkspaceControls({ desktopSetGraphOpen: setGraphOpen });
    expect(getWorkspaceControls().openNote).toBe(openNote);
    expect(getWorkspaceControls().desktopSetGraphOpen).toBe(setGraphOpen);
    unregisterShared();
    expect(getWorkspaceControls().openNote).toBeUndefined();
    expect(getWorkspaceControls().desktopSetGraphOpen).toBe(setGraphOpen);
    unregisterDesktop();
  });

  it('a stale unregister never clobbers a newer registration for the same key', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerWorkspaceControls({ openAuth: first });
    const unregisterSecond = registerWorkspaceControls({ openAuth: second });
    unregisterFirst(); // stale cleanup arriving after re-registration
    expect(getWorkspaceControls().openAuth).toBe(second);
    unregisterSecond();
    expect(getWorkspaceControls().openAuth).toBeUndefined();
  });

  it('notifies subscribers on register and unregister', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceControls(listener);
    const unregister = registerWorkspaceControls({ openNote: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registerWorkspaceControls({ openNote: vi.fn() })();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('continues notifying remaining listeners even if one throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwingListener = vi.fn(() => {
      throw new Error('listener error');
    });
    const secondListener = vi.fn();
    subscribeWorkspaceControls(throwingListener);
    subscribeWorkspaceControls(secondListener);
    registerWorkspaceControls({ openNote: vi.fn() });
    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
