// @vitest-environment jsdom
// src/notepad/study/lexicon/useVerseLexicon.nullsupabase.test.ts
// Exercises the `!supabase` guard (global constraint: supabase client may be null).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: null }));
import { useVerseLexicon } from './useVerseLexicon';

afterEach(cleanup);

describe('useVerseLexicon when supabase is unavailable', () => {
  it('returns the unavailable error and empty result without querying', async () => {
    const { result } = renderHook(() => useVerseLexicon('gen.1.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Lexicon is unavailable.');
    expect(result.current.words).toEqual([]);
    expect(result.current.language).toBeNull();
  });
});
