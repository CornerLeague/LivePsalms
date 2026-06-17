// src/notepad/study/useNotesOnOffer.ts
import { useCallback, useState } from 'react';
import type { OfferedNote } from './study-chat-client';

export function useNotesOnOffer() {
  const [offered, setOffered] = useState<OfferedNote[]>([]);
  const [includedIds, setIncludedIds] = useState<string[]>([]);

  const includeNote = useCallback((id: string) => {
    setIncludedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const reset = useCallback(() => { setOffered([]); setIncludedIds([]); }, []);

  return { offered, setOffered, includedIds, includeNote, reset };
}
