// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { FakeLamplightAdapter } from '../storage/fake-lamplight-adapter';
import { useLamplightEntitlement } from './useLamplightEntitlement';

describe('useLamplightEntitlement', () => {
  let adapter: FakeLamplightAdapter;

  beforeEach(() => {
    adapter = new FakeLamplightAdapter();
    adapter.promo = { promoActive: true, promoEndsAt: null };
  });

  it('hasAccess() returns true for every feature while promo is active', async () => {
    const { result } = renderHook(() => useLamplightEntitlement({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.promoActive).toBe(true);
    expect(result.current.hasAccess('today')).toBe(true);
    expect(result.current.hasAccess('weekly')).toBe(true);
    expect(result.current.hasAccess('reflections')).toBe(true);
    expect(result.current.hasAccess('inline')).toBe(true);
  });

  it('hasAccess() returns true for all features when tier=plus and promo off', async () => {
    adapter.promo = { promoActive: false, promoEndsAt: null };
    await adapter.upsertSettings('user-1', {});
    adapter.entitlements.set('user-1', {
      userId: 'user-1', tier: 'plus', source: 'subscription',
      grantedAt: '2026-05-25T00:00:00Z', expiresAt: null,
    });
    const { result } = renderHook(() => useLamplightEntitlement({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAccess('today')).toBe(true);
    expect(result.current.hasAccess('reflections')).toBe(true);
  });

  it('hasAccess() returns true only for today+weekly when tier=lite', async () => {
    adapter.promo = { promoActive: false, promoEndsAt: null };
    adapter.entitlements.set('user-1', {
      userId: 'user-1', tier: 'lite', source: 'subscription',
      grantedAt: '2026-05-25T00:00:00Z', expiresAt: null,
    });
    const { result } = renderHook(() => useLamplightEntitlement({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAccess('today')).toBe(true);
    expect(result.current.hasAccess('weekly')).toBe(true);
    expect(result.current.hasAccess('reflections')).toBe(false);
    expect(result.current.hasAccess('inline')).toBe(false);
  });

  it('hasAccess() returns false for every feature when tier=none and promo off', async () => {
    adapter.promo = { promoActive: false, promoEndsAt: null };
    const { result } = renderHook(() => useLamplightEntitlement({ adapter, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tier).toBe('none');
    expect(result.current.hasAccess('today')).toBe(false);
    expect(result.current.hasAccess('weekly')).toBe(false);
    expect(result.current.hasAccess('reflections')).toBe(false);
  });

  it('grants chat only to plus or active promo', async () => {
    // plus tier, no promo
    {
      adapter.promo = { promoActive: false, promoEndsAt: null };
      adapter.entitlements.set('user-1', {
        userId: 'user-1', tier: 'plus', source: 'subscription',
        grantedAt: '2026-05-25T00:00:00Z', expiresAt: null,
      });
      const { result } = renderHook(() => useLamplightEntitlement({ adapter, userId: 'user-1' }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.hasAccess('chat')).toBe(true);
    }
    // lite tier, no promo
    {
      adapter.promo = { promoActive: false, promoEndsAt: null };
      adapter.entitlements.set('user-1', {
        userId: 'user-1', tier: 'lite', source: 'subscription',
        grantedAt: '2026-05-25T00:00:00Z', expiresAt: null,
      });
      const { result } = renderHook(() => useLamplightEntitlement({ adapter, userId: 'user-1' }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.hasAccess('chat')).toBe(false);
    }
    // none tier, promo active
    {
      adapter.promo = { promoActive: true, promoEndsAt: null };
      adapter.entitlements.delete('user-1');
      const { result } = renderHook(() => useLamplightEntitlement({ adapter, userId: 'user-1' }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.hasAccess('chat')).toBe(true);
    }
  });

  it('fails closed without touching the adapter or logging when adapter is null', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // userId is intentionally non-null here: the guard must key off `adapter`
    // being null, not piggyback on callers always nulling out userId too.
    const { result } = renderHook(() => useLamplightEntitlement({ adapter: null, userId: 'user-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.promoActive).toBe(false);
    expect(result.current.tier).toBe('none');
    expect(result.current.hasAccess('today')).toBe(false);
    expect(result.current.hasAccess('chat')).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
