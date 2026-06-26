// @vitest-environment jsdom
// src/notepad/study/lexicon/useStrongsEntry.nullsupabase.test.ts
// Exercises the `!supabase` guard (global constraint: supabase client may be null).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: null }));
import { useStrongsEntry } from './useStrongsEntry';

afterEach(cleanup);

describe('useStrongsEntry when supabase is unavailable', () => {
  it('returns the unavailable error and null entry without querying', async () => {
    const { result } = renderHook(() => useStrongsEntry('H7225'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Lexicon is unavailable.');
    expect(result.current.entry).toBeNull();
  });
});
