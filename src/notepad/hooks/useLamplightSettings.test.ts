// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { FakeLamplightAdapter } from '../storage/fake-lamplight-adapter';
import { useLamplightSettings } from './useLamplightSettings';

describe('useLamplightSettings', () => {
  let adapter: FakeLamplightAdapter;

  beforeEach(() => {
    adapter = new FakeLamplightAdapter();
  });

  it('returns isLoading=true initially then settings=null when no row', async () => {
    const { result } = renderHook(() => useLamplightSettings({ adapter, userId: 'user-1' }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toBeNull();
  });

  it('returns existing settings when the row exists', async () => {
    await adapter.upsertSettings('user-1', { enabled: true });
    const { result } = renderHook(() => useLamplightSettings({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings?.enabled).toBe(true);
  });

  it('upsert mutates the row and updates state', async () => {
    const { result } = renderHook(() => useLamplightSettings({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.upsert({ enabled: true });
    });
    expect(result.current.settings?.enabled).toBe(true);
  });

  it('deleteAll removes the row and resets settings to null', async () => {
    await adapter.upsertSettings('user-1', { enabled: true });
    const { result } = renderHook(() => useLamplightSettings({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.deleteAll();
    });
    expect(result.current.settings).toBeNull();
    expect(adapter.deleteAllUserDataCalls).toEqual(['user-1']);
  });

  it('returns settings=null + isLoading=false when userId is null (anonymous)', async () => {
    const { result } = renderHook(() => useLamplightSettings({ adapter, userId: null }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toBeNull();
  });

  it('settles isLoading=false even when getSettings throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Patch the fake to throw once.
    const original = adapter.getSettings.bind(adapter);
    adapter.getSettings = async () => { throw new Error('boom'); };
    const { result } = renderHook(() => useLamplightSettings({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toBeNull();
    // Restore for other tests (each `it` gets a fresh adapter via beforeEach, but be safe).
    adapter.getSettings = original;
    errorSpy.mockRestore();
  });

  it('upsert rethrows adapter errors and leaves state untouched', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useLamplightSettings({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    adapter.upsertSettings = async () => { throw new Error('boom'); };
    await expect(result.current.upsert({ enabled: true })).rejects.toThrow('boom');
    expect(result.current.settings).toBeNull();
    errorSpy.mockRestore();
  });

  it('fails closed without touching the adapter or logging when adapter is null', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // userId is intentionally non-null here: the guard must key off `adapter`
    // being null, not piggyback on callers always nulling out userId too.
    const { result } = renderHook(() => useLamplightSettings({ adapter: null, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
