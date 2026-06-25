// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTodaysLamp } from './useTodaysLamp';
import { FakeLamplightAdapter } from '../storage/fake-lamplight-adapter';
import type { DailyDevotion } from '../storage/lamplight-artifacts';

const devotion: DailyDevotion = {
  opening: 'op',
  scripture: { ref: 'Psalm 23:4', text: 't' },
  reflection: 'r',
  prompt: 'p',
  note_citations: [{ note_id: 'n1', reason: 'rest' }],
};

describe('useTodaysLamp', () => {
  it('renders existing artifact without invoking generate', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedDailyDevotion('user-1', '2026-05-27', devotion);
    const generateSpy = vi.spyOn(adapter, 'generateDailyDevotion');
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27' }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    if (result.current.state.phase === 'ready') {
      expect(result.current.state.artifact).toEqual(devotion);
    }
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('generates when no existing artifact, transitions through retrieving to ready', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueGenerateResult({ ok: true, artifact: devotion, cached: false });
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27' }),
    );
    // Initial state is retrieving (notes stage)
    expect(result.current.state.phase).toBe('retrieving');
    if (result.current.state.phase === 'retrieving') {
      expect(result.current.state.stage).toBe('notes');
    }
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    if (result.current.state.phase === 'ready') {
      expect(result.current.state.artifact).toEqual(devotion);
    }
  });

  it('transitions to error state with reason on failure', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueGenerateResult({ ok: false, reason: 'validators_failed' });
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27' }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    if (result.current.state.phase === 'error') {
      expect(result.current.state.reason).toBe('validators_failed');
    }
  });

  it('unmount during in-flight generate does not setState after teardown', async () => {
    const adapter = new FakeLamplightAdapter();
    let resolveGenerate: ((v: { ok: false; reason: 'network' }) => void) | undefined;
    adapter.generateDailyDevotion = (() =>
      new Promise<{ ok: false; reason: 'network' }>(resolve => { resolveGenerate = resolve; })) as typeof adapter.generateDailyDevotion;

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27' }),
    );
    unmount();
    resolveGenerate?.({ ok: false, reason: 'network' });
    await new Promise(r => setTimeout(r, 20));

    // React would have logged a "setState on unmounted component" warning if
    // the cancelledRef guard didn't catch the resolution.
    const calls = consoleError.mock.calls.map(c => String(c[0] ?? ''));
    expect(calls.some(m => m.includes('unmounted'))).toBe(false);
    consoleError.mockRestore();
  });

  it('does not regenerate when re-rendered with the same props', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueGenerateResult({ ok: true, artifact: devotion, cached: false });
    const generateSpy = vi.spyOn(adapter, 'generateDailyDevotion');
    const { result, rerender } = renderHook(
      (props: { localDate: string }) =>
        useTodaysLamp({ adapter, userId: 'user-1', localDate: props.localDate }),
      { initialProps: { localDate: '2026-05-27' } },
    );
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    expect(generateSpy).toHaveBeenCalledTimes(1);
    rerender({ localDate: '2026-05-27' });
    await new Promise(r => setTimeout(r, 30));
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it('retry re-runs the fetch-or-generate flow', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueGenerateResult({ ok: false, reason: 'network' });
    adapter.__queueGenerateResult({ ok: true, artifact: devotion, cached: false });
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27' }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    act(() => { result.current.retry(); });
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  });

  it('cached artifact renders regardless of autoGenerate=false', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__seedDailyDevotion('user-1', '2026-05-27', devotion);
    const generateSpy = vi.spyOn(adapter, 'generateDailyDevotion');
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27', autoGenerate: false }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('cache miss with autoGenerate=false enters idle without generating', async () => {
    const adapter = new FakeLamplightAdapter();
    const generateSpy = vi.spyOn(adapter, 'generateDailyDevotion');
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27', autoGenerate: false }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('start() from idle generates exactly once and reaches ready', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueGenerateResult({ ok: true, artifact: devotion, cached: false });
    const generateSpy = vi.spyOn(adapter, 'generateDailyDevotion');
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27', autoGenerate: false }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it('start() error then retry recovers to ready', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueGenerateResult({ ok: false, reason: 'network' });
    adapter.__queueGenerateResult({ ok: true, artifact: devotion, cached: false });
    const { result } = renderHook(() =>
      useTodaysLamp({ adapter, userId: 'user-1', localDate: '2026-05-27', autoGenerate: false }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    act(() => { result.current.retry(); });
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
  });

  it('start request does not carry over to a new localDate (no auto-generate on date change)', async () => {
    const adapter = new FakeLamplightAdapter();
    adapter.__queueGenerateResult({ ok: true, artifact: devotion, cached: false });
    const generateSpy = vi.spyOn(adapter, 'generateDailyDevotion');
    const { result, rerender } = renderHook(
      (props: { localDate: string }) =>
        useTodaysLamp({ adapter, userId: 'user-1', localDate: props.localDate, autoGenerate: false }),
      { initialProps: { localDate: '2026-05-27' } },
    );
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    expect(generateSpy).toHaveBeenCalledTimes(1);
    // New day while still mounted: must NOT auto-generate; should return to idle.
    rerender({ localDate: '2026-05-28' });
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });
});
