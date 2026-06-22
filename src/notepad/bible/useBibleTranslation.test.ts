// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBibleTranslation } from './useBibleTranslation';

describe('useBibleTranslation', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to BSB', () => {
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });
  it('persists a new selection across remounts', () => {
    const first = renderHook(() => useBibleTranslation());
    act(() => first.result.current.setTranslation('KJV'));
    const second = renderHook(() => useBibleTranslation());
    expect(second.result.current.translation).toBe('KJV');
  });
  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.bible.translation', 'NIV');
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });
});
