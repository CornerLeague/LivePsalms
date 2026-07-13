import { useCallback, useState } from 'react';
import { loadEnum, saveEnum, KEY_TEXT_SIZE } from '../session/session-storage';
import { type TextSize, DEFAULT_TEXT_SIZE, TEXT_SIZES } from './text-size-types';
import { supabase } from '@/lib/supabase';

export interface UseTextSizeResult {
  textSize: TextSize;
  setLocalTextSize: (t: TextSize) => void;
  saveGlobalTextSize: (t: TextSize) => Promise<{ ok: boolean; error?: string }>;
}

export function useTextSize(
  { userId = null }: { userId?: string | null } = {},
): UseTextSizeResult {
  const [textSize, setState] = useState<TextSize>(() =>
    loadEnum<TextSize>(KEY_TEXT_SIZE, TEXT_SIZES, DEFAULT_TEXT_SIZE),
  );

  // Device-local store only. Seeding the global value from the profile is owned by
  // BiblePrefsProvider so it can read all prefs in one query — this hook never reads.

  const setLocalTextSize = useCallback((t: TextSize) => {
    setState(t);
    saveEnum(KEY_TEXT_SIZE, t);
  }, []);

  const saveGlobalTextSize = useCallback(
    async (t: TextSize): Promise<{ ok: boolean; error?: string }> => {
      setState(t);
      saveEnum(KEY_TEXT_SIZE, t);
      if (!userId || !supabase) return { ok: true };
      const { error } = await supabase
        .from('profiles').update({ text_size: t }).eq('id', userId);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    [userId],
  );

  return { textSize, setLocalTextSize, saveGlobalTextSize };
}
