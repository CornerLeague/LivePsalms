// src/notepad/recordings/useNoteRecordings.ts
// Recordings for one note: fetch on mount and after every completed upload
// (savedVersion bump); rename/delete update locally (spec §4).
import { useCallback, useEffect, useState } from 'react';
import { listRecordings, type NoteRecording } from './recordings-client';
import { useRecordingsAudio } from './audio-context';

export function useNoteRecordings(noteId: string) {
  const { savedVersion } = useRecordingsAudio();
  const [recordings, setRecordings] = useState<NoteRecording[]>([]);

  useEffect(() => {
    let active = true;
    listRecordings(noteId)
      .then((recs) => { if (active) setRecordings(recs); })
      .catch((err) => console.warn('[recordings] list failed', err));
    return () => { active = false; };
  }, [noteId, savedVersion]);

  const applyRename = useCallback((id: string, title: string) => {
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, title } : r)));
  }, []);

  const applyDelete = useCallback((id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { recordings, applyRename, applyDelete };
}
